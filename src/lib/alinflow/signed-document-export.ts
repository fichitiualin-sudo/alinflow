import type { Customer, PurchaseDeclaration, QuoteItem, SellerCompany, WorkReport } from "./types";
import { appointmentTimeLabel, appointmentTimeRangeLabel, appointmentTypeLabel, appointmentWorkLabel, normalizeAppointmentType } from "./appointments";
import { fullCustomerAddress } from "./format";
import { cleanQuoteItems, itemName, itemQuantity } from "./products";
import { DEFAULT_SELLER_COMPANY } from "./purchase-declarations";
import { defaultWorkDescription, formatSignedAt, hasValidWorkReportSignature, workAcceptanceText, workReportTitle } from "./work-report";
import type { WorkspaceSettings } from "./workspace-settings";
import { defaultWorkspaceSettings, settingsFooterLines } from "./workspace-settings";

export type SignedDocumentExportFile = {
  path: string;
  content: string;
};

export type SignedDocumentIndexItem = {
  title: string;
  type: string;
  customerName: string;
  signedAt?: string;
  path: string;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeDataUrl(value?: string) {
  const raw = String(value || "").trim();
  return raw.startsWith("data:image/") ? raw : "";
}

function dottedLine(value?: string) {
  return `<span class="dotted">${escapeHtml(value || "\u00A0")}</span>`;
}

function formatDocumentDate(value?: string) {
  if (!value) return "nincs megadva";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}

function workReportFooterHtml(workspaceSettings?: WorkspaceSettings) {
  const lines = settingsFooterLines(workspaceSettings || defaultWorkspaceSettings(null), "workReport");
  if (!lines.length) return "";
  const [title, ...details] = lines;
  const detailHtml = details.length ? `<br>${details.map((line) => escapeHtml(line)).join("<br>")}` : "";
  return `Üdvözlettel,<br><strong>${escapeHtml(title)}</strong>${detailHtml}`;
}

function documentShell(title: string, body: string) {
  return `<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef2f7; color: #0f172a; font-family: Georgia, "Times New Roman", serif; }
    .page { width: 210mm; min-height: 297mm; margin: 18px auto; background: #fff; padding: 14mm; box-shadow: 0 18px 50px rgba(15,23,42,.18); }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 21px; text-align: center; line-height: 1.1; text-transform: uppercase; }
    h2 { font-size: 14px; margin: 14px 0 6px; }
    p, li { font-size: 13px; line-height: 1.35; }
    .center { text-align: center; }
    .small { font-size: 10px; line-height: 1.25; }
    .tiny { font-size: 9px; line-height: 1.2; }
    .section { margin-top: 12px; }
    .indent { margin-left: 14px; }
    .dotted { display: inline-block; min-width: 180px; border-bottom: 1px dotted #0f172a; padding: 0 4px 1px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
    th, td { border: 1px solid #0f172a; padding: 6px; vertical-align: top; }
    th { text-align: center; font-weight: 900; }
    .box { border: 1px solid #0f172a; padding: 10px; white-space: pre-wrap; text-align: justify; }
    .signature-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-top: 18px; }
    .signature { width: 58mm; text-align: center; }
    .signature img { max-width: 100%; max-height: 22mm; object-fit: contain; margin-bottom: 4px; }
    .signature-line { border-top: 1px solid #0f172a; padding-top: 4px; font-style: italic; }
    .footer { border-top: 1px solid #0f172a; margin-top: 12px; padding-top: 5px; font-size: 10px; line-height: 1.25; }
    .index-list { margin-top: 18px; padding-left: 22px; }
    .index-list li { margin-bottom: 8px; }
    @media print {
      body { background: #fff; }
      .page { width: auto; min-height: auto; margin: 0; padding: 0; box-shadow: none; }
    }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export function buildSignedDocumentsIndex(items: SignedDocumentIndexItem[]) {
  const rows = items
    .map((item) => `<li><strong>${escapeHtml(item.customerName)}</strong> - ${escapeHtml(item.title)} (${escapeHtml(item.type)})${item.signedAt ? ` - aláírva: ${escapeHtml(formatSignedAt(item.signedAt))}` : ""}<br><span class="small">${escapeHtml(item.path)}</span></li>`)
    .join("");

  return documentShell("AlinFlow aláírt dokumentumok", `<article class="page">
    <h1>AlinFlow aláírt dokumentumok</h1>
    <p class="center section">Exportált dokumentumok száma: <strong>${items.length}</strong></p>
    <ol class="index-list">${rows || "<li>Nincs aláírt dokumentum az exportban.</li>"}</ol>
  </article>`);
}

export function buildWorkReportHtml(customer: Customer, report: WorkReport, quoteItems: QuoteItem[], workspaceSettings?: WorkspaceSettings) {
  const reportCustomer = {
    ...customer,
    appointmentType: report.appointmentType || customer.appointmentType,
    date: report.workDate || customer.date,
    time: report.workTime || customer.time,
  };
  const items = cleanQuoteItems(customer.quoteItems?.length ? customer.quoteItems : quoteItems);
  const shownItems = items.length ? items : [{ productId: "", quantity: 1, customName: "Nincs klíma megadva", isManual: true }];
  const workTime = reportCustomer.time
    ? appointmentTimeLabel(reportCustomer.appointmentType, reportCustomer.time, items)
    : appointmentTimeRangeLabel(reportCustomer);
  const signature = safeDataUrl(report.signatureDataUrl);

  return documentShell(workReportTitle(reportCustomer.appointmentType), `<article class="page">
    <h1>${escapeHtml(workReportTitle(reportCustomer.appointmentType))}</h1>
    <p class="center small">az elvégzett munka és átadás-átvétel visszaigazolására</p>

    <section class="section">
      <h2>Ügyfél adatai:</h2>
      <div class="indent">
        <p>neve: ${dottedLine(customer.name)}</p>
        <p>címe: ${dottedLine(fullCustomerAddress(customer))}</p>
        <p>telefonszáma: ${dottedLine(customer.phone)}</p>
        <p>email címe: ${dottedLine(customer.email)}</p>
      </div>
    </section>

    <section class="section">
      <h2>Munka adatai:</h2>
      <div class="indent">
        <p>munka típusa: ${dottedLine(appointmentTypeLabel(reportCustomer.appointmentType))}</p>
        <p>munka dátuma: ${dottedLine(formatDocumentDate(reportCustomer.date))}</p>
        <p>idősáv: ${dottedLine(workTime)}</p>
        <p>helyszín: ${dottedLine(fullCustomerAddress(customer))}</p>
      </div>
    </section>

    <section class="section">
      <table>
        <thead><tr><th>Készülék megnevezése</th><th>Darab</th><th>Megjegyzés</th></tr></thead>
        <tbody>
          ${shownItems.map((item) => `<tr><td>${escapeHtml(itemName(item))}</td><td class="center"><strong>${itemQuantity(item)}</strong></td><td>${escapeHtml(appointmentWorkLabel(reportCustomer.appointmentType))}</td></tr>`).join("")}
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>Elvégzett munka:</h2>
      <p class="box">${escapeHtml(report.workDescription || defaultWorkDescription(reportCustomer.appointmentType))}</p>
    </section>

    <section class="section">
      <h2>Átadás-átvételi nyilatkozat:</h2>
      <p class="box">${escapeHtml(workAcceptanceText(reportCustomer.appointmentType))}</p>
    </section>

    ${report.notes ? `<section class="section"><h2>Megjegyzés:</h2><p class="box">${escapeHtml(report.notes)}</p></section>` : ""}

    <section class="signature-row">
      <div><p>Kelt: ${dottedLine(formatDocumentDate(reportCustomer.date))}</p></div>
      <div class="signature">
        ${signature ? `<img src="${escapeHtml(signature)}" alt="Ügyfél aláírása">` : ""}
        <div class="signature-line">Ügyfél aláírása</div>
        ${hasValidWorkReportSignature(report) ? `<p class="tiny">Aláírva: ${escapeHtml(formatSignedAt(report.signedAt))}</p>` : ""}
      </div>
    </section>

    <div class="footer">${workReportFooterHtml(workspaceSettings)}</div>
  </article>`);
}

export function buildPurchaseDeclarationHtml(customer: Customer, declaration: PurchaseDeclaration) {
  const shownSeller: SellerCompany = {
    id: declaration.sellerCompanyId || DEFAULT_SELLER_COMPANY.id,
    name: declaration.sellerName || DEFAULT_SELLER_COMPANY.name,
    taxNumber: declaration.sellerTaxNumber || DEFAULT_SELLER_COMPANY.taxNumber,
    representative: declaration.sellerRepresentative || DEFAULT_SELLER_COMPANY.representative,
  };
  const shownItems = cleanQuoteItems(declaration.quoteItems || []);
  const items = shownItems.length ? shownItems : [{ productId: "", quantity: 1, customName: "Nincs klíma megadva", isManual: true }];
  const signature = safeDataUrl(declaration.signatureDataUrl);

  return documentShell("Vásárlási nyilatkozat", `<article class="page">
    <h1>Vásárlási<br>nyilatkozat</h1>
    <p class="center small">a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. § (5) bekezdése alapján</p>

    <section class="section">
      <h2>Az értékesítő vállalkozás adatai:</h2>
      <div class="indent">
        <p>neve: ${dottedLine(shownSeller.name)}</p>
        <p>adószáma: ${dottedLine(shownSeller.taxNumber)}</p>
        <p>a képviseletében eljáró természetes személy neve: ${dottedLine(shownSeller.representative)}</p>
      </div>
    </section>

    <section class="section">
      <h2>A telepíttető adatai:</h2>
      <div class="indent">
        <p><strong>A.) Vállalkozás, intézmény, egyéb adószámmal rendelkező szervezet</strong></p>
        <p>neve: ${dottedLine("")}</p>
        <p>adószáma: ${dottedLine("")}</p>
        <p>a képviseletében eljáró természetes személy neve: ${dottedLine("")}</p>
        <p><strong>B.) Természetes személy</strong></p>
        <p>neve: ${dottedLine(customer.name || declaration.signerName)}</p>
        <p>lakcíme: ${dottedLine(fullCustomerAddress(customer))}</p>
      </div>
    </section>

    <p class="section">Telepíttető jelen nyilatkozat aláírásával kötelezettséget vállal arra, hogy az alábbi telepítési tanúsítvány-köteles berendezés(ek) telepítését és beüzemelését az arra képesítéssel rendelkező vállalkozás képesített alkalmazottjával fogja elvégeztetni.</p>

    <section class="section">
      <table>
        <thead><tr><th>Termék megnevezése</th><th>Megvásárolt termékek darabszáma</th></tr></thead>
        <tbody>${items.map((item) => `<tr><td>${escapeHtml(itemName(item))}</td><td class="center"><strong>${itemQuantity(item)}</strong></td></tr>`).join("")}</tbody>
      </table>
    </section>

    <p class="section small">Telepíttető tudomásul veszi, hogy a telepítési tanúsítvány-köteles berendezéssel kapcsolatos jótállás telepítési tanúsítvány birtokában érvényesíthető.</p>
    <p class="small"><strong>Nyilatkozata megtételével egyidejűleg hozzájárul, hogy fentiekben megadott adatait a forgalmazó megismerje, kezelje, nyilvántartsa.</strong></p>

    <section class="signature-row">
      <div><p>Kelt: ${dottedLine(formatDocumentDate(declaration.signedAt?.slice(0, 10) || declaration.createdAt?.slice(0, 10)))}</p></div>
      <div class="signature">
        ${signature ? `<img src="${escapeHtml(signature)}" alt="Telepíttető aláírása">` : ""}
        <div class="signature-line">Telepíttető</div>
        ${declaration.signedAt ? `<p class="tiny">Aláírva: ${escapeHtml(formatSignedAt(declaration.signedAt))}</p>` : ""}
      </div>
    </section>

    <div class="footer tiny">A klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. § (7)-(10) bekezdései alapján.</div>
  </article>`);
}

export function safeExportFilePart(value?: string) {
  return String(value || "nincs-nev")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "dokumentum";
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let current = index;
    for (let bit = 0; bit < 8; bit += 1) {
      current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    }
    table[index] = current >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  data.forEach((byte) => {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function dosTimestamp(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function concatBytes(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function buildZip(files: SignedDocumentExportFile[]) {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  const { time, date } = dosTimestamp();
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.path.replace(/\\/g, "/"));
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);

    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, time);
    writeUint16(localView, 12, date);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, data.length);
    writeUint32(localView, 22, data.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, time);
    writeUint16(centralView, 14, date);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, data.length);
    writeUint32(centralView, 24, data.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);

    localChunks.push(localHeader, data);
    centralChunks.push(centralHeader);
    offset += localHeader.length + data.length;
  });

  const centralDirectory = concatBytes(centralChunks);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralDirectory.length);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  return concatBytes([...localChunks, centralDirectory, endRecord]);
}

export function downloadSignedDocumentZip(filename: string, files: SignedDocumentExportFile[]) {
  const zip = buildZip(files);
  const blob = new Blob([zip], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".zip") ? filename : `${filename}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
