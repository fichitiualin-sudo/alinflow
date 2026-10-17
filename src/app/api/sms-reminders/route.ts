import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/alinflow/server-auth";
import { readCalendarBody } from "@/lib/alinflow/google-calendar-auth";
import { loadWorkspaceEmailSettings } from "@/lib/alinflow/email-identity";
import { settingsBrandName } from "@/lib/alinflow/workspace-settings";
import { quoteItemFromRow, quotePricingModeFromNotes } from "@/lib/alinflow/products";
import { buildSmsReminder, smsReminderDeviceCount, smsReminderToday } from "@/lib/alinflow/sms-reminders";
import type { SmsReminderEntry } from "@/lib/alinflow/sms-reminders-client";
import type { Customer } from "@/lib/alinflow/types";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPLETE = ["survey_done", "maintenance_done", "installation_done", "work_closed"];
const APPOINTMENT_COLUMNS = "id,workspace_id,customer_id,quote_id,scheduled_date,scheduled_time,appointment_type,status,address,cancelled_at,stock_deducted_at,updated_at";
const noStore = { "Cache-Control": "private, no-store", "Vary": "Authorization" };

function failure(error: unknown) {
  return Response.json({ error: error instanceof ApiError ? error.message : "Az SMS-emlékeztető nem tölthető be. Próbáld újra." },
    { status: error instanceof ApiError ? error.status : 500, headers: noStore });
}
function identifier(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new ApiError(`Hiányzó vagy hibás ${label}.`, 400);
  return value.toLowerCase();
}
async function authorize(request: Request, rawWorkspace: unknown) {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) throw new ApiError("Jelentkezz be az SMS-emlékeztetőkhöz.", 401);
  const workspaceId = identifier(rawWorkspace, "munkaterület");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError("A kapcsolat jelenleg nem érhető el.", 503);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } } });
  const user = await client.auth.getUser(token);
  if (user.error || !user.data.user) throw new ApiError("A bejelentkezés lejárt.", 401);
  const [member, workspace] = await Promise.all([
    client.from("workspace_members").select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", user.data.user.id).eq("active", true).maybeSingle(),
    client.from("workspaces").select("id").eq("id", workspaceId).eq("active", true).maybeSingle(),
  ]);
  if (member.error || !member.data || workspace.error || !workspace.data) throw new ApiError("Nincs hozzáférés ehhez a munkaterülethez.", 403);
  return { client, workspaceId };
}
async function rows(query: any, label: string): Promise<any[]> {
  const result = await query;
  if (result.error) throw new ApiError(`${label} nem tölthető be. Próbáld újra.`, 503);
  // Fail visibly instead of silently truncating an unexpectedly large day's data.
  if ((result.data || []).length >= 1000) throw new ApiError("Túl sok adat érkezett. Nyisd meg az adott időpont SMS-emlékeztetőjét.", 422);
  return result.data || [];
}
const unique = (values: Array<string | null | undefined>): string[] => [...new Set(values.filter(Boolean) as string[])];

