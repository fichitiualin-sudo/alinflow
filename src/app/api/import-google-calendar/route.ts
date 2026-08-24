import { createHash, createSign, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type GoogleServiceAccount = {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

type GoogleCalendarEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
};

type GoogleEventsResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  error?: { message?: string };
};

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

type AppointmentRow = {
  id: string;
  customer_id: string;
  title: string | null;
  scheduled_date: string;
  scheduled_time: string;
  appointment_type: string;
  quote_id: string | null;
  status: string | null;
  address: string | null;
  notes: string | null;
};

type EventLinkRow = {
  google_event_id: string;
  appointment_id: string;
};

type ParsedEvent = {
  eventId: string;
  summary: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  need: string;
  notes: string;
  appointmentType: "installation" | "survey" | "maintenance";
  scheduledDate: string;
  scheduledTime: string;
  updatedAt: string | null;
  recognized: boolean;
};

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalized(value: unknown) {
  return safeText(value)
    .toLocaleLowerCase("hu-HU")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedPhone(value: unknown) {
  const digits = safeText(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0036")) return digits.slice(4);
  if (digits.startsWith("36")) return digits.slice(2);
  if (digits.startsWith("06")) return digits.slice(2);
  return digits;
}

function normalizedEmail(value: unknown) {
  return safeText(value).toLocaleLowerCase("hu-HU");
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function serviceAccountFromEnvironment(): GoogleServiceAccount {
  const raw = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON || "";
  const encoded = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_BASE64 || "";
  if (!raw && !encoded) {
    throw new Error("Hiányzik a GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON vagy GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_BASE64 környezeti változó.");
  }

  try {
    const json = raw || Buffer.from(encoded, "base64").toString("utf8");
    const account = JSON.parse(json) as GoogleServiceAccount;
    if (!account.client_email || !account.private_key) throw new Error("Hiányos szolgáltatásfiók.");
    account.private_key = account.private_key.replace(/\\n/g, "\n");
    return account;
  } catch (error: any) {
    throw new Error(`A Google szolgáltatásfiók beállítása nem olvasható: ${error?.message || "hibás JSON"}`);
  }
}

async function googleAccessToken(account: GoogleServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = [
    base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64Url(JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      aud: account.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })),
  ].join(".");
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key as string, "base64url")}`;

  const response = await fetch(account.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) {
    throw new Error(body?.error_description || body?.error || "A Google hozzáférési token nem kérhető le.");
  }
  return String(body.access_token);
}

async function futureCalendarEvents(calendarId: string, accessToken: string) {
  const events: GoogleCalendarEvent[] = [];
  let pageToken = "";

  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({
      timeMin: new Date().toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      showDeleted: "false",
      maxResults: "2500",
      timeZone: "Europe/Budapest",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    const body = (await response.json().catch(() => ({}))) as GoogleEventsResponse;
    if (!response.ok) {
      throw new Error(body.error?.message || `A Google Naptár nem olvasható (${response.status}).`);
    }
    events.push(...(body.items || []));
    pageToken = safeText(body.nextPageToken);
    if (!pageToken) break;
  }

  return events;
}

function budapestDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function descriptionFields(description: string) {
  const fields = new Map<string, string>();
  description.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([^:]+):\s*(.*?)\s*$/);
    if (match) fields.set(normalized(match[1]), safeText(match[2]));
  });
  return fields;
}

function firstField(fields: Map<string, string>, names: string[]) {
  for (const name of names) {
    const value = fields.get(normalized(name));
    if (value) return value;
  }
  return "";
}

function appointmentTypeFromText(value: string) {
  const text = normalized(value);
  if (text.includes("karbantart")) return "maintenance" as const;
  if (text.includes("felmer")) return "survey" as const;
  if (text.includes("szerel") || text.includes("telepit")) return "installation" as const;
  return null;
}

function nameFromSummary(summary: string) {
  return safeText(summary
    .replace(/^\s*(szerel[eé]s|telep[ií]t[eé]s|felm[eé]r[eé]s|karbantart[aá]s)\s*[–—\-:]\s*/i, "")
    .replace(/\s*[–—\-:]?\s*(szerel[eé]s|telep[ií]t[eé]s|felm[eé]r[eé]s|karbantart[aá]s)\s*$/i, ""));
}

function parseGoogleEvent(event: GoogleCalendarEvent): ParsedEvent | null {
  const eventId = safeText(event.id);
  const dateTime = safeText(event.start?.dateTime);
  const scheduled = dateTime ? budapestDateTime(dateTime) : null;
  if (!eventId || event.status === "cancelled" || !scheduled) return null;

  const summary = safeText(event.summary);
  const description = safeText(event.description);
  const fields = descriptionFields(description);
  const explicitType = appointmentTypeFromText(firstField(fields, ["Időpont típusa", "Munka típusa"]));
  const inferredType = appointmentTypeFromText(`${summary}\n${description}`);
  const appointmentType = explicitType || inferredType || "installation";
  const structured = ["ugyfel", "telefon", "email", "idopont tipusa", "munka tipusa"].some((key) => fields.has(key));
  const recognized = Boolean(explicitType || inferredType || structured);
  const name = firstField(fields, ["Ügyfél", "Név"]) || nameFromSummary(summary);

  return {
    eventId,
    summary,
    name,
    phone: firstField(fields, ["Telefon", "Telefonszám"]),
    email: firstField(fields, ["Email", "E-mail"]),
    address: safeText(event.location) || firstField(fields, ["Cím", "Helyszín"]),
    need: firstField(fields, ["Igény", "Munka", "Klíma"]),
    notes: ["Google Naptárból importálva.", description, event.htmlLink ? `Google esemény: ${event.htmlLink}` : ""].filter(Boolean).join("\n"),
    appointmentType,
    scheduledDate: scheduled.date,
    scheduledTime: scheduled.time,
    updatedAt: safeText(event.updated) || null,
    recognized,
  };
}

function cityFromAddress(address: string) {
  const match = safeText(address).match(/^\s*(\d{4})\s+([^,]+?)(?:,|$)/);
  return { postalCode: match?.[1] || "", city: match?.[2]?.trim() || "" };
}

function appointmentKey(customerId: string, date: string, time: string, type: string) {
  return `${customerId}|${date}|${time.slice(0, 5)}|${type}`;
}

function uniqueCustomer(matches: CustomerRow[]) {
  const unique = [...new Map(matches.map((customer) => [customer.id, customer])).values()];
  return unique.length === 1 ? unique[0] : null;
}

function matchCustomer(parsed: ParsedEvent, customers: CustomerRow[]) {
  const email = normalizedEmail(parsed.email);
  if (email) {
    const match = uniqueCustomer(customers.filter((customer) => normalizedEmail(customer.email) === email));
    if (match) return match;
  }

  const phone = normalizedPhone(parsed.phone);
  if (phone) {
    const match = uniqueCustomer(customers.filter((customer) => normalizedPhone(customer.phone) === phone));
    if (match) return match;
  }

  const name = normalized(parsed.name);
  const address = normalized(parsed.address);
  if (name && address) {
    const match = uniqueCustomer(customers.filter((customer) => normalized(customer.name) === name && normalized(customer.address) === address));
    if (match) return match;
  }

  if (name) return uniqueCustomer(customers.filter((customer) => normalized(customer.name) === name));
  return null;
}

async function authenticatedClient(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!url || !anonKey) throw new Error("Hiányzik a Supabase környezeti beállítás.");
  if (!token) return { error: "A naptár frissítéséhez be kell jelentkezni.", status: 401 } as const;

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { error: "A bejelentkezés nem ellenőrizhető.", status: 401 } as const;
  return { supabase, userId: data.user.id };
}

export async function POST(request: Request) {
  try {
    const auth = await authenticatedClient(request);
    if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    const workspaceId = safeText(body?.workspaceId);
    if (!workspaceId) return Response.json({ error: "Hiányzik az aktív munkaterület." }, { status: 400 });

    const { data: membership, error: membershipError } = await auth.supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", auth.userId)
      .eq("active", true)
      .maybeSingle();
    if (membershipError || !membership) {
      return Response.json({ error: "Ehhez a munkaterülethez nincs hozzáférésed." }, { status: 403 });
    }

    const { data: settings, error: settingsError } = await auth.supabase
      .from("workspace_settings")
      .select("calendar_settings")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (settingsError) {
      console.error("Google Calendar settings lookup failed", settingsError);
      return Response.json(
        { error: `Google Naptár beállítási adatbázis-hiba (${settingsError.code || "ismeretlen"}): ${settingsError.message}` },
        { status: 409 },
      );
    }
    const calendarId = safeText((settings?.calendar_settings as any)?.googleCalendarId);
    if (!calendarId) {
      return Response.json({ error: "A Beállításokban add meg az importálandó Google naptár azonosítóját." }, { status: 400 });
    }

    const account = serviceAccountFromEnvironment();
    const accessToken = await googleAccessToken(account);
    let rawEvents: GoogleCalendarEvent[];
    try {
      rawEvents = await futureCalendarEvents(calendarId, accessToken);
    } catch (error: any) {
      throw new Error(`${error?.message || "A Google Naptár nem olvasható"} A naptárat olvasási joggal oszd meg ezzel a szolgáltatásfiókkal: ${account.client_email}`);
    }
    const parsedEvents = rawEvents.map(parseGoogleEvent).filter((event): event is ParsedEvent => Boolean(event));
    const eventIds = parsedEvents.map((event) => event.eventId);

    const [{ data: customerData, error: customerError }, { data: appointmentData, error: appointmentError }] = await Promise.all([
      auth.supabase.from("customers").select("id,name,phone,email,address").eq("workspace_id", workspaceId),
      auth.supabase
        .from("appointments")
        .select("id,customer_id,title,scheduled_date,scheduled_time,appointment_type,quote_id,status,address,notes")
        .eq("workspace_id", workspaceId),
    ]);
    if (customerError) throw customerError;
    if (appointmentError) throw appointmentError;

    let links: EventLinkRow[] = [];
    if (eventIds.length) {
      const { data, error } = await auth.supabase
        .from("google_calendar_event_links")
        .select("google_event_id,appointment_id")
        .eq("workspace_id", workspaceId)
        .eq("google_calendar_id", calendarId);
      if (error) {
        console.error("Google Calendar event link lookup failed", error);
        return Response.json(
          { error: `Google Naptár kapcsolati adatbázis-hiba (${error.code || "ismeretlen"}): ${error.message}` },
          { status: 409 },
        );
      }
      const eventIdSet = new Set(eventIds);
      links = ((data || []) as EventLinkRow[]).filter((link) => eventIdSet.has(link.google_event_id));
    }

    const customers = (customerData || []) as CustomerRow[];
    const appointments = (appointmentData || []) as AppointmentRow[];
    const customerById = new Map(customers.map((customer) => [customer.id, customer]));
    const appointmentById = new Map(appointments.map((appointment) => [appointment.id, appointment]));
    const linkByEventId = new Map(links.map((link) => [link.google_event_id, link]));
    const linkedAppointmentIds = new Set(links.map((link) => link.appointment_id));
    const appointmentsByKey = new Map<string, AppointmentRow[]>();
    appointments.forEach((appointment) => {
      const key = appointmentKey(appointment.customer_id, appointment.scheduled_date, appointment.scheduled_time, appointment.appointment_type);
      appointmentsByKey.set(key, [...(appointmentsByKey.get(key) || []), appointment]);
    });

    let imported = 0;
    let updated = 0;
    let linked = 0;
    let skipped = rawEvents.length - parsedEvents.length;
    const issues: string[] = [];

    for (const parsed of parsedEvents) {
      if (!parsed.recognized) {
        skipped += 1;
        issues.push(`${parsed.summary || "Névtelen esemény"}: az esemény típusa nem felismerhető.`);
        continue;
      }

      const existingLink = linkByEventId.get(parsed.eventId);
      const linkedAppointment = existingLink ? appointmentById.get(existingLink.appointment_id) : null;
      let customer = linkedAppointment ? customerById.get(linkedAppointment.customer_id) || null : matchCustomer(parsed, customers);

      if (!customer) {
        if (!parsed.name || (!parsed.email && !parsed.phone && !parsed.address)) {
          skipped += 1;
          issues.push(`${parsed.summary || "Névtelen esemény"}: nincs elég adat az ügyfél biztonságos azonosításához.`);
          continue;
        }
        const location = cityFromAddress(parsed.address);
        const id = randomUUID();
        const { data, error } = await auth.supabase
          .from("customers")
          .insert({
            id,
            workspace_id: workspaceId,
            name: parsed.name,
            phone: parsed.phone || null,
            email: normalizedEmail(parsed.email) || null,
            city: location.city || null,
            postal_code: location.postalCode || null,
            address: parsed.address || null,
            source: "Google Naptár import",
            status: "Időpont foglalva",
            need: parsed.need || null,
            notes: parsed.notes || null,
            created_by: auth.userId,
          })
          .select("id,name,phone,email,address")
          .single();
        if (error) {
          skipped += 1;
          issues.push(`${parsed.summary}: az ügyfél nem menthető (${error.message}).`);
          continue;
        }
        customer = data as CustomerRow;
        customers.push(customer);
        customerById.set(customer.id, customer);
      }

      let appointmentId = existingLink?.appointment_id || "";
      let action: "imported" | "updated" | "linked" | null = existingLink ? "updated" : null;
      if (!appointmentId) {
        const key = appointmentKey(customer.id, parsed.scheduledDate, parsed.scheduledTime, parsed.appointmentType);
        const candidates = appointmentsByKey.get(key) || [];
        if (candidates.length === 1) {
          if (linkedAppointmentIds.has(candidates[0].id)) {
            skipped += 1;
            issues.push(`${parsed.summary}: az AlinFlow időpont már másik Google-eseményhez kapcsolódik.`);
            continue;
          }
          appointmentId = candidates[0].id;
          action = "linked";
        } else if (candidates.length > 1) {
          skipped += 1;
          issues.push(`${parsed.summary}: több azonos AlinFlow időpont található, ezért nem kapcsoltam automatikusan.`);
          continue;
        }
      }

      if (!appointmentId || existingLink) {
        const { data, error } = await auth.supabase.rpc("save_appointment_with_job_mirror", {
          p_appointment_id: appointmentId || null,
          p_customer_id: customer.id,
          p_quote_id: linkedAppointment?.quote_id || null,
          p_title: linkedAppointment?.title || parsed.name || parsed.summary,
          p_scheduled_date: parsed.scheduledDate,
          p_scheduled_time: parsed.scheduledTime,
          p_appointment_type: parsed.appointmentType,
          p_status: linkedAppointment?.status || "Időpont foglalva",
          p_address: linkedAppointment?.address || parsed.address || null,
          p_notes: linkedAppointment?.notes || parsed.notes || null,
          p_created_by: auth.userId,
          p_workspace_id: workspaceId,
        });
        if (error) {
          skipped += 1;
          issues.push(`${parsed.summary}: az időpont nem menthető (${error.message}).`);
          continue;
        }
        const row = Array.isArray(data) ? data[0] : data;
        appointmentId = safeText(row?.appointment_id);
        if (!appointmentId) {
          skipped += 1;
          issues.push(`${parsed.summary}: a mentés nem adott vissza időpont-azonosítót.`);
          continue;
        }
        if (!existingLink) {
          action = "imported";
          const createdAppointment: AppointmentRow = {
            id: appointmentId,
            customer_id: customer.id,
            title: parsed.name || parsed.summary,
            scheduled_date: parsed.scheduledDate,
            scheduled_time: parsed.scheduledTime,
            appointment_type: parsed.appointmentType,
            quote_id: null,
            status: "Időpont foglalva",
            address: parsed.address || null,
            notes: parsed.notes || null,
          };
          appointments.push(createdAppointment);
          appointmentById.set(appointmentId, createdAppointment);
          const key = appointmentKey(customer.id, parsed.scheduledDate, parsed.scheduledTime, parsed.appointmentType);
          appointmentsByKey.set(key, [...(appointmentsByKey.get(key) || []), createdAppointment]);
        }
      }

      const { error: linkError } = await auth.supabase
        .from("google_calendar_event_links")
        .upsert({
          workspace_id: workspaceId,
          google_calendar_id: calendarId,
          google_event_id: parsed.eventId,
          appointment_id: appointmentId,
          google_updated_at: parsed.updatedAt,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: "workspace_id,google_calendar_id,google_event_id" });
      if (linkError) {
        issues.push(`${parsed.summary}: az eseménykapcsolat nem menthető (${linkError.message}).`);
        continue;
      }
      linkedAppointmentIds.add(appointmentId);
      if (action === "imported") imported += 1;
      if (action === "updated") updated += 1;
      if (action === "linked") linked += 1;
    }

    return Response.json({
      imported,
      updated,
      linked,
      skipped,
      totalFutureEvents: rawEvents.length,
      issues: issues.slice(0, 20),
      serviceAccountEmail: account.client_email,
    });
  } catch (error: any) {
    const reference = createHash("sha256").update(`${Date.now()}-${error?.message || "calendar"}`).digest("hex").slice(0, 10);
    return Response.json({ error: error?.message || "Ismeretlen Google Naptár import hiba.", reference }, { status: 500 });
  }
}
