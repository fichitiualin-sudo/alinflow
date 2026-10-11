import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import { decodePdfSignature, DocumentPdf, loadPdfFont } from "./document-pdf";
import type { SavedPdfDeclaration } from "./document-pdf-data";

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const MIN_SIZE = 9.5;
let templateBytes: Promise<Uint8Array> | undefined;

function printable(value: unknown): string {
  const result = String(value ?? "").replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[\u2010-\u2015]/g, "-").replace(/\u00a0/g, " ").trim();
  if (result.length > 60_000) throw new Error("A dokumentum egyik mezője túl hosszú a PDF elkészítéséhez.");
  return result;
}

function wrap(font: PDFFont, value: string, width: number, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const combined = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(combined, size) <= width) { line = combined; continue; }
      if (line) { lines.push(line); line = ""; }
      for (const character of word) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

type Field = { label: string; value: string; x: number; top: number; width: number };
type FittedField = Field & { text: string; size: number };

/** Fill the unchanged, blank 2025-04-16 form. Both copies use the first source
 * page because the original second page has an inconsistent footnote marker. */
export async function renderPurchaseDeclarationPdf(
  declaration: SavedPdfDeclaration,
  customer: { name?: string; address?: string },
): Promise<Uint8Array> {
  if (!Array.isArray(declaration.quote_items) || !declaration.quote_items.length || declaration.quote_items.length > 100) {
    throw new Error("A mentett vásárlási nyilatkozat készüléklistája hiányzik vagy túl hosszú. Ellenőrizd a dokumentumot.");
  }
  const rows = declaration.quote_items.map((item) => {
    const name = printable(item.customName || item.productName || item.name);
    const quantity = Number(item.quantity);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) throw new Error("A mentett nyilatkozat egyik készülékadata hiányos. Ellenőrizd a dokumentumot.");
    return [name, String(quantity)];
  });
  const signedAt = new Date(declaration.signed_at || "");
  if (!Number.isFinite(signedAt.getTime())) throw new Error("Hiányzik az elmentett aláírás időpontja.");
  const signatureSource = decodePdfSignature(declaration.signature_data_url || "");
  const document = await PDFDocument.create();
  const font = await loadPdfFont(document);
  const labelFont = await document.embedFont(StandardFonts.TimesRoman);
  let signature;
  try {
    signature = signatureSource.format === "png"
      ? await document.embedPng(signatureSource.bytes)
      : await document.embedJpg(signatureSource.bytes);
  } catch {
    throw new Error("Az elmentett aláírás képe nem olvasható. A dokumentum nem küldhető el.");
  }
  templateBytes ||= readFile(path.join(process.cwd(), "public/forms/purchase-declaration/vasarlasi-nyilatkozat-0416.pdf"));
  const original = await PDFDocument.load(await templateBytes);
  const pages = await document.copyPages(original, [0, 0]);
  const fields: Field[] = [
    { label: "Értékesítő neve", value: printable(declaration.seller_name), x: 136, top: 154.65, width: 386 },
    { label: "Értékesítő adószáma", value: printable(declaration.seller_tax_number), x: 160, top: 170.49, width: 362 },
    { label: "Az értékesítő képviselője", value: printable(declaration.seller_representative), x: 349, top: 186.33, width: 173 },
    { label: "Telepíttető neve", value: printable(customer.name || declaration.signer_name), x: 136, top: 341.4, width: 386 },
    { label: "Telepíttető lakcíme", value: printable(customer.address), x: 152, top: 357.24, width: 370 },
  ];
  const overflowFields: Field[] = [];
  const fittedFields: FittedField[] = fields.map((field) => {
    const text = field.value.replace(/\s+/g, " ");
    let size = 11;
    while (size > MIN_SIZE && font.widthOfTextAtSize(text, size) > field.width - 3) size -= 0.25;
    if (font.widthOfTextAtSize(text, size) > field.width - 3) {
      overflowFields.push(field);
      return { ...field, text: `[${overflowFields.length}] Lásd a mellékletben.`, size: MIN_SIZE };
    }
    return { ...field, text, size };
  });
  const tableSize = 10;
  const tableLeading = 12;
  const fittedRows = rows.map(([name, quantity]) => ({
    name: wrap(font, name, 254, tableSize), quantity: wrap(font, quantity, 171, tableSize),
  }));
  const tableHeight = fittedRows.reduce((sum, row) => sum + Math.max(row.name.length, row.quantity.length) * tableLeading + 6, 0);
  const hasTableAppendix = tableHeight > 40;
  const signerName = printable(declaration.signer_name || customer.name);
  let signerLabel = `Aláíró: ${signerName.replace(/\s+/g, " ")}`;
  if (font.widthOfTextAtSize(signerLabel, 8) > 235) {
    overflowFields.push({ label: "A nyilatkozat aláírója", value: signerName, x: 291, top: 744, width: 235 });
    signerLabel = `Aláíró: [${overflowFields.length}] Lásd a mellékletben.`;
  }
  const hasAppendix = Boolean(overflowFields.length || hasTableAppendix);
  const date = signedAt.toLocaleDateString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" });
  const timestamp = signedAt.toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const drawText = (page: PDFPage, text: string, x: number, top: number, size: number) => {
    page.drawText(text, { x, y: page.getHeight() - top - size, font, size, color: BLACK });
  };
  pages.forEach((page, copy) => {
    document.addPage(page);
    page.drawRectangle({ x: 400, y: page.getHeight() - 55.5, width: 183, height: 40, color: WHITE });
    page.drawText(copy === 0 ? "I. példány" : "II. példány", {
      x: 426, y: page.getHeight() - 39, size: 16, font: labelFont, color: rgb(0.62, 0.62, 0.62),
    });
    for (const field of fittedFields) {
      if (!field.text) continue;
      page.drawRectangle({ x: field.x - 1, y: page.getHeight() - field.top - 13, width: field.width + 2, height: 15, color: WHITE });
      drawText(page, field.text, field.x, field.top, field.size);
    }
    if (hasTableAppendix) {
      const lines = wrap(font, "A teljes készüléklista a mellékletben.", 254, tableSize);
      lines.forEach((line, index) => drawText(page, line, 83, 531 + index * tableLeading, tableSize));
      const quantity = rows.reduce((sum, row) => sum + Number(row[1]), 0);
      drawText(page, String(quantity), 353, 531, tableSize);
    } else {
      let top = 523.75;
      fittedRows.forEach((row, index) => {
        if (index) page.drawLine({ start: { x: 76.7, y: page.getHeight() - top }, end: { x: 529.44, y: page.getHeight() - top }, color: BLACK, thickness: 0.48 });
        row.name.forEach((line, lineIndex) => drawText(page, line, 83, top + 3 + lineIndex * tableLeading, tableSize));
        row.quantity.forEach((line, lineIndex) => drawText(page, line, 353, top + 3 + lineIndex * tableLeading, tableSize));
        top += Math.max(row.name.length, row.quantity.length) * tableLeading + 6;
      });
    }
    page.drawRectangle({ x: 97, y: page.getHeight() - 711, width: 159, height: 15, color: WHITE });
    drawText(page, date, 99, 697.49, 11);
    const signatureSize = signature.scaleToFit(205, 36);
    page.drawImage(signature, { x: 408 - signatureSize.width / 2, y: page.getHeight() - 726.5, ...signatureSize });
    drawText(page, signerLabel, 291, 744, 8);
    drawText(page, `Aláírva: ${timestamp}`, 291, 754, 7);
    const documentReference = printable(declaration.id);
    // This trace is outside the original form and legal footnote.
    for (const [index, line] of wrap(font, `Nyilatkozat azonosítója: ${documentReference}${hasAppendix ? " • Melléklettel" : ""}`, 454, 7).entries()) {
      drawText(page, line, 70.82, 809 + index * 9, 7);
    }
  });
  if (hasAppendix) {
    const appendix = new DocumentPdf(document, font, "Vásárlási nyilatkozat - melléklet");
    appendix.text("Az I. és II. példányhoz tartozó teljes adatok.", { size: 9 });
    appendix.field("Nyilatkozat azonosítója", declaration.id);
    overflowFields.forEach((field, index) => {
      appendix.section(`[${index + 1}] ${field.label}`);
      appendix.text(field.value);
    });
    if (hasTableAppendix) {
      appendix.section("A megvásárolt készülékek teljes listája");
      // Flow even an unusually long single product name across pages instead
      // of forcing an over-tall table row or dropping any saved characters.
      rows.forEach(([name, quantity], index) => {
        appendix.keepTogether(55);
        appendix.text(`${index + 1}. tétel - ${quantity} db`, { size: 10, gap: 2 });
        appendix.text(name, { size: 10, gap: 10 });
      });
    }
    appendix.text(`Aláírva: ${timestamp}`, { size: 9 });
  }
  document.setTitle("Vásárlási nyilatkozat");
  document.setCreator("AlinFlow");
  document.setProducer("AlinFlow");
  return document.save();
}
