import type { Customer, WorkReport } from "./types";
import { normalizeAppointmentType } from "./appointments";

export function reportBelongsToWork(report: WorkReport, customer: Customer, type = customer.appointmentType) {
  if (report.customerId !== customer.id || normalizeAppointmentType(report.appointmentType) !== normalizeAppointmentType(type)) return false;
  if (customer.activeWorkReportId && report.id !== customer.activeWorkReportId) return false;
  if (customer.activeAppointmentId) return report.appointmentId === customer.activeAppointmentId;
  if (customer.activeWorkReportId) return true;
  return !report.appointmentId && Boolean(customer.date) && report.workDate === customer.date
    && (report.workTime || "08:00") === (customer.time || "08:00");
}
