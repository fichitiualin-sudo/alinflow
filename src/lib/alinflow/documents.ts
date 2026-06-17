import type { Customer, DocumentRecord } from "./types";
import { firstAppointmentTime, normalizeAppointmentType } from "./appointments";
import { todayIso } from "./format";

export function documentTimestamp(docs: DocumentRecord[], type: string) {
  const doc = docs.find((item) => item.type === type);
  return doc?.sentAt || doc?.updatedAt || doc?.createdAt || undefined;
}

export function documentFromRow(row: any): DocumentRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    appointmentId: row.appointment_id || undefined,
    type: row.document_type || row.type || "document",
    title: row.title || "Dokumentum",
    status: row.status || "Mentve",
    sentAt: row.sent_at || undefined,
    createdAt: row.created_at || undefined,
    updatedAt: row.updated_at || undefined,
  };
}

export function appointmentBookedDocumentType(type?: string | null) {
  const normalized = normalizeAppointmentType(type);
  if (normalized === "maintenance") return "maintenance_appointment_booked";
  if (normalized === "survey") return "survey_appointment_booked";
  return "appointment_booked";
}

export function appointmentEmailDocumentType(type?: string | null) {
  const normalized = normalizeAppointmentType(type);
  if (normalized === "maintenance") return "maintenance_appointment_email";
  if (normalized === "survey") return "survey_appointment_email";
  return "appointment_email";
}

export function reportDocumentType(type?: string | null) {
  return normalizeAppointmentType(type) === "maintenance" ? "maintenance_work_report" : "work_report";
}

export function maintenanceCancellationDocumentType(customer: Pick<Customer, "date" | "time">, cancelledAt: string) {
  const datePart = (customer.date || todayIso()).replaceAll("-", "");
  const timePart = firstAppointmentTime(customer.time || "00:00").replace(":", "");
  const cancelledPart = cancelledAt.replace(/[^0-9]/g, "");
  return `maintenance_cancelled_${datePart}_${timePart}_${cancelledPart}`;
}

export function statusMeansSent(status?: string) {
  return (status || "").toLowerCase().includes("elk\u00fcld");
}
