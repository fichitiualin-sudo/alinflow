const { test } = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness } = require("./helpers.cjs");

function fixture(read) {
  const requests = [], slots = [];
  let cursor = 0;
  const supabase = { from(table) {
    const call = { table, eq: {}, order: [] };
    requests.push(call);
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
  const { QuoteHistoryPanel } = harness({}, {
    react, "react/jsx-runtime": require("react/jsx-runtime"), "@/lib/supabase": { supabase },
  }).load("src/components/alinflow/QuoteHistoryPanel.tsx");
  function nodes(tree) {
    return !React.isValidElement(tree) ? [] : [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)];
  }
  function render(revision = 0) {
    cursor = 0;
    const element = QuoteHistoryPanel({ workspaceId: "office", customerId: "client", revision });
    const tree = element.type(element.props);
    return {
      html: renderToStaticMarkup(tree),
      click(label) {
        const element = nodes(tree).find(node => node.type === "button" && renderToStaticMarkup(node).includes(label));
        assert.ok(element, `Missing ${label}`);
        element.props.onClick();
      },
    };
  }
  return { render, requests };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const archive = { id: "d1", sent_at: "2026-11-18T09:00:00Z", recipient: "teszt@example.invalid", items: [
  { name: "Minta 1", quantity: 1, unitPrice: 101, totalPrice: 101 },
  { name: "Minta 2", quantity: 1, unitPrice: 202, totalPrice: 202 },
], total_amount: 303, pricing_mode: "alternatives" };

test("opens quote history on demand and shows sent prices separately from saved records", async () => {
  const f = fixture(call => ({ data: call.table === "quote_delivery_history" ? [archive] : [{
    id: "q1", created_at: "2026-11-17T09:00:00Z", total_amount: null,
    quote_items: [{ product_name: "Minta régi", quantity: 1, unit_price: null, total_price: null }],
  }] }));
  f.render().click("Korábbi árajánlatok");
  assert.equal(f.requests.length, 0);
  f.render(); await settle();
  let panel = f.render();
  assert.match(panel.html, /teszt@example.invalid/);
  assert.match(panel.html, /101 Ft/); assert.match(panel.html, /202 Ft/);
  assert.doesNotMatch(panel.html, /303 Ft/);
  const sent = f.requests[0];
  assert.deepEqual(sent.eq, { workspace_id: "office", customer_id: "client" });
  assert.deepEqual(sent.not, ["sent_at", "is", null]);
  panel.click("Mentett ajánlatok");
  f.render(); await settle(); panel = f.render();
  assert.match(panel.html, /Minta régi/);
  assert.match(panel.html, /Tételár nincs rögzítve/);
  assert.doesNotMatch(panel.html, /teszt@example.invalid|101 Ft|303 Ft|0 Ft/);
  assert.deepEqual(f.requests[1].eq, { workspace_id: "office", customer_id: "client", "quote_items.workspace_id": "office" });
});

test("pages sent records in tens and discards a delayed response from the previous tab", async () => {
  let resolveNext;
  const f = fixture(call => {
    if (call.table === "quotes") return { data: [] };
    if (call.range[0] === 10) return new Promise(resolve => { resolveNext = resolve; });
    return { data: Array.from({ length: 11 }, (_, i) => ({ ...archive, id: String(i), recipient: `contact-${i}@example.invalid` })) };
  });
  f.render().click("Korábbi árajánlatok"); f.render(); await settle();
  const panel = f.render();
  assert.match(panel.html, /contact-9@/); assert.doesNotMatch(panel.html, /contact-10@/);
  panel.click("Következő");
  f.render().click("Mentett ajánlatok"); f.render(); await settle();
  resolveNext({ data: [archive] }); await settle();
  assert.match(f.render().html, /Nincs mentett ajánlat/);
  assert.doesNotMatch(f.render().html, /teszt@example.invalid/);
  assert.deepEqual(f.requests.map(request => request.range), [[0, 10], [10, 20], [0, 10]]);
});

test("a failed archive read does not hide surviving saved quote rows or present them as sent", async () => {
  const f = fixture(call => call.table === "quote_delivery_history" ? { error: { message: "Internal query error" } }
    : { data: [{ id: "old", created_at: "2026-11-10T10:00:00Z", total_amount: 450,
      quote_items: [{ product_name: "Korábbi modell", quantity: 2, unit_price: 225, total_price: 450 }] }] });
  f.render().click("Korábbi árajánlatok"); f.render(); await settle();
  const failed = f.render();
  assert.match(failed.html, /betöltés nem sikerült/);
  assert.doesNotMatch(failed.html, /Internal query error|Még nincs archivált/);
  failed.click("Mentett ajánlatok"); f.render(); await settle();
  const saved = f.render().html;
  assert.match(saved, /Korábbi modell/); assert.match(saved, /225 Ft \/ db/); assert.match(saved, /450 Ft/);
  assert.match(saved, /Létrehozva/); assert.doesNotMatch(saved, /Elküldve/);
});
