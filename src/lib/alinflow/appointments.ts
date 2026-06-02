import type { AppointmentType, QuoteItem } from "./types";

type AppointmentLike = {
  time?: string;
  appointmentType?: string | null;
  quoteItems?: QuoteItem[];
};

export const DEFAULT_APPOINTMENT_TYPE: AppointmentType = "installation";

function itemQuantity(item: QuoteItem) {
  const quantity = Number(item.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function totalQuantity(items: QuoteItem[] = []) {
  return items.reduce((sum, item) => sum + itemQuantity(item), 0);
}

export const APPOINTMENT_TYPES: { value: AppointmentType; label: string; shortLabel: string; durationLabel: string; description: string }[] = [
  { value: "installation", label: "Szerelés", shortLabel: "Szerelés", durationLabel: "meglévő szerelési logika szerint", description: "Alapértelmezett klímaszerelési időpont" },
  { value: "survey", label: "Felmérés", shortLabel: "Felmérés", durationLabel: "1 óra", description: "Opcionális, 1 órás felmérési időpont" },
  { value: "maintenance", label: "Karbantartás", shortLabel: "Karbantartás", durationLabel: "1 óra", description: "1 órás karbantartási időpont" },
];

export const APPOINTMENT_TYPE_OPTIONS = APPOINTMENT_TYPES;
export const RECOMMENDED_APPOINTMENT_SLOTS = ["08:00", "12:00", "16:00"];
export const ONE_HOUR_APPOINTMENT_SLOTS = RECOMMENDED_APPOINTMENT_SLOTS;
export const INSTALLATION_APPOINTMENT_SLOTS = RECOMMENDED_APPOINTMENT_SLOTS;

export type AppointmentInterval = { start: number; end: number };

function quantity(items?: QuoteItem[]) {
  return (items || []).reduce((sum, item) => {
    const numeric = Number(item.quantity);
    return sum + (Number.isFinite(numeric) && numeric > 0 ? numeric : 1);
  }, 0);
}

export function normalizeAppointmentType(value?: string | null): AppointmentType {
  const normalized = String(value || "").trim().toLowerCase();
  if (["survey", "felmeres", "felmérés"].includes(normalized)) return "survey";
  if (["maintenance", "karbantartas", "karbantartás"].includes(normalized)) return "maintenance";
  return DEFAULT_APPOINTMENT_TYPE;
}

export function appointmentTypeLabel(value?: string | null) {
  const type = normalizeAppointmentType(value);
  return APPOINTMENT_TYPES.find((item) => item.value === type)?.label || "Szerelés";
}

export function appointmentDurationLabel(value?: string | null) {
  const type = normalizeAppointmentType(value);
  return APPOINTMENT_TYPES.find((item) => item.value === type)?.durationLabel || "meglévő szerelési logika szerint";
}

export function appointmentTypeEmailLabel(value?: string | null) {
  const type = normalizeAppointmentType(value);
  if (type === "survey") return "felmérési";
  if (type === "maintenance") return "karbantartási";
  return "klímaszerelési";
}

export function isInstallationAppointment(value?: string | null) {
  return normalizeAppointmentType(value) === "installation";
}

export function isShortAppointment(value?: string | null) {
  return !isInstallationAppointment(value);
}

export function isOneHourAppointment(value?: string | null) {
  return isShortAppointment(value);
}

export function normalizeAppointmentTimeInput(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const firstPart = raw.split("+")[0]?.trim() || raw;
  const cleaned = firstPart.replace(/[.,]/g, ":");

  let hour: number | undefined;
  let minute: number | undefined;

  const colonMatch = cleaned.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    hour = Number(colonMatch[1]);
    minute = Number(colonMatch[2]);
  } else if (/^\d{1,2}$/.test(cleaned)) {
    hour = Number(cleaned);
    minute = 0;
  } else if (/^\d{3,4}$/.test(cleaned)) {
    const padded = cleaned.padStart(4, "0");
    hour = Number(padded.slice(0, 2));
    minute = Number(padded.slice(2, 4));
  } else {
    const embeddedTime = cleaned.match(/\d{1,2}:\d{1,2}/)?.[0];
    if (embeddedTime) return normalizeAppointmentTimeInput(embeddedTime);
  }

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "";
  if ((hour as number) < 0 || (hour as number) > 23 || (minute as number) < 0 || (minute as number) > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function isValidAppointmentTimeInput(value?: string | null) {
  return Boolean(normalizeAppointmentTimeInput(value));
}

export function firstAppointmentTime(value?: string) {
  return normalizeAppointmentTimeInput(value) || "08:00";
}

export function timeToMinutes(value?: string) {
  const firstTime = firstAppointmentTime(value);
  const [hourValue, minuteValue] = firstTime.split(":").map(Number);
  const hour = Number.isFinite(hourValue) ? hourValue : 8;
  const minute = Number.isFinite(minuteValue) ? minuteValue : 0;
  return hour * 60 + minute;
}

export function minutesToTime(value: number) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function addMinutesToTime(value: string, minutes: number) {
  return minutesToTime(timeToMinutes(value) + minutes);
}

export function addHoursToTime(value: string, hours: number) {
  return addMinutesToTime(value, hours * 60);
}

export function appointmentDurationMinutes(type?: string | null, items: QuoteItem[] = [], time?: string) {
  const appointmentType = normalizeAppointmentType(type);
  if (isOneHourAppointment(appointmentType)) return 60;
  if (quantity(items) >= 2 || String(time || "").includes("+")) return 8 * 60;
  const start = timeToMinutes(time);
  if (start >= 16 * 60) return 2 * 60;
  return 4 * 60;
}

export function slotInterval(slot: string, type?: string | null, items: QuoteItem[] = []): AppointmentInterval | null {
  const start = timeToMinutes(slot);
  if (!Number.isFinite(start)) return null;
  return { start, end: start + appointmentDurationMinutes(type, items, slot) };
}

export function appointmentInterval(customer: AppointmentLike): AppointmentInterval | null {
  if (!customer.time) return null;
  const start = timeToMinutes(customer.time);
  return {
    start,
    end: start + appointmentDurationMinutes(customer.appointmentType, customer.quoteItems || [], customer.time),
  };
}

export function intervalsOverlap(first: AppointmentInterval, second: AppointmentInterval) {
  return first.start < second.end && second.start < first.end;
}

export function appointmentSlotOptions(type?: string | null, items: QuoteItem[] = []) {
  if (isOneHourAppointment(type)) return ONE_HOUR_APPOINTMENT_SLOTS;
  if (quantity(items) >= 2) return ["08:00 + 12:00"];
  return INSTALLATION_APPOINTMENT_SLOTS;
}

export function appointmentTimeRangeLabel(customer: AppointmentLike, fallback = "egyeztetés szerint") {
  const rawTime = customer.time || fallback;
  const firstTime = firstAppointmentTime(rawTime);
  if (!firstTime) return rawTime || fallback;
  const durationMinutes = appointmentDurationMinutes(customer.appointmentType, customer.quoteItems || [], rawTime);
  return `${firstTime}–${addMinutesToTime(firstTime, durationMinutes)}`;
}

export function appointmentTimeLabel(type?: string | null, time?: string, items: QuoteItem[] = []) {
  const firstTime = firstAppointmentTime(time);
  const durationMinutes = appointmentDurationMinutes(type, items, time);
  return `${firstTime}–${addMinutesToTime(firstTime, durationMinutes)}`;
}

export function appointmentWorkSummary(customer: Pick<AppointmentLike, "appointmentType" | "quoteItems">) {
  const type = normalizeAppointmentType(customer.appointmentType);
  if (type === "survey") return "1 órás helyszíni felmérés";
  if (type === "maintenance") return "1 órás klíma karbantartás";
  return "Klímaszerelés";
}

export function appointmentSummaryLabel(customer: AppointmentLike & { date?: string }) {
  if (!customer.date) return "nincs időpont";
  return `${appointmentTypeLabel(customer.appointmentType)}: ${customer.date.replaceAll("-", ".")} · ${appointmentTimeRangeLabel(customer)}`;
}

export function appointmentTimelineHint(customer: AppointmentLike & { date?: string }) {
  if (!customer.date) return undefined;
  return appointmentSummaryLabel(customer);
}

export function appointmentDocumentTitle(value?: string | null) {
  const type = normalizeAppointmentType(value);
  if (type === "survey") return "Felmérési időpont-visszaigazolás";
  if (type === "maintenance") return "Karbantartási időpont-visszaigazolás";
  return "Időpont-visszaigazolás";
}

export function appointmentEmailSubject(value?: string | null) {
  const type = normalizeAppointmentType(value);
  if (type === "survey") return "Felmérési időpont visszaigazolás – KLIMAlin";
  if (type === "maintenance") return "Karbantartási időpont visszaigazolás – KLIMAlin";
  return "Időpont visszaigazolás – KLIMAlin";
}

export function appointmentEmailIntro(value?: string | null) {
  const type = normalizeAppointmentType(value);
  if (type === "survey") return "Ezúton visszaigazoljuk az egyeztetett klímafelmérési időpontot.";
  if (type === "maintenance") return "Ezúton visszaigazoljuk az egyeztetett klímakarbantartási időpontot.";
  return "Ezúton visszaigazoljuk az egyeztetett klímás időpontot és a szereléssel együtt értendő klíma telepítését.";
}

export function appointmentWorkLabel(value?: string | null) {
  const type = normalizeAppointmentType(value);
  if (type === "survey") return "Klímafelmérés";
  if (type === "maintenance") return "Klímakarbantartás";
  return "Klímatelepítés";
}
