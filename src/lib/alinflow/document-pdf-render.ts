import { createDocumentPdf } from "./document-pdf";
import { renderPurchaseDeclarationPdf } from "./purchase-declaration-pdf";
import { createPrivacyNoticePdf } from "./privacy-notice-pdf";
import type { SavedPdfBundle, SavedPdfDeclaration, SavedPdfReport } from "./document-pdf-data";
import { workAcceptanceText, workReportTitle } from "./work-report";
import { appointmentTypeLabel } from "./appointments";
import type { WorkspaceSettings } from "./workspace-settings";
import { settingsBrandName, settingsFooterLines } from "./workspace-settings";

export type PdfCustomer = { name?: string; email?: string; phone?: string; address?: string; city?: string; postalCode?: string };
export type PdfAttachment = { filename: string; content: string; content_type: "application/pdf" };

function address(customer: PdfCustomer) {
  const location = [customer.postalCode, customer.city].filter(Boolean).join(" ");
  const street = String(customer.address || "");
  return customer.city && street.toLocaleLowerCase("hu").includes(customer.city.toLocaleLowerCase("hu"))
    ? street : [location, street].filter(Boolean).join(", ");
}

function reportCustomer(report: SavedPdfReport, fallback: PdfCustomer) {
  return {
    name: Object.hasOwn(report, "customer_name") ? report.customer_name || "" : fallback.name || report.signer_name || "",
    email: Object.hasOwn(report, "customer_email") ? report.customer_email || "" : fallback.email || "",
    phone: Object.hasOwn(report, "customer_phone") ? report.customer_phone || "" : fallback.phone || "",
    address: Object.hasOwn(report, "customer_address") ? report.customer_address || "" : address(fallback),
  };
}

export async function createWorkReportPdf(report: SavedPdfReport, fallback: PdfCustomer, settings: WorkspaceSettings): Promise<Uint8Array> {
  const pdf = await createDocumentPdf(workReportTitle(report.appointment_type), { modern: true, brandName: settingsBrandName(settings) });
  const customer = reportCustomer(report, fallback);
  pdf.text("Az elvégzett munka és az átadás-átvétel visszaigazolása", { size: 9, muted: true });
  pdf.section("Ügyfél adatai");
  pdf.details([["Ügyfél", customer.name], ["Munkavégzés helye", customer.address], ["Telefonszám", customer.phone], ["Email", customer.email]]);
  pdf.section("Munka adatai");
  pdf.details([["Dátum és időpont", [report.work_date?.replaceAll("-", "."), report.work_time].filter(Boolean).join(" · ")], ["Munka típusa", appointmentTypeLabel(report.appointment_type)]]);
  pdf.section("Készülékek");
  pdf.text(report.climate_summary || "Nincs rögzített készülékmegnevezés.");
  pdf.section("Elvégzett munka");
  pdf.text(report.work_description || "Nincs rögzített munkaleírás.");
  if (report.notes) { pdf.section("Megjegyzés"); pdf.text(report.notes); }
  const footer = settingsFooterLines(settings, "workReport");
  const footerHeight = footer.length ? pdf.textHeight(footer.join("\n"), 8) + 36 : 0;
  const acceptance = workAcceptanceText(report.appointment_type);
  pdf.keepTogether(40 + pdf.textHeight(acceptance) + 105 + pdf.textHeight(report.signer_name || customer.name, 9) + footerHeight + 20);
  pdf.section("Átadás-átvételi nyilatkozat");
  pdf.text(acceptance);
  await pdf.signature(report.signature_data_url || "", report.signer_name || customer.name, report.signed_at || "", footerHeight + 20);
  if (footer.length) { pdf.section("Szolgáltató"); pdf.text(footer.join("\n"), { size: 8, muted: true }); }
  pdf.text(`Munkalap azonosítója: ${report.id}`, { size: 7, muted: true });
  return pdf.save();
}

export async function createPurchaseDeclarationPdf(declaration: SavedPdfDeclaration, report: SavedPdfReport, fallback: PdfCustomer): Promise<Uint8Array> {
  const customer = reportCustomer(report, fallback);
  return renderPurchaseDeclarationPdf({
    id: declaration.id,
    workspace_id: declaration.workspace_id,
    customer_id: declaration.customer_id,
    appointment_id: declaration.appointment_id,
    work_report_id: declaration.work_report_id,
    seller_name: declaration.seller_name,
    seller_tax_number: declaration.seller_tax_number,
    seller_representative: declaration.seller_representative,
    quote_items: Array.isArray(declaration.quote_items) ? declaration.quote_items.map((item) => ({
      productName: item.productName, customName: item.customName, name: item.name, quantity: item.quantity,
    })) : undefined,
    signature_data_url: declaration.signature_data_url,
    signer_name: declaration.signer_name,
    signed_at: declaration.signed_at,
  }, { name: customer.name, address: customer.address });
}

export async function createSavedPdfAttachments(bundle: SavedPdfBundle, customer: PdfCustomer, settings: WorkspaceSettings): Promise<PdfAttachment[]> {
  const attachments: PdfAttachment[] = [];
  let totalBytes = 0;
  const add = (filename: string, bytes: Uint8Array) => {
    totalBytes += bytes.byteLength;
    if (totalBytes > 15 * 1024 * 1024) throw new Error("A PDF-csomag túl nagy az emailküldéshez. Küldd a dokumentumokat külön.");
    attachments.push({ filename, content: Buffer.from(bytes).toString("base64"), content_type: "application/pdf" });
  };
  if (bundle.includeWorkReport) add(`munkalap-${bundle.report.id}.pdf`, await createWorkReportPdf(bundle.report, customer, settings));
  for (const declaration of bundle.declarations) {
    add(`vasarlasi-nyilatkozat-${declaration.id}.pdf`, await createPurchaseDeclarationPdf(declaration, bundle.report, customer));
  }
  if (bundle.report.privacy_notice != null) {
    add(`adatkezelesi-tajekoztato-${bundle.report.id}.pdf`, await createPrivacyNoticePdf(bundle.report.privacy_notice, bundle.report.privacy_consent_revoked_at));
  }
  return attachments;
}
