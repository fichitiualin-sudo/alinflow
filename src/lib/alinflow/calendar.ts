import type { CalendarMode, Customer } from "./types";
import { pad, todayIso } from "./format";
import { appointmentDurationMinutes, firstAppointmentTime } from "./appointments";
import { googleCalendarDetails } from "./google-calendar-event";

export function weekStart(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function calLabel(mode: CalendarMode, d: Date) {
  if (mode === "month") return `${d.getFullYear()}. ${pad(d.getMonth() + 1)}`;
  const a = weekStart(d);
  const b = new Date(a);
  b.setDate(a.getDate() + 6);
  return `${a.getFullYear()}. ${pad(a.getMonth() + 1)}.${pad(a.getDate())} – ${pad(b.getMonth() + 1)}.${pad(b.getDate())}`;
}

function compactCalendarDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}${m}${d}T${h}${min}00`;
}

function parseCalendarTime(value?: string) {
  const firstTime = firstAppointmentTime(value);
  const [hour, minute] = firstTime.split(":").map(Number);
  return { hour: Number.isFinite(hour) ? hour : 8, minute: Number.isFinite(minute) ? minute : 0 };
}

export function googleCalendarHref(customer: Customer) {
  const dateIso = customer.date || todayIso();
  const { hour, minute } = parseCalendarTime(customer.time);
  const start = new Date(`${dateIso}T00:00:00`);
  start.setHours(hour, minute, 0, 0);
  const end = new Date(start);
  const durationMinutes = appointmentDurationMinutes(customer.appointmentType, customer.quoteItems, customer.time);
  end.setMinutes(end.getMinutes() + durationMinutes);

  const details = googleCalendarDetails(customer);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: details.summary,
    dates: `${compactCalendarDate(start)}/${compactCalendarDate(end)}`,
    ctz: "Europe/Budapest",
    details: details.description,
    location: details.location,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
