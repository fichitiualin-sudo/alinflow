import type { AppointmentType, Customer, QuoteItem } from "./types";

export type SmsReminderDays = 1 | 2 | 3;
export type SmsComposerPlatform = "ios" | "android";
export type SmsSegmentCount = { encoding: "GSM-7" | "UCS-2"; units: number; segments: number };
export type SmsReminderDraft = {
  appointmentId: string;
  customerId: string;
  appointmentType: Exclude<AppointmentType, "other">;
  phone: string | null;
  text: string;
  /** Canonical business content. Hash before persistence; it contains personal data. */
  fingerprint: string;
  date: string;
  time: string;
  arrivalWindow: string;
  deviceCount: number;
  encoding: SmsSegmentCount;
};

const BUDAPEST_TIME_ZONE = "Europe/Budapest";
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
const DAY_AN_SUFFIX = new Set([2, 3, 6, 8, 13, 16, 18, 20, 23, 26, 28, 30]);
// 3GPP TS 23.038 default alphabet and extension table. ESC itself is not printable.
const GSM_BASIC = new Set(Array.from("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"));
const GSM_EXTENSION = new Set(Array.from("\f^{}\\[~]|€"));

function singleLine(value: string | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function dateOrdinal(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.getTime() / DAY_MS;
}

/** A calendar date in Budapest, independent of the browser's own time zone. */
export function smsReminderToday(now: Date = new Date()): string {
  if (!Number.isFinite(now.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUDAPEST_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function smsReminderDayOffset(date: string, today: string): number | null {
  const target = dateOrdinal(date);
  const current = dateOrdinal(today);
  return target === null || current === null ? null : target - current;
}

function savedTime(value: string | undefined): string | null {
  // PostgreSQL may return seconds. Never guess an absent or malformed time.
  const match = String(value || "").match(/^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/);
  return match ? `${match[1]}:${match[2]}` : null;
}

export function isSmsReminderAppointment(customer: Customer, today: string): boolean {
  const type = customer.appointmentType || "installation";
  const status = singleLine(customer.status).toLocaleLowerCase("hu-HU");
  const offset = smsReminderDayOffset(customer.date || "", today);
  return Boolean(
    customer.id?.trim() && customer.activeAppointmentId?.trim()
    && ["installation", "maintenance", "survey"].includes(type)
    && ["időpont foglalva", "szerelés folyamatban"].includes(status)
    && !(type === "installation" && customer.stockDeducted)
    && offset !== null && offset > 0 && savedTime(customer.time),
  );
}

/** Exact N-th calendar day, matching the Holnap / 2 nap múlva / 3 nap múlva tabs. */
export function isSmsReminderEligible(customer: Customer, days: SmsReminderDays, today: string): boolean {
  return [1, 2, 3].includes(days) && isSmsReminderAppointment(customer, today)
    && smsReminderDayOffset(customer.date || "", today) === days;
}

function climateQuantities(items: QuoteItem[] = []) {
  return items.flatMap((item) => {
    if (item.itemType === "extra" || !(singleLine(item.productId) || singleLine(item.productName) || singleLine(item.customName))) return [];
    const quantity = Number(item.quantity);
    return [Number.isFinite(quantity) && quantity > 0 ? quantity : 1];
  });
}

/** Only the current appointment and its explicitly selected installations are counted. */
export function smsReminderDeviceCount(customer: Customer): number {
  let quantities = climateQuantities(customer.quoteItems);
  if (!quantities.length && customer.appointmentType === "maintenance") {
    const selectedIds = customer.maintenanceInstallationIds
      ? new Set(customer.maintenanceInstallationIds)
      : null;
    const seenIds = new Set<string>();
    quantities = (customer.maintenanceInstallations || []).flatMap((installation) => {
      if (!installation.appointmentId || seenIds.has(installation.appointmentId)
        || (selectedIds && !selectedIds.has(installation.appointmentId))) return [];
      seenIds.add(installation.appointmentId);
      return climateQuantities(installation.quoteItems);
    });
  }
  // Alternative quote options describe choices, never an additive device total.
  return customer.quotePricingMode === "alternatives"
    ? Math.max(0, ...quantities)
    : quantities.reduce((sum, quantity) => sum + quantity, 0);
}

function arrivalWindow(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const display = (minutes: number) => {
    const hours = Math.floor(minutes / 60) % 24;
    const remainder = minutes % 60;
    return remainder ? `${hours}:${String(remainder).padStart(2, "0")}` : String(hours);
  };
  const start = hour * 60 + minute;
  return `${display(start)}–${display(start + 60)}`;
}

function reminderDateLabel(date: string, today: string) {
  if (smsReminderDayOffset(date, today) === 1) return "Holnap";
  const [year, month, day] = date.split("-").map(Number);
  const suffix = day === 1 ? "jén" : DAY_AN_SUFFIX.has(day) ? "án" : "én";
  const monthName = MONTH_NAMES[month - 1];
  return year === Number(today.slice(0, 4))
    ? `${monthName[0].toLocaleUpperCase("hu-HU")}${monthName.slice(1)} ${day}-${suffix}`
    : `${year}. ${monthName} ${day}-${suffix}`;
}

/** Conservative syntax normalization, not a claim that the number can receive SMS. */
export function normalizeSmsPhone(value: string): string | null {
  const raw = String(value || "").trim();
  // Explicitly reject extensions, URI parameters and multiple-recipient separators.
  if (!raw || !/^[+0-9 ().\-\u00a0]+$/.test(raw)) return null;
  let depth = 0;
  for (const character of raw) {
    if (character === "(" && ++depth > 1) return null;
    if (character === ")" && --depth < 0) return null;
  }
  if (depth !== 0) return null;
  let normalized = raw.replace(/[ ().\-\u00a0]/g, "");
  if (normalized.startsWith("00")) normalized = `+${normalized.slice(2)}`;
  else if (normalized.startsWith("06")) normalized = `+36${normalized.slice(2)}`;
  else if (/^(?:1\d{7}|[2-9]\d{8})$/.test(normalized)) normalized = `+36${normalized}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) return null;
  if (normalized.startsWith("+36") && !/^\+36(?:1\d{7}|[2-9]\d{8})$/.test(normalized)) return null;
  return normalized;
}

/** Standard SMS estimate, preserving both accents and UTF-16 surrogate pairs. */
export function countSmsSegments(text: string): SmsSegmentCount {
  const characters = Array.from(text);
  const gsm = characters.every((character) => GSM_BASIC.has(character) || GSM_EXTENSION.has(character));
  const sizes = characters.map((character) => gsm ? GSM_EXTENSION.has(character) ? 2 : 1 : character.length);
  const units = sizes.reduce((sum, size) => sum + size, 0);
  const singleLimit = gsm ? 160 : 70;
  const multipartLimit = gsm ? 153 : 67;
  let segments = units ? 1 : 0;
  if (units > singleLimit) {
    let used = 0;
    for (const size of sizes) {
      if (used + size > multipartLimit) {
        segments += 1;
        used = 0;
      }
      used += size;
    }
  }
  return { encoding: gsm ? "GSM-7" : "UCS-2", units, segments };
}

export function buildSmsReminder(customer: Customer, brand: string, today: string): SmsReminderDraft | null {
  if (!isSmsReminderAppointment(customer, today)) return null;
  const sender = singleLine(brand);
  if (!sender) return null;
  const date = customer.date!;
  const time = savedTime(customer.time)!;
  const type = (customer.appointmentType || "installation") as Exclude<AppointmentType, "other">;
  const savedName = singleLine(customer.name);
  const name = /\p{L}/u.test(savedName) ? savedName : "Ügyfelünk";
  const count = smsReminderDeviceCount(customer);
  const plural = count > 1;
  const window = arrivalWindow(time);
  const when = reminderDateLabel(date, today);
  const activity = type === "installation"
    ? `telepítjük a ${plural ? "klímáit" : "klímáját"}`
    : type === "maintenance"
    ? `elvégezzük a ${plural ? "klímái" : "klímája"} karbantartását`
    : "felmérjük a klímatelepítés helyszínét";
  const preparation = type === "installation"
    ? " Kérjük, tegye szabaddá a munkaterületet."
    : type === "maintenance"
    ? ` Kérjük, tegye hozzáférhetővé a ${plural ? "készülékeket" : "készüléket"}.`
    : "";
  const text = `Kedves ${name}! ${when} ${activity}, várhatóan ${window} között érkezünk.${preparation} Köszönjük, szép napot! ${sender}`;
  const phone = normalizeSmsPhone(customer.phone);
  return {
    appointmentId: customer.activeAppointmentId!,
    customerId: customer.id,
    appointmentType: type,
    phone,
    text,
    fingerprint: JSON.stringify({
      version: 1, appointmentId: customer.activeAppointmentId, customerId: customer.id,
      date, time, type, name, phone: phone || singleLine(customer.phone), count, brand: sender,
    }),
    date, time, arrivalWindow: window, deviceCount: count, encoding: countSmsSegments(text),
  };
}

/** Opening this URI only composes a message; sending remains the user's action. */
export function smsComposerHref(phone: string, body: string, platform: SmsComposerPlatform): string | null {
  const recipient = normalizeSmsPhone(phone);
  if (!recipient || !body || !["ios", "android"].includes(platform)) return null;
  try {
    return `sms:${recipient}${platform === "ios" ? "&" : "?"}body=${encodeURIComponent(body)}`;
  } catch {
    return null;
  }
}
