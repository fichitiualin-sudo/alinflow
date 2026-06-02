import type { Customer, WorkReport } from "./types";
import { appointmentWorkLabel, normalizeAppointmentType } from "./appointments";

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

export function emptyWorkReport(customer?: Customer): WorkReport {
  return {
    customerId: customer?.id,
    workDescription: defaultWorkDescription(customer?.appointmentType),
    notes: "",
    signatureDataUrl: "",
    signerName: customer?.name || "",
  };
}

export function formatSignedAt(value?: string) {
  if (!value) return "nincs aláírva";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
