const { test } = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness } = require("./helpers.cjs");

const fields = { workspace_id: "office", customer_id: "client" };
const stamp = "2026-11-18T09:00:00.000123Z";
const items = [{ name: "Minta klíma", quantity: 1, unitPrice: 0, totalPrice: 0 }];
const archive = { id: "d1", appointment_id: "work", quote_id: "q1", issued_at: "2026-11-17T09:00:00Z",
  sent_at: stamp, recipient: "teszt@example.invalid", items, total_amount: 0, pricing_mode: "bundle" };
const saved = { id: "q1", appointment_id: "work", updated_at: "2026-11-17T09:00:00Z", total_amount: 0,
  quote_items: [{ product_name: "Minta klíma", quantity: "1", unit_price: "0", total_price: "0" }] };
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(read) {
  const calls = [], slots = [], previews = [];
  let cursor = 0;
  const supabase = { from(table) {
    const call = { table, eq: {}, order: [] };
    calls.push(call);
    return {
      select(fields) { call.fields = fields; return this; },
      eq(field, value) { call.eq[field] = value; return this; },
      not(...args) { call.not = args; return this; },
      order(field) { call.order.push(field); return this; },
      range(start, end) { call.range = [start, end]; return read(call); },
    };
  } };
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, next => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((dep, i) => dep !== slots[index].deps[i])) {
        slots[index]?.clean?.();
        slots[index] = { deps, clean: effect() };
      }
    },
  };
  const h = harness({}, { react, "react/jsx-runtime": require("react/jsx-runtime"), "@/lib/supabase": { supabase } });
  const { QuoteDocuments } = h.load("src/components/alinflow/QuoteDocuments.tsx");
  const data = h.load("src/lib/alinflow/quote-documents.ts");
  function nodes(tree) {
    return !React.isValidElement(tree) ? [] : [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)];
  }
  function render(extra) {
    cursor = 0;
    const element = QuoteDocuments({ workspaceId: "office", customerId: "client", onPreview: row => previews.push(row), ...extra });
    const tree = element.type(element.props);
    return {
      html: renderToStaticMarkup(tree),
      click(label, index = 0) {
        const button = nodes(tree).filter(node => node.type === "button" && node.props.children === label)[index];
        assert.ok(button, `Missing ${label}`);
        button.props.onClick();
      },
    };
  }
  return { ...data, render, calls, previews };
}

function readLists(sent, stored, cap = 500) {
  return ({ table, range: [from, to] }) => ({
    data: (table === "quotes" ? stored : sent).slice(from, Math.min(to + 1, from + cap)),
  });
}

test("documents keep every real delivery, deduplicate unchanged saved content and only its matching legacy receipt", async () => {
  const archives = [archive, { ...archive, id: "d2", sent_at: "2026-11-19T09:00:00Z" }];
  const f = fixture(readLists(archives, [saved, { ...saved, id: "other-quote" }]));
  const sources = await f.loadQuoteDocuments("office", "client");
  const entries = f.quoteDocumentRows(sources, [
    { id: "matches", sentAt: "2026-11-18T10:00:00.000123+01:00", appointmentId: "work" },
    { id: "other-micros", sentAt: "2026-11-18T09:00:00.000124Z", appointmentId: "work" },
    { id: "other-work", sentAt: stamp, appointmentId: "another" },
  ], {});
  assert.deepEqual(Array.from(entries, row => row.id), ["d2", "other-micros", "d1", "other-work", "other-quote"]);
  assert.equal(entries[0].items[0].totalPrice, 0);
  assert.equal(entries[0].recipient, archive.recipient);
  assert.equal(f.calls.every(call => call.eq.workspace_id === "office" && call.eq.customer_id === "client"), true);
  assert.deepEqual(f.calls[0].not, ["sent_at", "is", null]);
  assert.deepEqual(f.calls[1].eq, { ...fields, "quote_items.workspace_id": "office" });
  assert.doesNotMatch(f.calls[0].fields, /email_payload|provider_key/);
});

