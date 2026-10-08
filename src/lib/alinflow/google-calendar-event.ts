import type { Customer } from "./types";
import { displayAddress, ft } from "./format";
import { cleanQuoteItems, climateSummary, isQuoteAlternatives, itemName, itemQuantity, itemTotal, total } from "./products";
import { appointmentDurationMinutes, appointmentTimeRangeLabel, appointmentTypeLabel, appointmentWorkSummary, isInstallationAppointment, normalizeAppointmentTimeInput } from "./appointments";

export const GOOGLE_CALENDAR_TIME_ZONE = "Europe/Budapest";

export function googleCalendarDetails(customer: Customer, timeRangeLabel = appointmentTimeRangeLabel(customer)) {
  const workLabel = appointmentTypeLabel(customer.appointmentType);
  const installation = isInstallationAppointment(customer.appointmentType);
  const items = cleanQuoteItems(customer.quoteItems || []);
  const price = !installation || !items.length ? "" : isQuoteAlternatives(customer.quotePricingMode)
    ? items.map((item, index) => `${index + 1}. lehetőség: ${itemQuantity(item)} db ${itemName(item)} – ${ft(itemTotal(item))}`).join(" | ")
    : ft(total(items));
  const work = installation ? climateSummary(customer.quoteItems) : appointmentWorkSummary(customer);
  return {
    summary: `${workLabel} – ${customer.name || "ügyfél"}`,
    description: [
      customer.name ? `Ügyfél: ${customer.name}` : "",
      customer.phone ? `Telefon: ${customer.phone}` : "",
      customer.email ? `Email: ${customer.email}` : "",
      installation ? `Klíma: ${work} – szereléssel együtt${price ? `: ${price}` : ""}` : `Munka: ${work}`,
      customer.need ? `Igény: ${customer.need}` : "",
      customer.notes ? `Megjegyzés: ${customer.notes}` : "",
      `Időpont típusa: ${workLabel}`,
      `Idősáv: ${timeRangeLabel}`,
      customer.status ? `Státusz: ${customer.status}` : "",
    ].filter(Boolean).join("\n"),
    location: displayAddress(customer),
  };
}

const zonedFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: GOOGLE_CALENDAR_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function zonedParts(timestamp: number) {
  const parts = Object.fromEntries(zonedFormat.formatToParts(timestamp).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

function zoneOffset(timestamp: number) {
  const part = zonedParts(timestamp);
  return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second) - timestamp;
}

function calendarStart(date: string | undefined, time: string | undefined) {
  const normalizedTime = normalizeAppointmentTimeInput(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !normalizedTime) throw new Error("Hiányzó vagy hibás időpont.");
  const [year, month, day] = date!.split("-").map(Number);
  const [hour, minute] = normalizedTime.split(":").map(Number);
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(wallTime).toISOString().slice(0, 10) !== date) throw new Error("Hibás időpontdátum.");
  // Both sides of the DST transition are considered. An ambiguous autumn time
  // uses its first occurrence; a nonexistent spring time must be corrected.
  const offsets = new Set([-86400000, 0, 86400000].map((delta) => zoneOffset(wallTime + delta)));
  const candidates = [...offsets].map((offset) => wallTime - offset).filter((value) => {
    const part = zonedParts(value);
    return part.year === year && part.month === month && part.day === day && part.hour === hour && part.minute === minute;
  });
  if (!candidates.length) throw new Error("Az óraátállítás miatt ez a helyi időpont nem létezik.");
  return Math.min(...candidates);
}

function calendarDateTime(timestamp: number) {
  const part = zonedParts(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  const offset = zoneOffset(timestamp) / 60000;
  return `${part.year}-${pad(part.month)}-${pad(part.day)}T${pad(part.hour)}:${pad(part.minute)}:00${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export type GoogleCalendarEventIdentity = { workspaceId: string; appointmentId: string; generation: number };

export function googleCalendarEventOwnedBy(event: { extendedProperties?: { private?: Record<string, string> } }, identity: GoogleCalendarEventIdentity) {
  const owner = event.extendedProperties?.private;
  return owner?.alinflow_workspace_id === identity.workspaceId
    && owner.alinflow_appointment_id === identity.appointmentId
    && owner.alinflow_generation === String(identity.generation);
}

export function buildGoogleCalendarEvent(customer: Customer, identity: GoogleCalendarEventIdentity) {
  const start = calendarStart(customer.date, customer.time);
  const end = start + appointmentDurationMinutes(customer.appointmentType, customer.quoteItems, customer.time) * 60000;
  const startDateTime = calendarDateTime(start);
  const endDateTime = calendarDateTime(end);
  return {
    ...googleCalendarDetails(customer, `${startDateTime.slice(11, 16)}–${endDateTime.slice(11, 16)}`),
    start: { dateTime: startDateTime, timeZone: GOOGLE_CALENDAR_TIME_ZONE },
    end: { dateTime: endDateTime, timeZone: GOOGLE_CALENDAR_TIME_ZONE },
    extendedProperties: { private: {
      alinflow_workspace_id: identity.workspaceId,
      alinflow_appointment_id: identity.appointmentId,
      alinflow_generation: String(identity.generation),
    } },
    // No attendees or calendar-default email reminders: AlinFlow sends its own
    // customer confirmation, and synchronization must not send a second one.
    reminders: { useDefault: false },
  };
}
