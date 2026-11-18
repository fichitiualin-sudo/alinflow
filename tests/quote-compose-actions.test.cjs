const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness } = require("./helpers.cjs");

const h = harness({}, { react: React, "react/jsx-runtime": require("react/jsx-runtime") });
const { QuoteBuilderPanel } = h.load("src/components/alinflow/QuoteBuilderPanel.tsx");
const { QuotePreviewPanel } = h.load("src/components/alinflow/QuotePreviewPanel.tsx");
const { defaultWorkspaceSettings } = h.load("src/lib/alinflow/workspace-settings.ts");
const sentAt = "2026-11-18T20:45:00Z";
const customer = { name: "Minta", email: "ugyfel@example.invalid" };
const base = {
  quoteItems: [], products: [], selected: customer, totalAmount: 0, quoteEmailBusy: false,
  quoteIssuedAt: sentAt, workspaceSettings: defaultWorkspaceSettings(),
};
const newOffer = React.createElement("button", null, "Új árajánlat");

// Read only real button elements and their callbacks in the component being tested.
function button(node, label) {
  if (!React.isValidElement(node)) return;
  if (node.type === "button" && node.props.children === label) return node.props;
  for (const child of React.Children.toArray(node.props.children)) {
    const found = button(child, label);
    if (found) return found;
  }
}

test("drafts take the user to a preview before the first email", () => {
  let previews = 0;
  const builder = QuoteBuilderPanel({ ...base, onPreview: () => previews++ });
  button(builder, "Előnézet és küldés").onClick();
  assert.equal(previews, 1);
  assert.doesNotMatch(renderToStaticMarkup(builder), /Ajánlat küldése emailben|Ajánlat elküldése|Új árajánlat|Még nincs visszaigazolt|Korábban elküldve/);
  const send = () => {};
  const preview = QuotePreviewPanel({ ...base, onSendQuote: send });
  assert.match(renderToStaticMarkup(preview), /Címzett[\s\S]*ugyfel@example\.invalid/);
  assert.equal(button(preview, "Ajánlat elküldése").onClick, send);
  assert.equal(button(preview, "Ajánlat elküldése").disabled, false);
});

test("after sending, the new offer precedes the current draft preview; an unfinished attempt takes priority", () => {
  const props = { ...base, quoteSentAt: sentAt, quoteActions: newOffer };
  const sent = renderToStaticMarkup(QuoteBuilderPanel(props));
  assert.equal((sent.match(/<time\b/g) ?? []).length, 1);
  assert.match(sent, /Új árajánlat[\s\S]*Aktuális ajánlat előnézete/);
  const pending = renderToStaticMarkup(QuoteBuilderPanel({ ...props, deliveryStep: "retry" }));
  assert.match(pending, /Megkezdett küldés folytatása[\s\S]*Új árajánlat/);
  const preview = QuotePreviewPanel(props);
  assert.ok(button(preview, "Aktuális ajánlat elküldése"));
  assert.ok(button(QuotePreviewPanel({ ...props, deliveryStep: "retry" }), "Küldés újrapróbálása"));
});

test("a missing email prevents sending but permits printing and completing a confirmed receipt", () => {
  const props = { ...base, selected: { ...customer, email: "   " }, onPrint() {} };
  const unsent = QuotePreviewPanel(props);
  assert.equal(button(unsent, "Ajánlat elküldése").disabled, true);
  assert.equal(button(unsent, "Nyomtatás / mentés PDF-be").onClick, props.onPrint);
  assert.match(renderToStaticMarkup(unsent), /add meg az ügyfél email-címét/);
  const accepted = QuotePreviewPanel({ ...props, deliveryStep: "record" });
  assert.equal(button(accepted, "Küldés naplózásának befejezése").disabled, false);
  const html = renderToStaticMarkup(accepted);
  assert.match(html, /<input type="checkbox"[^>]*disabled/);
  assert.doesNotMatch(html, /add meg az ügyfél email-címét/);
});
