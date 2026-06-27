export type BillingInvoiceKind = "device" | "labor";
export type BillingPaymentMethod = "cash" | "transfer";

export type BillingUiConfig = {
  deviceTitle: string;
  deviceLineName: string;
  laborTitle: string;
  laborLineName: string;
};

export function billingUiConfig(): BillingUiConfig {
  return {
    deviceTitle: process.env.NEXT_PUBLIC_BILLING_DEVICE_TITLE || "Készülék és anyag",
    deviceLineName: process.env.NEXT_PUBLIC_BILLING_DEVICE_LINE_NAME || "Klímaberendezés és szerelési anyagok",
    laborTitle: process.env.NEXT_PUBLIC_BILLING_LABOR_TITLE || "Munkadíj",
    laborLineName: process.env.NEXT_PUBLIC_BILLING_LABOR_LINE_NAME || "Klímaszerelési munkadíj",
  };
}

export function billingKindLabel(kind: BillingInvoiceKind, config = billingUiConfig()) {
  return kind === "device" ? config.deviceTitle : config.laborTitle;
}

export function billingPaymentMethodLabel(method: BillingPaymentMethod) {
  return method === "cash" ? "KP" : "Utalás";
}

export function billingDueDateIso(method: BillingPaymentMethod, base = new Date()) {
  const dueDate = new Date(base);
  if (method === "transfer") dueDate.setDate(dueDate.getDate() + 2);
  return dueDate.toISOString().slice(0, 10);
}
