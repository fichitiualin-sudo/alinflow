import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";

const PAGE = { width: 595.28, height: 841.89, margin: 44, bottom: 52 };
const INK = rgb(0.08, 0.12, 0.18);
const MUTED = rgb(0.34, 0.39, 0.46);
const LINE = rgb(0.76, 0.79, 0.82);
let fontBytes: Promise<Uint8Array> | undefined;

/** Shared by generated documents and official PDF form overlays. No remote font requests. */
export async function loadPdfFont(document: PDFDocument): Promise<PDFFont> {
  document.registerFontkit(fontkit);
  fontBytes ||= readFile(path.join(process.cwd(), "src/lib/alinflow/pdf-fonts/DejaVuSans.ttf"));
  return document.embedFont(await fontBytes, { subset: true });
}

function printable(value: unknown): string {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[\u2010-\u2015]/g, "-").replace(/\u00a0/g, " ");
  if (text.length > 60_000) throw new Error("A dokumentum egyik mezője túl hosszú a PDF elkészítéséhez.");
  return text;
}

export function decodePdfSignature(dataUrl: string): { bytes: Uint8Array; format: "png" | "jpeg" } {
  const match = String(dataUrl || "").trim().match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match || match[2].length > 4 * 1024 * 1024) throw new Error("Az elmentett aláírás nem megfelelő PNG/JPEG kép.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw new Error("Az elmentett aláírás képe túl nagy vagy üres.");
  return { bytes, format: match[1].toLowerCase() === "png" ? "png" : "jpeg" };
}

export class DocumentPdf {
  private page!: PDFPage;
  private y = 0;
  private readonly width = PAGE.width - 2 * PAGE.margin;

  constructor(readonly document: PDFDocument, readonly font: PDFFont, readonly title: string) {
    document.setTitle(title);
    document.setCreator("AlinFlow");
    document.setProducer("AlinFlow");
    this.newPage();
  }

  private newPage() {
    if (this.document.getPageCount() >= 50) throw new Error("A dokumentum túl hosszú a PDF elkészítéséhez.");
    this.page = this.document.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - 48;
    const size = this.document.getPageCount() === 1 ? 16 : 11;
    for (const line of this.wrap(this.title, this.width, size)) {
      this.page.drawText(line, { x: PAGE.margin, y: this.y, size, font: this.font, color: INK });
      this.y -= size + 5;
    }
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y - 3 }, end: { x: PAGE.width - PAGE.margin, y: this.y - 3 }, color: LINE, thickness: 0.7 });
    this.y -= 21;
  }

  private ensure(height: number) {
    if (this.y - height < PAGE.bottom) this.newPage();
  }

  private wrap(value: unknown, width: number, size: number): string[] {
    const lines: string[] = [];
    for (const paragraph of printable(value).split("\n")) {
      let current = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const combined = current ? `${current} ${word}` : word;
        if (this.font.widthOfTextAtSize(combined, size) <= width) { current = combined; continue; }
        if (current) { lines.push(current); current = ""; }
        for (const character of word) {
          if (current && this.font.widthOfTextAtSize(current + character, size) > width) { lines.push(current); current = ""; }
          current += character;
        }
      }
      lines.push(current);
    }
    return lines;
  }

  text(value: unknown, options: { size?: number; muted?: boolean; gap?: number } = {}) {
    const size = options.size || 10;
    const leading = size * 1.45;
    for (const line of this.wrap(value, this.width, size)) {
      this.ensure(leading);
      this.page.drawText(line, { x: PAGE.margin, y: this.y, size, font: this.font, color: options.muted ? MUTED : INK });
      this.y -= leading;
    }
    this.y -= options.gap ?? 5;
  }

  section(title: string) {
    this.ensure(45);
    this.y -= 9;
    this.text(title, { size: 11, gap: 6 });
  }

  field(label: string, value: unknown) {
    this.text(`${label}: ${printable(value) || "nincs megadva"}`, { gap: 2 });
  }

  textHeight(value: unknown, size = 10) {
    return this.wrap(value, this.width, size).length * size * 1.45;
  }

  keepTogether(height: number) {
    this.ensure(Math.min(height, 650));
  }

  table(headers: string[], rows: string[][], fractions: number[] = headers.map(() => 1 / headers.length)) {
    const total = fractions.reduce((sum, value) => sum + value, 0);
    const widths = fractions.map((value) => this.width * value / total);
    const drawRow = (cells: string[], heading: boolean) => {
      const lines = widths.map((width, index) => this.wrap(cells[index] || "", width - 14, 9));
      const height = Math.max(...lines.map((cell) => cell.length)) * 13 + 14;
      if (height > 640) throw new Error("A táblázat egyik sora túl hosszú a PDF elkészítéséhez.");
      let x = PAGE.margin;
      for (let index = 0; index < widths.length; index += 1) {
        this.page.drawRectangle({ x, y: this.y - height, width: widths[index], height, borderColor: LINE, borderWidth: 0.6, ...(heading ? { color: rgb(0.94, 0.96, 0.97) } : {}) });
        lines[index].forEach((line, lineIndex) => this.page.drawText(line, { x: x + 7, y: this.y - 16 - lineIndex * 13, font: this.font, size: 9, color: INK }));
        x += widths[index];
      }
      this.y -= height;
    };
    this.ensure(70);
    drawRow(headers, true);
    for (const row of rows) {
      const height = Math.max(...widths.map((width, index) => this.wrap(row[index] || "", width - 14, 9).length)) * 13 + 14;
      if (this.y - height < PAGE.bottom) { this.newPage(); drawRow(headers, true); }
      drawRow(row, false);
    }
    this.y -= 10;
  }

  async signature(dataUrl: string, signerName: string, signedAt: string, reserveAfter = 0) {
    const { bytes, format } = decodePdfSignature(dataUrl);
    let signature;
    try {
      signature = format === "png" ? await this.document.embedPng(bytes) : await this.document.embedJpg(bytes);
    } catch {
      throw new Error("Az elmentett aláírás képe nem olvasható. A dokumentum nem küldhető el.");
    }
    const signedDate = new Date(signedAt);
    if (!Number.isFinite(signedDate.getTime())) throw new Error("Hiányzik az elmentett aláírás időpontja.");
    const displayDate = signedDate.toLocaleString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const names = this.wrap(`Aláíró: ${signerName}`, this.width, 9);
    this.ensure(116 + names.length * 13 + Math.min(reserveAfter, 350));
    this.y -= 7;
    const size = signature.scaleToFit(220, 66);
    this.page.drawImage(signature, { x: PAGE.margin, y: this.y - size.height, width: size.width, height: size.height });
    this.y -= 73;
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y }, end: { x: PAGE.margin + 230, y: this.y }, color: LINE, thickness: 0.7 });
    this.y -= 15;
    this.text(`Aláíró: ${signerName}`, { size: 9, gap: 2 });
    this.text(`Aláírva: ${displayDate}`, { size: 9, gap: 6 });
  }

  async save(): Promise<Uint8Array> {
    const pages = this.document.getPages();
    pages.forEach((page, index) => {
      page.drawText(`${index + 1} / ${pages.length}`, { x: PAGE.width - PAGE.margin - 38, y: 27, size: 8, font: this.font, color: MUTED });
    });
    return this.document.save();
  }
}

export async function createDocumentPdf(title: string): Promise<DocumentPdf> {
  const document = await PDFDocument.create();
  return new DocumentPdf(document, await loadPdfFont(document), title);
}
