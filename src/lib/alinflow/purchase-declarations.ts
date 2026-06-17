import type { PurchaseDeclaration, QuoteItem, SellerCompany, WorkReport } from "./types";
import { cleanQuoteItems } from "./products";

export const DEFAULT_SELLER_COMPANY: SellerCompany = {
  id: "amova-4u-kft",
  name: "AMOVA 4U Kft.",
  taxNumber: "29253630-2-13",
  representative: "Adorján Mirjam",
  isDefault: true,
  active: true,
};

export function sellerCompanyFromRow(row: any): SellerCompany {
  return {
    id: String(row.id || DEFAULT_SELLER_COMPANY.id),
    name: row.name || DEFAULT_SELLER_COMPANY.name,
    taxNumber: row.tax_number || row.taxNumber || "",
    representative: row.representative || "",
    isDefault: Boolean(row.is_default),
    active: row.active !== false,
  };
}

export function sellerCompanyToRow(seller: Pick<SellerCompany, "name" | "taxNumber" | "representative">) {
  return {
    name: seller.name.trim(),
    tax_number: seller.taxNumber.trim(),
    representative: seller.representative.trim(),
    active: true,
    is_default: false,
  };
}

export function sellerSnapshot(sellers: SellerCompany[], sellerId?: string): SellerCompany {
  return sellers.find((seller) => seller.id === sellerId) || sellers[0] || DEFAULT_SELLER_COMPANY;
}

export function declarationFromRow(row: any): PurchaseDeclaration {
  return {
    id: row.id,
    customerId: row.customer_id,
    appointmentId: row.appointment_id || undefined,
    workReportId: row.work_report_id || undefined,
    sellerCompanyId: row.seller_company_id || undefined,
    sellerName: row.seller_name || DEFAULT_SELLER_COMPANY.name,
    sellerTaxNumber: row.seller_tax_number || "",
    sellerRepresentative: row.seller_representative || "",
    quoteItems: cleanQuoteItems(row.quote_items || []),
    signatureDataUrl: row.signature_data_url || undefined,
    signerName: row.signer_name || undefined,
    signedAt: row.signed_at || undefined,
    createdAt: row.created_at || undefined,
    updatedAt: row.updated_at || undefined,
  };
}

export function declarationToRow({
  customerId,
  appointmentId,
  workReportId,
  seller,
  quoteItems,
  report,
  legacySourceKey,
}: {
  customerId: string;
  appointmentId?: string;
  workReportId?: string;
  seller: SellerCompany;
  quoteItems: QuoteItem[];
  report: WorkReport;
  legacySourceKey: string;
}) {
  return {
    legacy_source_key: legacySourceKey,
    customer_id: customerId,
    appointment_id: appointmentId || null,
    work_report_id: workReportId || null,
    seller_company_id: seller.id === DEFAULT_SELLER_COMPANY.id ? null : seller.id,
    seller_name: seller.name,
    seller_tax_number: seller.taxNumber,
    seller_representative: seller.representative,
    quote_items: cleanQuoteItems(quoteItems),
    signature_data_url: report.signatureDataUrl || null,
    signer_name: report.signerName || null,
    signed_at: report.signedAt || null,
  };
}
