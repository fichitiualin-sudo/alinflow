const assert = require("node:assert/strict");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness } = require("./helpers.cjs");

const h = harness({}, { "react/jsx-runtime": require("react/jsx-runtime") });
const { QuoteDocumentVersionPreview } = h.load("src/components/alinflow/QuoteDocumentVersionPreview.tsx");
const { defaultWorkspaceSettings } = h.load("src/lib/alinflow/workspace-settings.ts");
const workspaceSettings = defaultWorkspaceSettings({ name: "Minta munkaterület" });
const customer = { name: "Teszt Ügyfél", email: "most@example.invalid", quoteItems: [{ customName: "Mai tétel" }] };
const sent = {
  id: "sample", kind: "sent", issuedAt: "2026-11-17T23:30:00Z", timestamp: "2026-11-18T12:50:00Z",
  recipient: "eredeti@example.invalid", alternatives: false, total: 21,
  items: [{ name: "Tárolt típus", quantity: 1, unitPrice: 25, totalPrice: 21, productUrl: "https://klimalin.hu/termek" }],
};
const render = document => renderToStaticMarkup(QuoteDocumentVersionPreview({ document, customer, workspaceSettings }));

test("sent quote documents retain the delivery recipient, issued and sent times and recorded amounts", () => {
  const html = render(sent);
  assert.match(html, /Minta munkaterület/);
  assert.match(html, /eredeti@example\.invalid/);
  assert.doesNotMatch(html, /most@example\.invalid|Mai tétel/);
  assert.match(html, /Kiállítva<\/dt><dd>[^<]*18\.[^<]*0?0:30/);
  assert.match(html, /Elküldve<\/dt><dd>[^<]*18\.[^<]*13:50/);
  assert.match(html, /Tárolt típus/);
  assert.match(html, /25 Ft \/ db/);
  assert.match(html, /21 Ft/);
  assert.match(html, /Bruttó végösszeg/);
  assert.match(html, /href="https:\/\/klimalin\.hu\/termek"/);
});

test("alternatives remain separately priced and untrusted links cannot become document actions", () => {
  const html = render({ ...sent, alternatives: true, total: 898989, items: [
    { name: "Alap", quantity: 1, unitPrice: 0, totalPrice: 0, productUrl: "javascript:alert(1)" },
    { name: "Második", quantity: 2, unitPrice: 100, totalPrice: 200, productUrl: "https://klimalin.hu.example.invalid/termek" },
  ] });
  assert.match(html, /Választható ajánlatok/);
  assert.match(html, /2\. lehetőség/);
  assert.match(html, /0 Ft/);
  assert.match(html, /200 Ft/);
  assert.doesNotMatch(html, /Bruttó végösszeg|898.?989|href=|<button/);
});

test("old saved quote documents distinguish a missing price and date from zero or today's values", () => {
  const html = render({ id: "old", kind: "saved", alternatives: false, timestamp: null, total: null,
    items: [{ name: "Régi tétel", quantity: null, unitPrice: null, totalPrice: null }] });
  assert.match(html, /Mentve<\/dt><dd>Nincs rögzítve/);
  assert.match(html, /Tételár nincs rögzítve/);
  assert.match(html, /Mennyiség nincs rögzítve/);
  assert.doesNotMatch(html, /Elküldve|Kiállítva|0 Ft|\/ db|Mai tétel/);
});
