const { test } = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { harness } = require("./helpers.cjs");

const originalSurvey = Object.freeze({
  id: "client", name: "Minta Ügyfél", email: "teszt@example.invalid", status: "Lezárva",
  appointmentType: "survey", activeAppointmentId: "survey", date: "2026-10-14", time: "08:00",
  activeQuoteId: "earlier-quote", quotePricingMode: "alternatives", quoteSentAt: "2026-10-14T10:00:00Z",
  quoteItems: Object.freeze([Object.freeze({ productId: "old-product", productName: "Korábbi klíma", quantity: 2, customPrice: 110000 })]),
});

function composer(onSend, stored = new Map(), sessionScope = "test-office:user", customer = originalSurvey) {
  const slots = [];
  let cursor, successes = 0;
  function slot(initial) {
    const index = cursor++;
    slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
    return slots[index];
  }
  const react = {
    useState(initial) {
      const state = slot(initial);
      return [state.value, next => { state.value = typeof next === "function" ? next(state.value) : next; }];
    },
    useRef(initial) { return slot({ current: initial }).value; },
  };
  const QuoteBuilderPanel = () => null;
  const QuotePreviewPanel = () => null;
  const sessionStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
  const { AdditionalQuotePanel } = harness({ TextEncoder, sessionStorage }, {
    react, "react/jsx-runtime": require("react/jsx-runtime"),
    "./QuoteBuilderPanel": { QuoteBuilderPanel }, "./QuotePreviewPanel": { QuotePreviewPanel },
  }).load("src/components/alinflow/AdditionalQuotePanel.tsx");
  function render() {
    cursor = 0;
    const result = AdditionalQuotePanel({ customer, sessionScope, products: [], settings: {},
      onBack: () => {}, onSend, onSent: () => { successes++; } });
    return React.Children.toArray(result.props.children);
  }
  function builder() { return render().find(element => element.type === QuoteBuilderPanel).props; }
  function preview() { return render().find(element => element.type === QuotePreviewPanel).props; }
  function configure(model, price) {
    builder().onAddManualQuoteItem();
    builder().onRemoveQuoteItem(0);
    builder().onUpdateQuoteItem(0, "customName", model);
    builder().onUpdateQuoteItem(0, "customPrice", price);
  }
  return { builder, preview, configure, render, successes: () => successes };
}

test("two new offers on a closed survey start empty and send independent prices, models and delivery identifiers", async () => {
  const before = JSON.stringify(originalSurvey);
  const deliveries = [];
  for (const [model, price] of [["Teszt klíma A", 220000], ["Teszt klíma B", 279000]]) {
    const panel = composer(async (...args) => { deliveries.push(args); });
    const first = panel.builder();
    assert.deepEqual(JSON.parse(JSON.stringify(first.quoteItems)), [{ productId: "", quantity: 1 }]);
    assert.equal(first.quotePricingMode, "bundle");
    assert.equal(first.onSchedule, undefined);
    await first.onSendQuoteEmail(); // An empty offer is never submitted.
    assert.equal(panel.successes(), 0);
    panel.configure(model, price);
    panel.builder().onPreview();
    const preview = panel.preview();
    assert.equal(preview.totalAmount, price);
    assert.equal(preview.onSchedule, undefined);
    await preview.onSendQuote();
    assert.equal(panel.successes(), 1);
  }
  assert.equal(deliveries.length, 2);
  for (let i = 0; i < deliveries.length; i++) {
    const [items, mode, issuedAt, id] = deliveries[i];
    assert.equal(items.length, 1);
    assert.equal(items[0].customName, ["Teszt klíma A", "Teszt klíma B"][i]);
    assert.equal(items[0].customPrice, [220000, 279000][i]);
    assert.equal(mode, "bundle");
    assert.ok(Number.isFinite(Date.parse(issuedAt)));
    assert.match(id, /^[0-9a-f-]{36}$/i);
  }
  assert.notEqual(deliveries[0][3], deliveries[1][3]);
  assert.equal(JSON.stringify(originalSurvey), before);
});

test("a double click sends one request while pending and an uncertain send retries the identical offer from preview", async () => {
  const attempts = [];
  let rejectFirst, signalStart;
  const firstRequestStarted = new Promise(resolve => { signalStart = resolve; });
  const panel = composer((...args) => {
    attempts.push(JSON.parse(JSON.stringify(args)));
    return attempts.length === 1 ? new Promise((_, reject) => { rejectFirst = reject; signalStart(); }) : Promise.resolve();
  });
  panel.configure("Teszt klíma C", 318000);
  panel.builder().onQuotePricingModeChange("alternatives");
  const send = panel.builder().onSendQuoteEmail;
  const pending = send();
  await send();
  await firstRequestStarted;
  assert.equal(attempts.length, 1);
  assert.equal(panel.builder().quoteEmailBusy, true);
  rejectFirst(new Error("connection interrupted")); await pending;
  assert.equal(panel.successes(), 0);
  assert.equal(panel.builder().quoteEmailBusy, false);
  assert.ok(panel.render().some(element => element.props.role === "alert"));
  panel.builder().onPreview();
  await panel.preview().onSendQuote();
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(attempts[1][1], "alternatives");
  assert.equal(panel.successes(), 1);
});

test("a reloaded composer reuses an uncertain token only for the same office, recipient, prices and content", async () => {
  const stored = new Map(), calls = [];
  async function send(price, scope, fail, customer = originalSurvey) {
    const panel = composer(async (...args) => {
      calls.push(JSON.parse(JSON.stringify(args)));
      if (fail) throw new Error("network interrupted");
    }, stored, scope, customer);
    panel.configure("Minta klíma D", price);
    await panel.builder().onSendQuoteEmail();
    assert.equal(panel.successes(), fail ? 0 : 1);
  }
  await send(198000, "office-a:user", true);
  const first = calls[0];
  assert.doesNotMatch(JSON.stringify([...stored]), /Minta klíma D|teszt@example\.invalid|198000/);
  await send(199000, "office-a:user", false);
  await send(198000, "office-b:user", false);
  assert.notEqual(calls[1][3], first[3]);
  assert.notEqual(calls[2][3], first[3]);
  await send(198000, "office-a:user", false, { ...originalSurvey, email: "other@example.invalid" });
  assert.notEqual(calls[3][3], first[3]);
  await send(198000, "office-a:user", false);
  assert.deepEqual(calls[4], first);
  assert.equal(stored.size, 0);
  await send(198000, "office-a:user", false);
  assert.notEqual(calls[5][3], first[3]);
});
