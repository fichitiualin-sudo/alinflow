import type { Customer, PurchaseDeclaration, QuoteItem, SellerCompany, WorkReport } from "./types";
import { appointmentTimeLabel, appointmentTimeRangeLabel, appointmentTypeLabel, appointmentWorkLabel } from "./appointments";
import { fullCustomerAddress } from "./format";
import { cleanQuoteItems, itemName, itemQuantity } from "./products";
import { DEFAULT_SELLER_COMPANY } from "./purchase-declarations";
import { defaultWorkDescription, formatSignedAt, hasValidWorkReportSignature, workAcceptanceText, workReportTitle } from "./work-report";
import type { WorkspaceSettings } from "./workspace-settings";
import { defaultWorkspaceSettings, settingsBrandName, settingsFooterLines } from "./workspace-settings";

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

function documentShell(title: string, body: string, documentStyles = "") {
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
    ${documentStyles}
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
  const settings = workspaceSettings || defaultWorkspaceSettings(null);
  const detail = (label: string, value?: string) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "—")}</dd></div>`;

  return documentShell(workReportTitle(reportCustomer.appointmentType), `<article class="page work-report">
    <header class="report-header">
      <p class="report-brand">${escapeHtml(settingsBrandName(settings))}</p>
      <h1>${escapeHtml(workReportTitle(reportCustomer.appointmentType))}</h1>
      <p class="report-subtitle">az elvégzett munka és átadás-átvétel visszaigazolására</p>
    </header>

    <div class="report-details">
      <section>
        <h2>Ügyfél adatai</h2>
        <dl>
          ${detail("Név", customer.name)}
          ${detail("Cím", fullCustomerAddress(customer))}
          ${detail("Telefonszám", customer.phone)}
          ${detail("Email", customer.email)}
        </dl>
      </section>
      <section>
        <h2>Munka adatai</h2>
        <dl>
          ${detail("Munka típusa", appointmentTypeLabel(reportCustomer.appointmentType))}
          ${detail("Munka dátuma", formatDocumentDate(reportCustomer.date))}
          ${detail("Idősáv", workTime)}
          ${detail("Helyszín", fullCustomerAddress(customer))}
        </dl>
      </section>
    </div>

    <section class="section">
      <h2>Készülékek</h2>
      <table class="report-devices">
        <thead><tr><th>Készülék megnevezése</th><th class="quantity">Darab</th><th class="note">Megjegyzés</th></tr></thead>
        <tbody>
          ${shownItems.map((item) => `<tr><td>${escapeHtml(itemName(item))}</td><td class="center"><strong>${itemQuantity(item)}</strong></td><td>${escapeHtml(appointmentWorkLabel(reportCustomer.appointmentType))}</td></tr>`).join("")}
        </tbody>
      </table>
    </section>

    <section class="section">
      <h2>Elvégzett munka</h2>
      <p class="report-text">${escapeHtml(report.workDescription || defaultWorkDescription(reportCustomer.appointmentType))}</p>
    </section>

    ${report.notes ? `<section class="section"><h2>Megjegyzés</h2><p class="report-text">${escapeHtml(report.notes)}</p></section>` : ""}

    <section class="section report-acceptance">
      <h2>Átadás-átvételi nyilatkozat</h2>
      <p>${escapeHtml(workAcceptanceText(reportCustomer.appointmentType))}</p>
    </section>

    <section class="signature-row">
      <div><p class="report-date-label">Kelt</p><p class="report-date">${escapeHtml(formatDocumentDate(reportCustomer.date))}</p></div>
      <div class="signature">
        ${signature ? `<img src="${escapeHtml(signature)}" alt="Ügyfél aláírása">` : '<div class="signature-space"></div>'}
        <div class="signature-line">Ügyfél aláírása</div>
        ${hasValidWorkReportSignature(report) ? `<p class="tiny">Aláírva: ${escapeHtml(formatSignedAt(report.signedAt))}</p>` : ""}
      </div>
    </section>

    <footer class="footer">${workReportFooterHtml(settings)}</footer>
  </article>`, `
    .work-report { max-width: 210mm; width: calc(100% - 32px); border-radius: 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
    .work-report p { line-height: 1.6; }
    .work-report .report-header { border-bottom: 2px solid #0f766e; padding-bottom: 20px; }
    .work-report .report-brand { color: #0f766e; font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
    .work-report h1 { margin-top: 8px; text-align: left; text-transform: none; font-size: 25px; font-weight: 700; line-height: 1.2; letter-spacing: -.025em; }
    .work-report .report-subtitle { margin-top: 8px; color: #64748b; font-size: 11px; }
    .work-report .report-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px; margin-top: 24px; }
    .work-report .report-details section { min-width: 0; }
    .work-report h2 { margin: 0 0 10px; color: #0f766e; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; break-after: avoid; }
    .work-report dl { margin: 0; }
    .work-report dl > div + div { margin-top: 8px; }
    .work-report dt { color: #64748b; font-size: 10px; }
    .work-report dd { margin: 0; }
    .work-report dl > div:first-child dd { font-weight: 600; }
    .work-report .section { margin-top: 24px; }
    .work-report table { table-layout: fixed; font-size: 11px; }
    .work-report th, .work-report td { border: 0; border-bottom: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; }
    .work-report th { border-top: 1px solid #e2e8f0; background: #f8fafc; font-weight: 600; }
    .work-report .quantity { width: 56px; }
    .work-report .note { width: 30%; }
    .work-report th.quantity, .work-report td.center { text-align: center; }
    .work-report td:last-child { color: #475569; }
    .work-report tr { break-inside: avoid; }
    .work-report .report-text { white-space: pre-wrap; }
    .work-report .report-acceptance { border-left: 2px solid #0f766e; padding-left: 16px; }
    .work-report .report-acceptance h2 { margin-bottom: 4px; font-size: 11px; color: #0f172a; letter-spacing: 0; text-transform: none; }
    .work-report .report-acceptance p { font-size: 11px; color: #475569; }
    .work-report .signature-row { margin-top: 32px; break-inside: avoid; }
    .work-report .report-date-label { color: #64748b; font-size: 10px; }
    .work-report .report-date { margin-top: 4px; font-size: 11px; }
    .work-report .signature { width: 56mm; max-width: 100%; flex-shrink: 0; }
    .work-report .signature-space { height: 18mm; }
    .work-report .signature-line { border-color: #94a3b8; font-size: 11px; font-weight: 500; font-style: normal; padding-top: 8px; }
    .work-report .signature .tiny { color: #64748b; font-size: 9px; margin-top: 4px; }
    .work-report .footer { border-color: #e2e8f0; color: #64748b; line-height: 1.6; padding-top: 12px; margin-top: 24px; break-inside: avoid; }
    @media screen and (max-width: 600px) {
      .work-report { padding: 20px; }
      .work-report .report-details { grid-template-columns: 1fr; gap: 24px; }
      .work-report .signature-row { flex-direction: column; align-items: flex-end; }
      .work-report .signature-row > div:first-child { align-self: flex-start; }
    }
    @media print {
      .work-report { width: auto; max-width: none; min-height: auto; border-radius: 0; font-size: 11.5px; }
      .work-report p { font-size: 11.5px; }
      .work-report h1 { font-size: 23px; }
      .work-report .report-details { gap: 32px; margin-top: 20px; }
      .work-report .section { margin-top: 20px; }
      .work-report .footer { font-size: 9px; }
      .work-report thead { display: table-header-group; }
    }
  `);
}

function declarationDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" });
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
  const field = (label: string, value = "") => `<p class="purchase-field"><span>${escapeHtml(label)}</span><span class="purchase-field-value">${escapeHtml(value || "\u00A0")}</span></p>`;
  const copies = ["I.", "II."].map((copy) => `<article class="page purchase-original">
    <p class="purchase-copy">${copy} példány</p>
    <header>
      <h1>VÁSÁRLÁSI<br>NYILATKOZAT</h1>
      <p class="purchase-subtitle">a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló <strong>458/2024. (XII. 30.) Korm. rendelet</strong><br>28. § (5) bekezdése alapján</p>
    </header>
    <section>
      <h2>Az értékesítő vállalkozás adatai:</h2>
      <div class="purchase-seller">
        ${field("neve:", shownSeller.name)}
        ${field("adószáma:", shownSeller.taxNumber)}
        ${field("a képviseletében eljáró természetes személy neve:", shownSeller.representative)}
      </div>
    </section>
    <section>
      <h2>A telepíttető adatai:</h2>
      <div class="purchase-buyer">
        <p>A.) Vállalkozás, intézmény, egyéb adószámmal rendelkező szervezet</p>
        <div class="purchase-buyer-fields">
          ${field("neve:")}
          ${field("adószáma:")}
          ${field("a képviseletében eljáró természetes személy neve:")}
        </div>
        <p class="purchase-person">B.) Természetes személy</p>
        <div class="purchase-buyer-fields">
          ${field("neve:", customer.name || declaration.signerName)}
          ${field("lakcíme:", fullCustomerAddress(customer))}
        </div>
      </div>
    </section>
    <p class="purchase-paragraph">Telepíttető – megfelelve az Európai Parlament és a Tanács 2024/573 Rendeletében, valamint a klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. §-ban foglaltaknak – <strong>jelen nyilatkozat aláírásával kötelezettséget vállal arra, hogy az alábbi telepítési tanúsítvány-köteles berendezés(ek) telepítését és beüzemelését az arra képesítéssel rendelkező vállalkozás képesített alkalmazottjával fogja elvégeztetni.</strong></p>
    <table>
      <thead><tr><th style="width:59%">Termék megnevezése</th><th>Megvásárolt termékek darabszáma</th></tr></thead>
      <tbody>${items.map((item) => `<tr><td>${escapeHtml(itemName(item))}</td><td class="center">${itemQuantity(item)}</td></tr>`).join("")}</tbody>
    </table>
    <p class="purchase-table-note">*Több berendezés típus vásárlása esetén a táblázat sorainak száma bővíthető egyéni szerkesztéssel</p>
    <p class="purchase-paragraph">Telepíttető tudomásul veszi, hogy a telepítési tanúsítvány-köteles berendezéssel kapcsolatos <strong>jótállás</strong> telepítési tanúsítvány<sup>1</sup> birtokában érvényesíthető.</p>
    <p class="purchase-paragraph"><strong>Nyilatkozata megtételével egyidejűleg hozzájárul, hogy fentiekben megadott adatait a forgalmazó megismerje, kezelje, nyilvántartsa.</strong></p>
    <section class="purchase-signatures">
      <div class="purchase-date">${field("Kelt:", declarationDate(declaration.signedAt || declaration.createdAt))}</div>
      <div class="purchase-signature">
        ${signature ? `<img src="${escapeHtml(signature)}" alt="Telepíttető aláírása">` : '<div class="purchase-signature-space"></div>'}
        <div class="purchase-signature-line">Telepíttető</div>
      </div>
    </section>
    <footer class="purchase-footnote"><sup>1</sup> A klímagázokkal kapcsolatos tevékenységek végzésének feltételeiről szóló 458/2024. (XII. 30.) Korm. rendelet 28. § (7)-(10) bekezdései alapján</footer>
  </article>`).join("");
  return documentShell("Vásárlási nyilatkozat", copies, `
    .purchase-original { position: relative; width: calc(100% - 32px); max-width: 210mm; min-height: 297mm; padding: 19mm 25mm 18mm; color: black; font-family: "Times New Roman", Times, serif; font-size: 16px; line-height: 1.2; overflow-wrap: anywhere; }
    .purchase-original p { font-size: 16px; line-height: 1.2; }
    .purchase-original .purchase-copy { position: absolute; top: 8mm; right: 29mm; color: #999; font-size: 20px; }
    .purchase-original h1 { font-size: 18.67px; line-height: 1.15; font-weight: bold; }
    .purchase-original .purchase-subtitle { font-size: 13.33px; line-height: 1.15; }
    .purchase-original section { margin-top: 18px; }
    .purchase-original h2 { margin: 0 0 16px; font-weight: bold; font-size: 16px; break-after: avoid; }
    .purchase-original .purchase-seller { margin-left: 12.5mm; }
    .purchase-original .purchase-buyer { margin-left: 6.25mm; }
    .purchase-original .purchase-buyer-fields { margin-left: 6.25mm; }
    .purchase-original .purchase-person { margin-top: 24px; }
    .purchase-original .purchase-field { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0 4px; line-height: 1.35; }
    .purchase-original .purchase-field-value { flex: 1; min-width: 40px; border-bottom: 1px dotted black; padding: 0 2px; }
    .purchase-original .purchase-paragraph { margin-top: 16px; text-align: justify; }
    .purchase-original table { table-layout: fixed; margin-top: 18px; font-size: 14.67px; }
    .purchase-original th, .purchase-original td { border: .7px solid black; padding: 12px; vertical-align: middle; }
    .purchase-original th { font-weight: bold; height: 14mm; }
    .purchase-original td { height: 15mm; }
    .purchase-original tr { break-inside: avoid; }
    .purchase-original .purchase-table-note { margin-top: 5px; text-align: justify; }
    .purchase-original .purchase-signatures { display: flex; align-items: flex-end; gap: 16px; justify-content: space-between; margin-top: 18px; break-inside: avoid; }
    .purchase-original .purchase-date { flex: 1; align-self: flex-start; margin-top: 4px; }
    .purchase-original .purchase-signature { width: 82mm; max-width: 53%; text-align: center; }
    .purchase-original .purchase-signature img { display: block; margin: 0 auto 3px; max-width: 100%; height: 15mm; object-fit: contain; }
    .purchase-original .purchase-signature-space { height: 10mm; }
    .purchase-original .purchase-signature-line { border-top: .7px solid black; font-style: italic; }
    .purchase-original .purchase-footnote { margin-top: 20px; font-size: 13.33px; line-height: 1.15; break-inside: avoid; }
    .purchase-original .purchase-footnote::before { display: block; width: 50mm; border-top: .7px solid black; content: ""; margin-bottom: 7px; }
    @media screen and (max-width: 600px) { .purchase-original { padding: 55px 20px 28px; min-height: 0; } .purchase-original .purchase-copy { top: 16px; right: 20px; } .purchase-original .purchase-seller, .purchase-original .purchase-buyer, .purchase-original .purchase-buyer-fields { margin-left: 12px; } .purchase-original .purchase-signatures { flex-wrap: wrap; } .purchase-original .purchase-date { flex-basis: 100%; } .purchase-original .purchase-signature { margin-left: auto; max-width: 80%; } }
    @page { margin: 0; }
    @media print { .purchase-original { width: 210mm; max-width: 210mm; min-height: 297mm; height: auto; overflow: visible; margin: 0; padding: 19mm 25mm 18mm; line-height: 1.15; break-after: page; } .purchase-original p { line-height: inherit; } .purchase-original:last-child { break-after: auto; } .purchase-original thead { display: table-header-group; } }
  `);
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
