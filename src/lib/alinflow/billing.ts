export type BillingInvoiceKind = "device" | "labor" | "maintenance";
export type BillingPaymentMethod = "cash" | "transfer";

export type BillingUiConfig = {
  deviceTitle: string;
  deviceLineName: string;
  laborTitle: string;
  laborLineName: string;
  maintenanceTitle: string;
  maintenanceLineName: string;
};

export function billingUiConfig(): BillingUiConfig {
  return {
    deviceTitle: process.env.NEXT_PUBLIC_BILLING_DEVICE_TITLE || "Készülék és anyag",
    deviceLineName: process.env.NEXT_PUBLIC_BILLING_DEVICE_LINE_NAME || "Klímaberendezés",
    laborTitle: process.env.NEXT_PUBLIC_BILLING_LABOR_TITLE || "Munkadíj",
    laborLineName: process.env.NEXT_PUBLIC_BILLING_LABOR_LINE_NAME || "Légkondicionáló telepítés és beüzemelés",
    maintenanceTitle: process.env.NEXT_PUBLIC_BILLING_MAINTENANCE_TITLE || "Karbantartási számla",
    maintenanceLineName: process.env.NEXT_PUBLIC_BILLING_MAINTENANCE_LINE_NAME || "Légkondicionáló karbantartás",
  };
}

export function billingKindLabel(kind: BillingInvoiceKind, config = billingUiConfig()) {
  if (kind === "device") return config.deviceTitle;
  if (kind === "maintenance") return config.maintenanceTitle;
  return config.laborTitle;
}

export function billingPaymentMethodLabel(method: BillingPaymentMethod) {
  return method === "cash" ? "KP" : "Utalás";
}

export function billingDueDateIso(method: BillingPaymentMethod, base = new Date()) {
  const dueDate = new Date(base);
  if (method === "transfer") dueDate.setDate(dueDate.getDate() + 2);
  return dueDate.toISOString().slice(0, 10);
}
