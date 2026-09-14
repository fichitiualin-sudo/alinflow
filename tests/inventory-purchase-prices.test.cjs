const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database } = require("./helpers.cjs");

const workspace = "10000000-0000-0000-0000-000000000001";
const other = "10000000-0000-0000-0000-000000000002";
const item = { itemType: "climate", itemKey: "climate-1" };
const row = (patch = {}) => ({ workspace_id: workspace, item_type: item.itemType, item_key: item.itemKey,
  purchase_price: "120000.50", tax_basis: "gross", updated_at: "2026-09-14T20:30:00.123456+00:00", ...patch });
function store(handler = () => { throw Error("Unexpected database access"); }) {
  return harness({}, { "@/lib/supabase": { supabase: database(handler) } }).load("src/lib/alinflow/inventory-purchase-prices.ts");
}

test("purchase prices distinguish missing, zero, decimal HUF and invalid input", () => {
  const { parsePurchasePrice } = store();
  for (const empty of ["", " "]) assert.equal(parsePurchasePrice(empty), null);
  for (const [value, expected] of [["0", 0], [" 120000,50 ", 120000.5], ["12.34", 12.34], ["999999999.99", 999999999.99]]) {
    assert.equal(parsePurchasePrice(value), expected);
  }
  for (const value of ["-1", "NaN", "Infinity", "1e5", "12.345", "12,34.56", "1.000.000", "1000000000", "undefined"]) {
    assert.throws(() => parsePurchasePrice(value));
  }
});

test("private prices load every batch in stable order within the exact workspace", async () => {
  const operations = [];
  const api = store((op) => {
    operations.push(op);
    if (op.range[0] === 0) return { data: Array.from({ length: 500 }, (_, i) => row({ item_key: `climate-${i}` })), error: null };
    return { data: [row({ item_type: "material", item_key: "Rézcső", purchase_price: null, tax_basis: "net" })], error: null };
  });
  const values = await api.listInventoryPurchasePrices(workspace);
  assert.equal(values.length, 501);
  assert.equal(values[0].purchasePrice, 120000.5);
  assert.equal(values[500].purchasePrice, null);
  assert.equal(values[500].taxBasis, "net");
  for (const op of operations) {
    assert.equal(op.table, "inventory_purchase_prices");
    assert.deepEqual(op.filters, { workspace_id: workspace });
    assert.deepEqual(op.order, ["item_type", "item_key"]);
  }
  assert.deepEqual(operations.map((op) => op.range), [[0, 499], [500, 999]]);
});

test("private price reads fail closed on unavailable or wrong-scope data", async () => {
  for (const response of [{ data: null, error: { code: "42P01" } }, { data: [row({ workspace_id: other })] },
    { data: [row({ purchase_price: "NaN" })] }, { data: [row({ updated_at: null })] }, { data: [row({ tax_basis: "unknown" })] }]) {
    await assert.rejects(store(() => response).listInventoryPurchasePrices(workspace));
  }
  await assert.rejects(store().listInventoryPurchasePrices(""));
});

test("new private prices write only the independent price table and roundtrip", async () => {
  const operations = [];
  const api = store((op) => {
    operations.push(op);
    return { data: row({ ...op.value, updated_at: "server-version" }), error: null };
  });
  const saved = await api.saveInventoryPurchasePrice(workspace, item, "81000,25", "net");
  assert.equal(saved.purchasePrice, 81000.25);
  assert.equal(saved.taxBasis, "net");
  assert.equal(saved.updatedAt, "server-version");
  assert.equal(operations.length, 1);
  assert.equal(operations[0].table, "inventory_purchase_prices");
  assert.equal(operations[0].method, "insert");
  assert.deepEqual({ ...operations[0].value }, { workspace_id: workspace, item_type: "climate", item_key: "climate-1", purchase_price: 81000.25, tax_basis: "net" });
  assert.equal(saved.price, undefined);
  assert.equal(saved.installPrice, undefined);
});

test("existing price edits preserve target identity and guard the server version", async () => {
  let write;
  const existing = { workspaceId: workspace, ...item, purchasePrice: 120000.5, taxBasis: "gross", updatedAt: "old-version" };
  const api = store((op) => { write = op; return { data: row({ purchase_price: null, updated_at: "new-version" }), error: null }; });
  const saved = await api.saveInventoryPurchasePrice(workspace, item, "", "gross", existing);
  assert.equal(saved.purchasePrice, null);
  assert.equal(saved.updatedAt, "new-version");
  assert.equal(write.method, "update");
  assert.deepEqual({ ...write.value }, { purchase_price: null, tax_basis: "gross" });
  assert.deepEqual(write.filters, { workspace_id: workspace, item_type: "climate", item_key: "climate-1", updated_at: "old-version" });
});

test("stale and racing creates never fall back to unguarded upserts", async () => {
  for (const code of ["23505", "PGRST116"]) {
    let writes = 0;
    const api = store(() => { writes++; return { data: null, error: { code } }; });
    await assert.rejects(api.saveInventoryPurchasePrice(workspace, item, "500", "gross"), /közben máshol/);
    assert.equal(writes, 1);
  }
  await assert.rejects(store(() => ({ data: null, error: { code: "42501" } })).saveInventoryPurchasePrice(workspace, item, "500", "gross"), /nem sikerült menteni/);
});

test("invalid and cross-workspace writes stop before any database call", async () => {
  const api = store();
  const existing = { workspaceId: other, ...item, purchasePrice: 123, taxBasis: "gross", updatedAt: "old" };
  await assert.rejects(api.saveInventoryPurchasePrice(workspace, item, "100", "gross", existing), /másik készlettétel/);
  await assert.rejects(api.saveInventoryPurchasePrice(workspace, item, "100", "gross", { ...existing, workspaceId: workspace, itemKey: "other" }));
  await assert.rejects(api.saveInventoryPurchasePrice(workspace, item, "100", "gross", { ...existing, workspaceId: workspace, updatedAt: "" }));
  await assert.rejects(api.saveInventoryPurchasePrice(workspace, { ...item, itemType: "customer" }, "100", "gross"));
  await assert.rejects(api.saveInventoryPurchasePrice(workspace, item, "100", "unknown"));
  await assert.rejects(api.saveInventoryPurchasePrice(workspace, item, "-100", "gross"));
});

test("material names and climate IDs never collide and remain exact", async () => {
  let write;
  const api = store((op) => { write = op; return { data: row({ ...op.value }), error: null }; });
  const material = { itemType: "material", itemKey: "3×1,5 gumikábel" };
  const saved = await api.saveInventoryPurchasePrice(workspace, material, "0", "gross");
  assert.equal(saved.purchasePrice, 0);
  assert.equal(write.value.item_key, material.itemKey);
  assert.notEqual(api.inventoryPriceKey(item), api.inventoryPriceKey({ ...item, itemType: "material" }));
});
