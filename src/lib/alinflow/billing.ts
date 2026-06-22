export type BillingInvoiceKind = "device" | "labor";

export type BillingUiConfig = {
  deviceTitle: string;
  deviceSellerLabel: string;
  laborTitle: string;
  laborSellerLabel: string;
};

export function billingUiConfig(): BillingUiConfig {
  return {
    deviceTitle: process.env.NEXT_PUBLIC_BILLING_DEVICE_TITLE || "Készülék és anyag",
    deviceSellerLabel: process.env.NEXT_PUBLIC_BILLING_DEVICE_SELLER_LABEL || "Készülék/anyag számla · áfás",
    laborTitle: process.env.NEXT_PUBLIC_BILLING_LABOR_TITLE || "Munkadíj",
    laborSellerLabel: process.env.NEXT_PUBLIC_BILLING_LABOR_SELLER_LABEL || "Munkadíj számla · alanyi adómentes",
  };
}

export function billingKindLabel(kind: BillingInvoiceKind, config = billingUiConfig()) {
  return kind === "device" ? config.deviceTitle : config.laborTitle;
}
