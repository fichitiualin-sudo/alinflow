const assert = require("node:assert/strict");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness } = require("./helpers.cjs");
const { privacyNotice } = require("./document-pdf-fixtures.cjs");

class SavedDateOnly extends Date {
  constructor(...args) {
    assert.ok(args.length, "A saved declaration must not use today's date");
    super(...args);
  }
}

const h = harness({ Date: SavedDateOnly }, { "react/jsx-runtime": require("react/jsx-runtime") });
const { PurchaseDeclarationDocument, WorkReportDocument } = h.load("src/components/alinflow/DocumentPreviewDocuments.tsx");
const { buildPurchaseDeclarationHtml, buildWorkReportHtml, buildPrivacyNoticeHtml } = h.load("src/lib/alinflow/signed-document-export.ts");
const customer = { id: "synthetic-customer", name: "", city: "Tesztváros", address: "Minta út 1.", date: "2026-09-15", quoteItems: [] };
const report = { signerName: "Different work-report signer", signatureDataUrl: "data:image/png;base64,V09SSw==", signedAt: "2026-09-15T10:00:00Z", workDate: "2026-09-15", workDescription: "", notes: "" };
const declaration = { id: "saved-declaration", customerId: customer.id, signerName: "Declaration signer", signatureDataUrl: "data:image/png;base64,REVDTA==", signedAt: "2026-10-10T22:30:00Z", createdAt: "2026-10-10T20:00:00Z", sellerName: "Synthetic seller", sellerTaxNumber: "TEST", sellerRepresentative: "Synthetic representative", quoteItems: [{ isManual: true, customName: "Synthetic AC", quantity: 1 }] };

test("saved declaration preview uses its own signature and Budapest signing date", () => {
  const html = renderToStaticMarkup(PurchaseDeclarationDocument({ customer, report, declaration, quoteItems: declaration.quoteItems }));
  assert.match(html, /Declaration signer/);
  assert.match(html, /data:image\/png;base64,REVDTA==/);
  assert.doesNotMatch(html, /Different work-report signer|V09SSw==|2026\. 09\. 15\./);
  assert.equal((html.match(/2026\. 10\. 11\./g) || []).length, 1);
});

test("report and purchase previews append one saved notice with its own signature, decision and identity", () => {
  const saved = privacyNotice({ signerName: "Privacy signer <&>" });
  for (const Document of [WorkReportDocument, PurchaseDeclarationDocument]) {
    const html = renderToStaticMarkup(Document({ customer, report: { ...report, privacyNotice: saved }, declaration, quoteItems: declaration.quoteItems }));
    const noticeHtml = html.slice(html.indexOf('class="doc-print-page privacy-notice-doc'));
    assert.equal((noticeHtml.match(/<h2[^>]*>Adatkezelési tájékoztató/g) || []).length, 1);
    assert.match(noticeHtml, /Privacy signer &lt;&amp;&gt;/);
    assert.match(noticeHtml, /Nem adtam hozzájárulást/);
    assert.match(noticeHtml, /privacy@example.invalid/);
    assert.doesNotMatch(noticeHtml, /Different work-report signer|Declaration signer/);
  }
});

test("HTML export keeps saved notice content escaped and leaves old reports without a notice", () => {
  const saved = privacyNotice({ sections: [{ title: "Mentett <cím>", text: "Mentett <script>alert(1)</script> szöveg" }] });
  const html = buildWorkReportHtml(customer, { ...report, privacyNotice: saved }, declaration.quoteItems);
  assert.equal((html.match(/<article class="page privacy-notice"/g) || []).length, 1);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(buildWorkReportHtml(customer, report, []), /<article class="page privacy-notice"/);
  assert.match(buildPrivacyNoticeHtml(saved, "2026-10-12T12:00:00Z"), /később visszavonták/);
});

test("an unsigned saved declaration does not borrow another report signature or date", () => {
  const html = renderToStaticMarkup(PurchaseDeclarationDocument({ customer, report, declaration: { ...declaration, signatureDataUrl: "", signedAt: undefined, createdAt: "2026-10-09T22:30:00Z" }, quoteItems: declaration.quoteItems }));
  assert.doesNotMatch(html, /<img|V09SSw==|2026\. 09\. 15\./);
  assert.equal((html.match(/2026\. 10\. 10\./g) || []).length, 1);
});

test("declaration archive preserves one copy, original clauses, escaped data and saved date", () => {
  const html = buildPurchaseDeclarationHtml(customer, { ...declaration, sellerName: "Saved seller <&>" });
  assert.equal((html.match(/<article /g) || []).length, 1);
  assert.doesNotMatch(html, /I\. példány|II\. példány/);
  assert.equal((html.match(/2026\. 10\. 11\./g) || []).length, 1);
  assert.equal((html.match(/Saved seller &lt;&amp;&gt;/g) || []).length, 1);
  assert.match(html, /2024\/573/);
  assert.match(html, /Több berendezés típus vásárlása/);
  assert.match(html, /Nyilatkozata megtételével egyidejűleg hozzájárul/);
  assert.doesNotMatch(html, /Different work-report signer|V09SSw==/);
});
