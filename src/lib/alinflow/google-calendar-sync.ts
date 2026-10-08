import { createHash } from "node:crypto";
import { calendarAccessToken, googleCalendarAdmin, GoogleCalendarAuthError } from "./google-calendar-auth";
import { buildGoogleCalendarEvent, googleCalendarEventOwnedBy, type GoogleCalendarEventIdentity } from "./google-calendar-event";
import { normalizeAppointmentType } from "./appointments";
import { quoteItemFromRow, quotePricingModeFromNotes } from "./products";
import type { Customer } from "./types";

type Admin = ReturnType<typeof googleCalendarAdmin>;
type QueueEntry = {
  workspace_id: string; appointment_id: string; desired_version: number; lease_version: number;
  lease_token: string; lease_expires_at: string; appointment_deleted: boolean;
  event_id: string | null; event_generation: number; remote_deleted: boolean; attempts: number;
};
type Connection = {
  workspace_id: string; calendar_id: string; status: string; sync_from: string;
  refresh_token_encrypted: string;
};
type RemoteEvent = {
  id?: string; etag?: string; status?: string;
  extendedProperties?: { private?: Record<string, string> };
};
type RemoteState = { eventId: string; generation: number; deleted: boolean };

class CalendarSyncError extends Error {
  constructor(public kind: "remote" | "ownership" | "superseded" | "database" | "invalid_date", public status?: number) {
    super(kind);
  }
}

export function googleCalendarEventId(workspaceId: string, appointmentId: string, generation: number) {
  // Hex is a subset of Google's base32hex event-id alphabet. A deterministic
  // UUID-derived digest also survives an ambiguous insert response or retry.
  return `af${createHash("sha256").update(`${workspaceId}:${appointmentId}:${generation}`).digest("hex")}`;
}

function identityFor(entry: QueueEntry, state: RemoteState): GoogleCalendarEventIdentity {
  return { workspaceId: entry.workspace_id, appointmentId: entry.appointment_id, generation: state.generation };
}

async function googleRequest(token: string, calendarId: string, eventId: string | null, deadline: number, method = "GET", body?: unknown, etag?: string) {
  const remaining = deadline - Date.now();
  if (remaining < 1000) throw new CalendarSyncError("remote");
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const url = `${base}${eventId ? `/${encodeURIComponent(eventId)}` : ""}${method === "GET" ? "" : "?sendUpdates=none"}`;
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store", signal: AbortSignal.timeout(Math.min(8000, remaining)),
  });
  // Google's body can include client data; never persist or expose its errors.
  const data = response.ok && response.status !== 204 ? await response.json() as RemoteEvent : null;
  return { status: response.status, ok: response.ok, data };
}

async function ensureCurrentLease(admin: Admin, entry: QueueEntry, connection: Connection) {
  const [queue, currentConnection] = await Promise.all([
    admin.from("google_calendar_sync_queue").select("lease_token,lease_version,lease_expires_at,desired_version")
      .eq("workspace_id", entry.workspace_id).eq("appointment_id", entry.appointment_id).maybeSingle(),
    admin.from("google_calendar_connections").select("status,calendar_id")
      .eq("workspace_id", entry.workspace_id).maybeSingle(),
  ]);
  if (queue.error || currentConnection.error) throw new CalendarSyncError("database");
  if (!queue.data || queue.data.lease_token !== entry.lease_token || Number(queue.data.lease_version) !== Number(entry.lease_version)
    || Number(queue.data.desired_version) !== Number(entry.lease_version)
    || new Date(queue.data.lease_expires_at).getTime() <= Date.now() + 9000
    || currentConnection.data?.status !== "connected" || currentConnection.data.calendar_id !== connection.calendar_id) {
    throw new CalendarSyncError("superseded");
  }
}

