import type { WorkspaceSettings } from "@/lib/alinflow/workspace-settings";

export type BillingInvoiceKind = "device" | "labor" | "maintenance" | "combined";
export type BillingPaymentMethod = "cash" | "transfer";

export type BillingUiConfig = {
  invoiceMode: "split" | "single";
  transferDueDays: number;
  deviceTitle: string;
  deviceLineName: string;
  laborTitle: string;
  laborLineName: string;
  maintenanceTitle: string;
  maintenanceLineName: string;
  combinedTitle: string;
  combinedLineName: string;
};

export function billingUiConfig(settings?: WorkspaceSettings): BillingUiConfig {
  const billing = settings?.billingSettings;
  return {
    invoiceMode: billing?.invoiceMode || "split",
    transferDueDays: Math.max(1, Number(billing?.transferDueDays || 2)),
    deviceTitle: billing?.deviceInvoiceLabel || process.env.NEXT_PUBLIC_BILLING_DEVICE_TITLE || "Készülék és anyag",
    deviceLineName: process.env.NEXT_PUBLIC_BILLING_DEVICE_LINE_NAME || "Klímaberendezés",
    laborTitle: billing?.laborInvoiceLabel || process.env.NEXT_PUBLIC_BILLING_LABOR_TITLE || "Munkadíj",
    laborLineName: process.env.NEXT_PUBLIC_BILLING_LABOR_LINE_NAME || "Légkondicionáló telepítés és beüzemelés",
    maintenanceTitle: process.env.NEXT_PUBLIC_BILLING_MAINTENANCE_TITLE || "Karbantartási számla",
    maintenanceLineName: billing?.maintenanceInvoiceLabel || process.env.NEXT_PUBLIC_BILLING_MAINTENANCE_LINE_NAME || "Légkondicionáló karbantartás",
    combinedTitle: billing?.combinedInvoiceLabel || process.env.NEXT_PUBLIC_BILLING_COMBINED_TITLE || "Készülék, anyag és munkadíj",
    combinedLineName: process.env.NEXT_PUBLIC_BILLING_COMBINED_LINE_NAME || "Klímaszerelés készülékkel, anyaggal és munkadíjjal",
  };
}

export function billingKindLabel(kind: BillingInvoiceKind, config = billingUiConfig()) {
  if (kind === "combined") return config.combinedTitle;
  if (kind === "device") return config.deviceTitle;
  if (kind === "maintenance") return config.maintenanceTitle;
  return config.laborTitle;
}

export function billingPaymentMethodLabel(method: BillingPaymentMethod) {
  return method === "cash" ? "KP" : "Utalás";
}

export function billingDueDateIso(method: BillingPaymentMethod, base = new Date(), transferDueDays = 2) {
  const dueDate = new Date(base);
  if (method === "transfer") dueDate.setDate(dueDate.getDate() + Math.max(1, Math.round(transferDueDays)));
  return dueDate.toISOString().slice(0, 10);
}
