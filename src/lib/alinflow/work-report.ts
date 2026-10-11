import type { Customer, QuoteItem, WorkReport, WorkReportSnapshot } from "./types";
import { appointmentWorkLabel, firstAppointmentTime, normalizeAppointmentType } from "./appointments";
import { parsePrivacyNoticeSnapshot } from "./privacy-notice";
import { fullCustomerAddress } from "./format";
import { climateSummary } from "./products";

export function captureWorkReportSnapshot(customer: Customer, items: QuoteItem[]): WorkReportSnapshot {
  return { customerName: customer.name || "", customerAddress: fullCustomerAddress(customer),
    customerEmail: customer.email || "", customerPhone: customer.phone || "", climateSummary: climateSummary(items) };
}

export function workReportSnapshotCustomer(customer: Customer, report: WorkReport): Customer {
  const snapshot = report.documentSnapshot;
  return snapshot ? { ...customer, name: snapshot.customerName, address: snapshot.customerAddress,
    city: "", postalCode: "", phone: snapshot.customerPhone, email: snapshot.customerEmail } : customer;
}

export function sameWorkReportSignature(left: WorkReport | undefined, right: WorkReport) {
  return hasValidWorkReportSignature(left) && hasValidWorkReportSignature(right)
    && left!.signatureDataUrl === right.signatureDataUrl && left!.signerName === right.signerName
    && new Date(left!.signedAt!).getTime() === new Date(right.signedAt!).getTime();
}

export function defaultWorkDescription(appointmentType?: string | null) {
  const type = normalizeAppointmentType(appointmentType);
  if (type === "maintenance") {
    return "Klímaberendezés karbantartása, beltéri egység tisztítása, szűrők ellenőrzése/tisztítása, kültéri egység szemrevételezése, kondenzvíz-elvezetés ellenőrzése, működési próba és az ügyfél tájékoztatása.";
  }
  if (type === "survey") {
    return "Helyszíni klímafelmérés, beltéri és kültéri egység lehetséges helyének megtekintése, csövezési és kondenzvíz-elvezetési lehetőségek átbeszélése, valamint az árajánlathoz szükséges részletek egyeztetése.";
  }
  return "Klímaberendezés telepítése, szükséges szerelési anyagok beépítése, nyomáspróba, vákuumozás, beüzemelés, működési próba és felhasználói betanítás.";
}

export function workAcceptanceText(appointmentType?: string | null) {
  const workLabel = appointmentWorkLabel(appointmentType).toLowerCase();
  return `Az ügyfél a munkalap aláírásával igazolja, hogy a fenti ${workLabel} megtörtént, a munkát átvette, és az elvégzett feladatokról tájékoztatást kapott.`;
}

export function workReportTitle(appointmentType?: string | null) {
  const type = normalizeAppointmentType(appointmentType);
  if (type === "maintenance") return "Klímakarbantartási munkalap";
  if (type === "survey") return "Klímafelmérési munkalap";
  return "Klímaszerelési munkalap";
}

export function hasValidWorkReportSignature(report?: Pick<WorkReport, "signatureDataUrl" | "signedAt"> | null) {
  const signatureDataUrl = report?.signatureDataUrl?.trim();
  const signedAt = report?.signedAt?.trim();
  if (!signatureDataUrl || !signedAt) return false;
  return !Number.isNaN(new Date(signedAt).getTime());
}

export type WorkReportSignatureState = "unsigned" | "signed" | "sent_unsigned" | "sent_signed";

export function workReportSignatureState(
  report?: Pick<WorkReport, "signatureDataUrl" | "signedAt" | "emailSentAt"> | null
): WorkReportSignatureState {
  const signed = hasValidWorkReportSignature(report);
  const sent = Boolean(report?.emailSentAt);
  if (signed) return sent ? "sent_signed" : "signed";
  return sent ? "sent_unsigned" : "unsigned";
}

export function emptyWorkReport(customer?: Customer): WorkReport {
  return {
    customerId: customer?.id,
    appointmentId: customer?.activeAppointmentId,
    appointmentType: customer?.appointmentType,
    workDate: customer?.date,
    workTime: customer?.time,
    workDescription: defaultWorkDescription(customer?.appointmentType),
    notes: "",
    signatureDataUrl: "",
    signerName: customer?.name || "",
  };
}

export function workReportFromRow(row: any): WorkReport {
  const appointmentType = normalizeAppointmentType(row.appointment_type);
  return {
    id: row.id,
    customerId: row.customer_id,
    appointmentId: row.appointment_id || undefined,
    legacySourceKey: row.legacy_source_key || undefined,
    appointmentType,
    workDate: row.work_date || undefined,
    workTime: row.work_time || undefined,
    workDescription: row.work_description || defaultWorkDescription(appointmentType),
    notes: row.notes || "",
    signatureDataUrl: row.signature_data_url || "",
    signerName: row.signer_name || row.customer_name || "",
    signedAt: row.signed_at || undefined,
    documentSnapshot: ["customer_name", "customer_address", "customer_email", "customer_phone", "climate_summary"].some((key) => Object.hasOwn(row, key)) ? {
      customerName: row.customer_name || "", customerAddress: row.customer_address || "",
      customerEmail: row.customer_email || "", customerPhone: row.customer_phone || "", climateSummary: row.climate_summary || "",
    } : undefined,
    privacyNotice: parsePrivacyNoticeSnapshot(row.privacy_notice),
    privacyConsentRevokedAt: row.privacy_consent_revoked_at || undefined,
    emailSentAt: row.email_sent_at || undefined,
    createdAt: row.created_at || undefined,
    updatedAt: row.updated_at || undefined,
  };
}

export function workReportMapKey(customerId: string, type?: string | null, workDate?: string, workTime?: string, reportId?: string) {
  const normalized = normalizeAppointmentType(type);
  if (normalized === "installation" && !workDate && !workTime && !reportId) return customerId;
  const safeDate = workDate || "nincs-datum";
  const safeTime = firstAppointmentTime(workTime || "08:00");
  return `${customerId}:${normalized}:${safeDate}:${safeTime}:${reportId || "uj"}`;
}

export function workReportKeyFromReport(report: WorkReport, fallbackCustomerId?: string) {
  const customerId = report.customerId || fallbackCustomerId || "";
  return workReportMapKey(customerId, report.appointmentType, report.workDate, report.workTime, report.id);
}

export function reportDateTimeMs(report: WorkReport) {
  const dateText = report.workDate || report.createdAt || "";
  const timeText = report.workTime || "00:00";
  const parsed = report.workDate ? new Date(`${dateText}T${firstAppointmentTime(timeText) || "00:00"}`) : new Date(dateText);
  const time = parsed.getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function sortWorkReportsByDateDesc(reports: WorkReport[]) {
  return [...reports].sort((a, b) => reportDateTimeMs(b) - reportDateTimeMs(a));
}

export function sameReportAppointment(report: WorkReport, customer: Customer) {
  if (report.appointmentId && customer.activeAppointmentId) return report.appointmentId === customer.activeAppointmentId;
  if (!customer.date) return false;
  return report.workDate === customer.date && firstAppointmentTime(report.workTime || "08:00") === firstAppointmentTime(customer.time || "08:00");
}

export function formatSignedAt(value?: string) {
  if (!value) return "nincs aláírva";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
