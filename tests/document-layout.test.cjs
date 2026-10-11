const assert = require("node:assert/strict");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness } = require("./helpers.cjs");

class SavedDateOnly extends Date {
  constructor(...args) {
    assert.ok(args.length, "A saved declaration must not use today's date");
    super(...args);
  }
}

const h = harness({ Date: SavedDateOnly }, { "react/jsx-runtime": require("react/jsx-runtime") });
const { PurchaseDeclarationDocument } = h.load("src/components/alinflow/DocumentPreviewDocuments.tsx");
const { buildPurchaseDeclarationHtml } = h.load("src/lib/alinflow/signed-document-export.ts");
const customer = { id: "synthetic-customer", name: "", city: "Tesztváros", address: "Minta út 1.", date: "2026-09-15", quoteItems: [] };
const report = { signerName: "Different work-report signer", signatureDataUrl: "data:image/png;base64,V09SSw==", signedAt: "2026-09-15T10:00:00Z", workDate: "2026-09-15", workDescription: "", notes: "" };
const declaration = { id: "saved-declaration", customerId: customer.id, signerName: "Declaration signer", signatureDataUrl: "data:image/png;base64,REVDTA==", signedAt: "2026-10-10T22:30:00Z", createdAt: "2026-10-10T20:00:00Z", sellerName: "Synthetic seller", sellerTaxNumber: "TEST", sellerRepresentative: "Synthetic representative", quoteItems: [{ isManual: true, customName: "Synthetic AC", quantity: 1 }] };

test("saved declaration preview uses its own signature and Budapest signing date", () => {
  const html = renderToStaticMarkup(PurchaseDeclarationDocument({ customer, report, declaration, quoteItems: declaration.quoteItems }));
  assert.match(html, /Declaration signer/);
  assert.match(html, /data:image\/png;base64,REVDTA==/);
  assert.doesNotMatch(html, /Different work-report signer|V09SSw==|2026\. 09\. 15\./);
  assert.equal((html.match(/2026\. 10\. 11\./g) || []).length, 2);
});

test("an unsigned saved declaration does not borrow another report signature or date", () => {
  const html = renderToStaticMarkup(PurchaseDeclarationDocument({ customer, report, declaration: { ...declaration, signatureDataUrl: "", signedAt: undefined, createdAt: "2026-10-09T22:30:00Z" }, quoteItems: declaration.quoteItems }));
  assert.doesNotMatch(html, /<img|V09SSw==|2026\. 09\. 15\./);
  assert.equal((html.match(/2026\. 10\. 10\./g) || []).length, 2);
});

test("declaration archive preserves both copies, original clauses, escaped data and saved date", () => {
  const html = buildPurchaseDeclarationHtml(customer, { ...declaration, sellerName: "Saved seller <&>" });
  assert.match(html, /I\. példány/);
  assert.match(html, /II\. példány/);
  assert.equal((html.match(/2026\. 10\. 11\./g) || []).length, 2);
  assert.equal((html.match(/Saved seller &lt;&amp;&gt;/g) || []).length, 2);
  assert.match(html, /2024\/573/);
  assert.match(html, /Több berendezés típus vásárlása/);
  assert.match(html, /Nyilatkozata megtételével egyidejűleg hozzájárul/);
  assert.doesNotMatch(html, /Different work-report signer|V09SSw==/);
});
