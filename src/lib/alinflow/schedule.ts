import type { AppointmentType, Customer, QuoteItem } from "./types";
import {
  appointmentInterval,
  appointmentSlotOptions,
  intervalsOverlap,
  isInstallationAppointment,
  slotInterval,
} from "./appointments";
import { qty } from "./products";

export function appointmentIntervalsForDay(customers: Customer[], date: string, selectedCustomerId?: string, selectedAppointmentId?: string) {
  const dayCustomers = customers.filter((customer) => {
    if (customer.date !== date || customer.status === "Lemondva") return false;
    if (selectedAppointmentId && customer.activeAppointmentId === selectedAppointmentId) return false;
    if (!selectedAppointmentId && selectedCustomerId && customer.id === selectedCustomerId) return false;
    return true;
  });
  return dayCustomers.map((customer) => appointmentInterval(customer)).filter(Boolean) as { start: number; end: number }[];
}

export function appointmentTimeAvailable({
  customers,
  date,
  appointmentType,
  items,
  selectedCustomerId,
  selectedAppointmentId,
  time,
}: {
  customers: Customer[];
  date: string;
  appointmentType: AppointmentType;
  items: QuoteItem[];
  selectedCustomerId?: string;
  selectedAppointmentId?: string;
  time: string;
}) {
  const candidate = slotInterval(time, appointmentType, items);
  if (!candidate) return false;
  const intervals = appointmentIntervalsForDay(customers, date, selectedCustomerId, selectedAppointmentId);
  return intervals.every((interval) => !intervalsOverlap(candidate, interval));
}

export function availableAppointmentSlots({
  customers,
  date,
  appointmentType,
  items,
  selectedCustomerId,
  selectedAppointmentId,
}: {
  customers: Customer[];
  date: string;
  appointmentType: AppointmentType;
  items: QuoteItem[];
  selectedCustomerId?: string;
  selectedAppointmentId?: string;
}) {
  const slots = isInstallationAppointment(appointmentType) && qty(items) >= 2 ? ["08:00 + 12:00"] : appointmentSlotOptions(appointmentType, items);
  return slots.filter((slot) => appointmentTimeAvailable({ customers, date, appointmentType, items, selectedCustomerId, selectedAppointmentId, time: slot }));
}

export function scheduledTimeValue(value?: string) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return 24 * 60 + 1;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function sortCustomersBySchedule(list: Customer[]) {
  return [...list].sort((a, b) => {
    const byDate = String(a.date || "").localeCompare(String(b.date || ""));
    if (byDate !== 0) return byDate;
    const byTime = scheduledTimeValue(a.time) - scheduledTimeValue(b.time);
    if (byTime !== 0) return byTime;
    return (a.name || "").localeCompare(b.name || "", "hu");
  });
}
