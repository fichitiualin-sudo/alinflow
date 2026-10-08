const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness } = require("./helpers.cjs");
const { QuoteEmailStatus } = harness({}, { "react/jsx-runtime": require("react/jsx-runtime") })
  .load("src/components/alinflow/QuoteEmailStatus.tsx");

test("quote shows a persistent, correctly localized timestamp from a confirmed receipt", () => {
  const html = renderToStaticMarkup(React.createElement(QuoteEmailStatus, { sentAt: "2026-10-08T16:42:20.000Z" }));
  assert.match(html, /Utolsó emailküldés/);
  assert.match(html, /datetime="2026-10-08T16:42:20.000Z"/i);
  assert.match(html, /18:42/);
  assert.doesNotMatch(html, /nincs visszaigazolt/);
});

for (const sentAt of [undefined, "invalid"]) {
  test(`missing or invalid delivery proof does not show a sent timestamp: ${sentAt}`, () => {
    const html = renderToStaticMarkup(React.createElement(QuoteEmailStatus, { sentAt }));
    assert.match(html, /Még nincs visszaigazolt emailküldés/);
    assert.doesNotMatch(html, /<time/);
  });
}
