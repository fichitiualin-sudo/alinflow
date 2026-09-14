import { createDocumentPdf } from "./document-pdf";
import type { SavedPdfBundle, SavedPdfDeclaration, SavedPdfReport } from "./document-pdf-data";
import { workAcceptanceText, workReportTitle } from "./work-report";
import { appointmentTypeLabel } from "./appointments";
import type { WorkspaceSettings } from "./workspace-settings";
import { settingsFooterLines } from "./workspace-settings";

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
    name: report.customer_name || fallback.name || report.signer_name || "",
    email: report.customer_email || fallback.email || "",
    phone: report.customer_phone || fallback.phone || "",
    address: report.customer_address || address(fallback),
  };
}

export async function createWorkReportPdf(report: SavedPdfReport, fallback: PdfCustomer, settings: WorkspaceSettings): Promise<Uint8Array> {
  const pdf = await createDocumentPdf(workReportTitle(report.appointment_type));
  const customer = reportCustomer(report, fallback);
  pdf.text("Az elvégzett munka és az átadás-átvétel visszaigazolása", { size: 9, muted: true });
  pdf.section("Ügyfél adatai");
  pdf.field("Név", customer.name);
  pdf.field("Cím", customer.address);
  pdf.field("Telefonszám", customer.phone);
  pdf.field("Email", customer.email);
  pdf.section("Munka adatai");
  pdf.field("Típus", appointmentTypeLabel(report.appointment_type));
  pdf.field("Dátum", report.work_date?.replaceAll("-", "."));
  pdf.field("Időpont", report.work_time);
  pdf.field("Helyszín", customer.address);
  pdf.section("Készülékek");
  pdf.text(report.climate_summary || "Nincs rögzített készülékmegnevezés.");
  pdf.section("Elvégzett munka");
  pdf.text(report.work_description || "Nincs rögzített munkaleírás.");
  if (report.notes) { pdf.section("Megjegyzés"); pdf.text(report.notes); }
  const footer = settingsFooterLines(settings, "workReport");
  const footerHeight = footer.length ? pdf.textHeight(footer.join("\n"), 9) + 50 : 0;
  const acceptance = workAcceptanceText(report.appointment_type);
  pdf.keepTogether(45 + pdf.textHeight(acceptance) + 116 + pdf.textHeight(`Aláíró: ${report.signer_name || customer.name}`, 9) + footerHeight + 20);
  pdf.section("Átadás-átvételi nyilatkozat");
  pdf.text(acceptance);
  await pdf.signature(report.signature_data_url || "", report.signer_name || customer.name, report.signed_at || "", footerHeight + 20);
  if (footer.length) { pdf.section("Szolgáltató"); pdf.text(footer.join("\n"), { size: 9, muted: true }); }
  pdf.text(`Munkalap azonosítója: ${report.id}`, { size: 7, muted: true });
  return pdf.save();
}

export async function createPurchaseDeclarationPdf(declaration: SavedPdfDeclaration, report: SavedPdfReport, fallback: PdfCustomer): Promise<Uint8Array> {
  const pdf = await createDocumentPdf("VÁSÁRLÁSI NYILATKOZAT");
  const customer = reportCustomer(report, fallback);
  pdf.text("a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. § (5) bekezdése alapján", { size: 8.5, muted: true });
  pdf.section("Az értékesítő vállalkozás adatai");
  pdf.field("Név", declaration.seller_name);
  pdf.field("Adószám", declaration.seller_tax_number);
  pdf.field("A képviseletében eljáró természetes személy", declaration.seller_representative);
  pdf.section("A telepíttető adatai");
  pdf.text("A.) Vállalkozás, intézmény, egyéb adószámmal rendelkező szervezet", { size: 9 });
  pdf.text("Név: ............................................................\nAdószám: .......................................................\nKépviselő neve: .............................................", { size: 9 });
  pdf.text("B.) Természetes személy", { size: 9 });
  pdf.field("Név", customer.name);
  pdf.field("Lakcím", customer.address);
  pdf.text("Telepíttető - megfelelve az Európai Parlament és a Tanács 2024/573 Rendeletében, valamint a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. §-ban foglaltaknak - jelen nyilatkozat aláírásával kötelezettséget vállal arra, hogy az alábbi telepítési tanúsítvány-köteles berendezés(ek) telepítését és beüzemelését az arra képesítéssel rendelkező vállalkozás képesített alkalmazottjával fogja elvégeztetni.", { size: 9 });
  if (!Array.isArray(declaration.quote_items) || !declaration.quote_items.length || declaration.quote_items.length > 100) {
    throw new Error("A mentett vásárlási nyilatkozat készüléklistája hiányzik vagy túl hosszú. Ellenőrizd a dokumentumot.");
  }
  const rows = declaration.quote_items.map((item) => {
    const name = String(item.customName || item.productName || item.name || "").trim();
    const quantity = Number(item.quantity);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) throw new Error("A mentett nyilatkozat egyik készülékadata hiányos. Ellenőrizd a dokumentumot.");
    return [name, String(quantity)];
  });
  pdf.table(["Termék megnevezése", "Megvásárolt termékek darabszáma"], rows, [0.7, 0.3]);
  pdf.text("*Több berendezés típus vásárlása esetén a táblázat sorainak száma bővíthető egyéni szerkesztéssel", { size: 7.5, muted: true });
  pdf.text("Telepíttető tudomásul veszi, hogy a telepítési tanúsítvány-köteles berendezéssel kapcsolatos jótállás telepítési tanúsítvány¹ birtokában érvényesíthető.", { size: 9 });
  pdf.text("Nyilatkozata megtételével egyidejűleg hozzájárul, hogy fentiekben megadott adatait a forgalmazó megismerje, kezelje, nyilvántartsa.", { size: 9 });
  await pdf.signature(declaration.signature_data_url || "", declaration.signer_name || customer.name, declaration.signed_at || "", 50);
  pdf.text("¹ A klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. § (7)-(10) bekezdései alapján", { size: 7, muted: true });
  pdf.text(`Nyilatkozat azonosítója: ${declaration.id}`, { size: 7, muted: true });
  return pdf.save();
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
  return attachments;
}