async function loadAppointment(admin: Admin, entry: QueueEntry, connection: Connection): Promise<Customer | null> {
  if (entry.appointment_deleted) return null;
  const appointmentResult = await admin.from("appointments")
    .select("id,customer_id,quote_id,scheduled_date,scheduled_time,appointment_type,status,address,cancelled_at,created_at")
    .eq("id", entry.appointment_id).eq("workspace_id", entry.workspace_id).maybeSingle();
  if (appointmentResult.error) throw new CalendarSyncError("database");
  const appointment = appointmentResult.data;
  if (!appointment || appointment.cancelled_at || String(appointment.status || "").trim().toLocaleLowerCase("hu-HU") === "lemondva") return null;
  // A queue row must never backfill manually exported pre-connection events.
  if (!appointment.created_at || new Date(appointment.created_at).getTime() < new Date(connection.sync_from).getTime()) {
    throw new CalendarSyncError("superseded");
  }
  const customerResult = await admin.from("customers").select("id,name,city,postal_code,phone,email,address,source,status,need,notes")
    .eq("id", appointment.customer_id).eq("workspace_id", entry.workspace_id).maybeSingle();
  if (customerResult.error || !customerResult.data) throw new CalendarSyncError("database");
  const row = customerResult.data;
  let quoteItems: Customer["quoteItems"] = [];
  let quotePricingMode: Customer["quotePricingMode"] = "bundle";
  if (appointment.quote_id) {
    const [quote, items] = await Promise.all([
      admin.from("quotes").select("id,notes").eq("id", appointment.quote_id)
        .eq("customer_id", appointment.customer_id).eq("workspace_id", entry.workspace_id).maybeSingle(),
      admin.from("quote_items").select("product_name,description,quantity,unit_price")
        .eq("quote_id", appointment.quote_id).eq("workspace_id", entry.workspace_id).order("id"),
    ]);
    if (quote.error || items.error || !quote.data) throw new CalendarSyncError("database");
    quoteItems = (items.data || []).map(quoteItemFromRow);
    quotePricingMode = quotePricingModeFromNotes(quote.data.notes);
  }
  const address = appointment.address || row.address || "";
  const fullAddress = Boolean(appointment.address && /^\s*\d{4}\s+\p{L}/u.test(appointment.address));
  return {
    id: row.id, name: row.name || "", phone: row.phone || "", email: row.email || "",
    city: fullAddress ? "" : row.city || "", postalCode: fullAddress ? "" : row.postal_code || "",
    address, workAddress: address, source: row.source || "", need: row.need || "", notes: row.notes || "",
    status: appointment.status || row.status || "", date: appointment.scheduled_date || "", time: appointment.scheduled_time || "",
    appointmentType: normalizeAppointmentType(appointment.appointment_type), quoteItems, quotePricingMode,
  };
}

async function syncRemote(admin: Admin, entry: QueueEntry, connection: Connection, state: RemoteState, customer: Customer | null, deadline: number) {
  const token = await calendarAccessToken(connection);
  if (customer && state.deleted) {
    state.generation += 1;
    state.eventId = googleCalendarEventId(entry.workspace_id, entry.appointment_id, state.generation);
    state.deleted = false;
  }
  // A cancelled Google event can retain its ID as a tombstone. The next stable
  // generation is chosen deterministically, never a fresh random ID per retry.
  for (let generationAttempt = 0; generationAttempt < 3; generationAttempt += 1) {
    const identity = identityFor(entry, state);
    const remote = await googleRequest(token, connection.calendar_id, state.eventId, deadline);
    const absent = remote.status === 404 || remote.status === 410;
    if (!remote.ok && !absent) throw new CalendarSyncError("remote", remote.status);
    const deleted = remote.data?.status === "cancelled";
    if (!customer && (absent || deleted)) { state.deleted = true; return; }
    if (customer && (deleted || remote.status === 410)) {
      state.generation += 1;
      state.eventId = googleCalendarEventId(entry.workspace_id, entry.appointment_id, state.generation);
      continue;
    }
    if (!absent) {
      if (!remote.data || !googleCalendarEventOwnedBy(remote.data, identity)) throw new CalendarSyncError("ownership");
      if (!remote.data.etag) throw new CalendarSyncError("remote");
      let payload;
      if (customer) {
        try { payload = buildGoogleCalendarEvent(customer, identity); }
        catch { throw new CalendarSyncError("invalid_date"); }
      }
      await ensureCurrentLease(admin, entry, connection);
      const changed = await googleRequest(token, connection.calendar_id, state.eventId, deadline, customer ? "PATCH" : "DELETE", payload, remote.data.etag);
      if (!changed.ok && !(!customer && (changed.status === 404 || changed.status === 410))) throw new CalendarSyncError("remote", changed.status);
      state.deleted = !customer;
      return;
    }
    let payload;
    try { payload = buildGoogleCalendarEvent(customer!, identity); }
    catch { throw new CalendarSyncError("invalid_date"); }
    await ensureCurrentLease(admin, entry, connection);
    const created = await googleRequest(token, connection.calendar_id, null, deadline, "POST", { id: state.eventId, ...payload });
    if (created.status === 409) continue; // Next GET verifies ownership before adopting an ambiguous prior insert.
    if (!created.ok) throw new CalendarSyncError("remote", created.status);
    state.deleted = false;
    return;
  }
  throw new CalendarSyncError("remote", 409);
}