type LoadedEntry = { entry: SmsReminderEntry; appointmentVersion: string; customerVersion: string };
async function loadReminders(client: SupabaseClient, workspaceId: string, options: { date?: string; appointmentId?: string; customerId?: string }, today: string): Promise<LoadedEntry[]> {
  let query = client.from("appointments").select(APPOINTMENT_COLUMNS).eq("workspace_id", workspaceId).is("cancelled_at", null)
    .in("appointment_type", ["installation", "maintenance", "survey"]);
  if (options.appointmentId) query = query.eq("id", options.appointmentId).eq("customer_id", options.customerId!);
  else query = query.eq("scheduled_date", options.date!);
  const appointments = await rows(query.order("scheduled_time").order("id"), "Az időpontlista");
  if (!appointments.length) return [];
  const ids = appointments.map(a => a.id), customerIds = unique(appointments.map(a => a.customer_id));
  const [customers, completed, links, settings, receipts] = await Promise.all([
    rows(client.from("customers").select("id,name,phone,updated_at").eq("workspace_id", workspaceId).in("id", customerIds), "Az ügyféladat"),
    rows(client.from("documents").select("appointment_id,customer_id").eq("workspace_id", workspaceId).in("appointment_id", ids).in("document_type", COMPLETE), "A lezárási állapot"),
    appointments.some(a => a.appointment_type === "maintenance")
      ? rows(client.from("maintenance_appointment_items").select("maintenance_appointment_id,installation_appointment_id,customer_id")
        .eq("workspace_id", workspaceId).in("maintenance_appointment_id", ids), "A karbantartáshoz tartozó klíma") : Promise.resolve([]),
    loadWorkspaceEmailSettings(client, workspaceId),
    rows(client.from("appointment_sms_receipts").select("appointment_id,customer_id,content_key,acknowledged_at")
      .eq("workspace_id", workspaceId).in("appointment_id", ids), "Az SMS-visszajelzés"),
  ]);
  const customerById = new Map(customers.map(c => [c.id, c]));
  const completedIds = new Set(completed.filter(d => appointments.some(a => a.id === d.appointment_id && a.customer_id === d.customer_id)).map(d => d.appointment_id));
  const validLinks = links.filter(l => appointments.some(a => a.id === l.maintenance_appointment_id && a.customer_id === l.customer_id));
  const installationIds = unique(validLinks.map(l => l.installation_appointment_id));
  const installations = installationIds.length ? await rows(client.from("appointments").select(APPOINTMENT_COLUMNS)
    .eq("workspace_id", workspaceId).in("id", installationIds).in("customer_id", customerIds).eq("appointment_type", "installation"), "A telepítési adatok") : [];
  const allAppointments = [...appointments, ...installations];
  const quoteIds = unique(allAppointments.map(a => a.quote_id));
  const [directQuotes, fallbackQuotes] = await Promise.all([
    quoteIds.length ? rows(client.from("quotes").select("id,customer_id,appointment_id,notes").eq("workspace_id", workspaceId).in("id", quoteIds), "Az időpont tételei") : Promise.resolve([]),
    rows(client.from("quotes").select("id,customer_id,appointment_id,notes").eq("workspace_id", workspaceId).in("appointment_id", allAppointments.map(a => a.id)).order("created_at", { ascending: false }), "Az időpont tételei"),
  ]);
  const quotes = [...directQuotes, ...fallbackQuotes];
  const matchingQuote = (a: any) => quotes.find(q => q.id === a.quote_id && q.customer_id === a.customer_id && (!q.appointment_id || q.appointment_id === a.id))
    || fallbackQuotes.find(q => q.appointment_id === a.id && q.customer_id === a.customer_id);
  const matchingQuoteIds = unique(allAppointments.map(a => matchingQuote(a)?.id));
  const items = matchingQuoteIds.length ? await rows(client.from("quote_items").select("quote_id,product_name,description,quantity,unit_price")
    .eq("workspace_id", workspaceId).in("quote_id", matchingQuoteIds).order("id"), "A klímák darabszáma") : [];
  const climateItems = (a: any) => {
    const q = matchingQuote(a);
    return q ? items.filter(i => i.quote_id === q.id).map(quoteItemFromRow) : [];
  };
  const brand = settingsBrandName(settings);
  return appointments.flatMap(a => {
    const c = customerById.get(a.customer_id);
    if (!c || completedIds.has(a.id)) return [];
    const selectedInstallations = validLinks.filter(l => l.maintenance_appointment_id === a.id)
      .flatMap(l => installations.filter(i => i.id === l.installation_appointment_id && i.customer_id === a.customer_id));
    // Maintenance selection is authoritative, matching the appointment loader.
    const maintenanceItems = selectedInstallations.flatMap(i => {
      const count = smsReminderDeviceCount({ quoteItems: climateItems(i), quotePricingMode: quotePricingModeFromNotes(matchingQuote(i)?.notes) } as Customer);
      return count > 0 ? [{ productId: "", productName: "Karbantartott klíma", quantity: count }] : [];
    });
    const work: Customer = { id: c.id, name: c.name || "", phone: c.phone || "", email: "", city: "", address: a.address || "",
      source: "", need: "", status: a.status || "", activeAppointmentId: a.id,
      stockDeducted: a.appointment_type === "installation" && Boolean(a.stock_deducted_at),
      appointmentType: a.appointment_type, date: a.scheduled_date || "", time: a.scheduled_time || "",
      quoteItems: a.appointment_type === "maintenance" && maintenanceItems.length ? maintenanceItems : climateItems(a),
      quotePricingMode: a.appointment_type === "maintenance" ? "bundle" : quotePricingModeFromNotes(matchingQuote(a)?.notes) };
    const draft = buildSmsReminder(work, brand, today);
    if (!draft) return [];
    const contentKey = createHash("sha256").update(draft.fingerprint).digest("hex");
    const history = receipts.filter(r => r.appointment_id === a.id && r.customer_id === c.id);
    const matching = history.find(r => r.content_key === contentKey);
    return [{ appointmentVersion: a.updated_at, customerVersion: c.updated_at,
      entry: { appointmentId: a.id, customerId: c.id, customerName: c.name || "Ügyfél", appointmentType: a.appointment_type,
        date: draft.date, time: draft.time, arrivalWindow: draft.arrivalWindow, phone: draft.phone, text: draft.text,
        contentKey, encoding: draft.encoding, acknowledgedAt: matching?.acknowledged_at || null,
        changedSinceAcknowledgement: history.length > 0 && !matching } }];
  });
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { client, workspaceId } = await authorize(request, params.get("workspaceId"));
    const today = smsReminderToday();
    const options: { date?: string; appointmentId?: string; customerId?: string } = {};
    if (params.has("appointmentId")) {
      options.appointmentId = identifier(params.get("appointmentId"), "időpont");
      options.customerId = identifier(params.get("customerId"), "ügyfél");
    } else {
      const days = params.get("days") || "1";
      if (!["1", "2", "3"].includes(days)) throw new ApiError("Válassz 1, 2 vagy 3 napot.", 400);
      const date = new Date(`${today}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + Number(days));
      options.date = date.toISOString().slice(0, 10);
    }
    const data = await loadReminders(client, workspaceId, options, today);
    if (options.appointmentId && !data.length) throw new ApiError("Az időpont nem elérhető, már lezárult, vagy nem jövőbeli időpont.", 404);
    return Response.json({ entries: data.map(d => d.entry), date: options.date || data[0]?.entry.date || today }, { headers: noStore });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const body = await readCalendarBody(request);
    const { client, workspaceId } = await authorize(request, body.workspaceId);
    const appointmentId = identifier(body.appointmentId, "időpont"), customerId = identifier(body.customerId, "ügyfél");
    if (typeof body.contentKey !== "string" || !/^[a-f0-9]{64}$/.test(body.contentKey)) throw new ApiError("Frissítsd az SMS-előnézetet.", 400);
    // Re-read saved data: the browser supplies no recipient, message or company identity.
    const current = (await loadReminders(client, workspaceId, { appointmentId, customerId }, smsReminderToday()))[0];
    if (!current || current.entry.contentKey !== body.contentKey) throw new ApiError("Az időpont vagy az adatok megváltoztak. Frissítsd az SMS-előnézetet.", 409);
    if (!current.entry.phone) throw new ApiError("Előbb javítsd az ügyfél telefonszámát.", 400);
    const result = await client.rpc("acknowledge_appointment_sms", {
      p_workspace_id: workspaceId, p_customer_id: customerId, p_appointment_id: appointmentId,
      p_content_key: current.entry.contentKey, p_appointment_updated_at: current.appointmentVersion,
      p_customer_updated_at: current.customerVersion,
    });
    if (result.error) {
      if (result.error.code === "PT409") throw new ApiError("Az adatok közben megváltoztak. Frissítsd az SMS-előnézetet.", 409);
      if (result.error.code === "42501") throw new ApiError("Az időponthoz már nincs hozzáférésed.", 403);
      if (result.error.code === "PT400") throw new ApiError("Ehhez az időponthoz már nem rögzíthető emlékeztető.", 409);
      throw new ApiError("Az Elküldtem jelölés mentése nem sikerült. Próbáld újra; ez nem küldi újra az SMS-t.", 503);
    }
    const receipt = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!receipt?.acknowledged_at) throw new ApiError("A mentés visszaigazolása hiányzik. Próbáld újra a jelölést.", 503);
    return Response.json({ acknowledgedAt: receipt.acknowledged_at }, { headers: noStore });
  } catch (error) { return failure(error); }
}
