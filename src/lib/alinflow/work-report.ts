import type { Customer, WorkReport } from "./types";

export function defaultWorkDescription() {
  return "Klímaberendezés telepítése, szükséges szerelési anyagok beépítése, nyomáspróba, vákuumozás, beüzemelés, működési próba és felhasználói betanítás.";
}

export function workAcceptanceText() {
  return "Az ügyfél a munkalap aláírásával igazolja, hogy a fenti munkát átvette, a készülék működését bemutatták, és az alapvető használati tudnivalókról tájékoztatást kapott.";
}

export function emptyWorkReport(customer?: Customer): WorkReport {
  return {
    customerId: customer?.id,
    workDescription: defaultWorkDescription(),
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