function safeSyncError(error: unknown) {
  if (error instanceof GoogleCalendarAuthError || error instanceof CalendarSyncError && error.status === 401) return "Csatlakoztasd újra a Google Naptárt.";
  if (error instanceof CalendarSyncError && error.kind === "ownership") return "A Google-esemény azonosítója ütközik; a meglévő eseményt nem módosítottuk.";
  if (error instanceof CalendarSyncError && error.kind === "invalid_date") return "Ellenőrizd az időpont dátumát és kezdési idejét.";
  if (error instanceof CalendarSyncError && error.kind === "superseded") return "Az időpont vagy a kapcsolat megváltozott; újrapróbáljuk.";
  return "A Google Naptár szinkronizálása késik. Az időpont mentve van; újrapróbáljuk.";
}

export async function runGoogleCalendarSync(workspaceId?: string): Promise<{ processed: number; synced: number; failed: number }> {
  const admin = googleCalendarAdmin();
  const result = { processed: 0, synced: 0, failed: 0 };
  const deadline = Date.now() + 45000;
  while (result.processed < 8 && Date.now() + 5000 < deadline) {
    const claim = await admin.rpc("claim_google_calendar_sync", { p_workspace_id: workspaceId || null, p_limit: 1, p_lease_seconds: 120 });
    if (claim.error) throw new Error("A naptár szinkronizálási sora nem érhető el.");
    const entry = (claim.data as QueueEntry[] | null)?.[0];
    if (!entry) break;
    result.processed += 1;
    const state: RemoteState = { eventId: entry.event_id || googleCalendarEventId(entry.workspace_id, entry.appointment_id, entry.event_generation), generation: entry.event_generation, deleted: entry.remote_deleted };
    let failure: unknown;
    let connection: Connection | null = null;
    try {
      const connectionResult = await admin.from("google_calendar_connections")
        .select("workspace_id,calendar_id,status,sync_from,refresh_token_encrypted").eq("workspace_id", entry.workspace_id).maybeSingle();
      if (connectionResult.error) throw new CalendarSyncError("database");
      connection = connectionResult.data as Connection | null;
      if (!connection || connection.status !== "connected") throw new CalendarSyncError("superseded");
      const customer = await loadAppointment(admin, entry, connection);
      await syncRemote(admin, entry, connection, state, customer, deadline);
    } catch (error) {
      failure = error;
      if (connection && (error instanceof GoogleCalendarAuthError || error instanceof CalendarSyncError && error.status === 401)) {
        await admin.from("google_calendar_connections").update({ status: "reauth_required", last_error: safeSyncError(error) })
          .eq("workspace_id", entry.workspace_id).eq("status", "connected")
          .eq("refresh_token_encrypted", connection.refresh_token_encrypted).eq("calendar_id", connection.calendar_id);
      }
    }
    const finish = await admin.rpc("finish_google_calendar_sync", {
      p_workspace_id: entry.workspace_id, p_appointment_id: entry.appointment_id,
      p_lease_token: entry.lease_token, p_version: entry.lease_version, p_success: !failure,
      p_event_id: state.eventId, p_event_generation: state.generation, p_remote_deleted: state.deleted,
      p_error: failure ? safeSyncError(failure) : null,
      p_retry_after_seconds: Math.min(3600, 30 * 2 ** Math.min(entry.attempts, 7)),
    });
    if (failure || finish.error || !finish.data) result.failed += 1;
    else result.synced += 1;
  }
  return result;
}