test("work shows its pending quote and independent customer offers, while the library also shows other works", async () => {
  const sent = [archive, { ...archive, id: "pending", appointment_id: null },
    { ...archive, id: "standalone", appointment_id: null, quote_id: null },
    { ...archive, id: "foreign", appointment_id: "another" },
    { ...archive, id: "foreign-pending", appointment_id: null, quote_id: "q2" }];
  const stored = [{ ...saved, quote_items: [{ product_name: "Másik ár", quantity: 1, unit_price: 200, total_price: 200 }], total_amount: 200 },
    { ...saved, id: "unrelated-saved", appointment_id: "another" }, { ...saved, id: "empty-work", quote_items: [] }];
  const f = fixture(readLists(sent, stored));
  const sources = await f.loadQuoteDocuments("office", "client");
  const scoped = f.quoteDocumentRows(sources, [], { appointmentId: "work", activeQuoteId: "q1" });
  assert.deepEqual(Array.from(scoped, row => row.id).sort(), ["d1", "pending", "q1", "standalone"]);
  assert.deepEqual(Array.from(f.quoteDocumentRows(sources, [], {}), row => row.id).sort(),
    ["d1", "foreign", "foreign-pending", "pending", "q1", "standalone", "unrelated-saved"]);
  assert.equal(scoped.find(row => row.kind === "saved").items[0].totalPrice, 200);
});

test("scheduling can attach the original quote and its receipt later without duplicating the sent offer", async () => {
  const f = fixture(readLists([{ ...archive, appointment_id: null }, { ...archive, id: "standalone", quote_id: null,
    appointment_id: null, sent_at: "2026-11-01T10:00:00Z" }], [saved]));
  const sources = await f.loadQuoteDocuments("office", "client");
  const receipts = [{ id: "later", sentAt: stamp, appointmentId: "work" }, { id: "earlier", sentAt: stamp },
    { id: "unrelated", sentAt: stamp, appointmentId: "another" },
    { id: "independent", sentAt: "2026-11-01T10:00:00Z", appointmentId: "work" }];
  const ids = scope => Array.from(f.quoteDocumentRows(sources, receipts, scope), row => row.id).sort();
  assert.deepEqual(ids({}), ["d1", "independent", "standalone", "unrelated"]);
  assert.deepEqual(ids({ appointmentId: "work" }), ["d1", "independent", "standalone"]);
  assert.deepEqual(ids({ appointmentId: "another", activeQuoteId: "q1" }), ["earlier", "standalone", "unrelated"]);
  const direct = fixture(readLists([archive], [saved]));
  const directRows = await direct.loadQuoteDocuments("office", "client");
  const reverse = direct.quoteDocumentRows(directRows, [
    { id: "unproven", sentAt: stamp }, { id: "proven", sentAt: stamp, quoteId: "q1" },
  ], {});
  assert.deepEqual(Array.from(reverse, row => row.id).sort(), ["d1", "unproven"]);
});

test("rows are available without a separate tab, open their own frozen record, and page in tens across database limits", async () => {
  const sent = Array.from({ length: 1031 }, (_, i) => ({
    ...archive, id: String(i).padStart(4, "0"), items: [{ ...items[0], name: "Klíma " + i }],
    pricing_mode: "alternatives", total_amount: 340000,
  }));
  const f = fixture(readLists(sent, [], 300));
  f.render(); await settle();
  const panel = f.render();
  assert.doesNotMatch(panel.html, /role="tab"|340 000|Küldési nyugta/);
  assert.match(panel.html, /Klíma 9</);
  assert.doesNotMatch(panel.html, /Klíma 10</);
  panel.click("Megtekintés", 9);
  assert.equal(f.previews[0].id, "0009");
  assert.equal(f.previews[0].issuedAt, archive.issued_at);
  panel.click("Következő");
  assert.match(f.render().html, /Klíma 10</);
  assert.deepEqual(f.calls.filter(call => call.table === "quote_delivery_history").map(call => call.range[0]),
    [0, 300, 600, 900, 1031]);
});

test("an unavailable archive leaves saved prices readable and permits retry; an old receipt never opens today's version", async () => {
  let unavailable = true;
  const f = fixture(call => call.table === "quote_delivery_history" && unavailable ? { error: Error("offline") }
    : readLists([], [saved])(call));
  const props = { receipts: [{ id: "receipt", sentAt: stamp, appointmentId: "work" }] };
  f.render(props); await settle();
  const panel = f.render(props);
  assert.match(panel.html, /role="alert"/);
  assert.match(panel.html, /küldési nyugta/);
  assert.equal((panel.html.match(/Megtekintés/g) || []).length, 1);
  panel.click("Megtekintés");
  assert.equal(f.previews[0].kind, "saved");
  unavailable = false;
  panel.click("Újrapróbálás");
  f.render(props); await settle();
  assert.doesNotMatch(f.render(props).html, /role="alert"/);
});
