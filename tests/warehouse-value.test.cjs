const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const api = harness({}, { "@/lib/supabase": { supabase: {} } }).load("src/lib/alinflow/warehouse-value.ts");
const { grossPurchasePrice, summarizeWarehouseValue, groupWarehouseItems } = api;
const price = (purchasePrice, taxBasis = "gross", itemType = "climate", itemKey = "ac") => ({
  itemType, itemKey, purchasePrice, taxBasis, workspaceId: "workspace", updatedAt: "version",
});
const prices = (...rows) => new Map(rows.map(row => [JSON.stringify([row.itemType, row.itemKey]), row]));
const item = (stock, reserved = 0, itemType = "climate", itemKey = "ac") => ({ itemType, itemKey, stock, reserved });
const plain = value => JSON.parse(JSON.stringify(value));

test("net and gross input produce the same gross unit price without mutating the saved basis", () => {
  const net = Object.freeze(price(100000, "net"));
  assert.equal(grossPurchasePrice(net), 127000);
  assert.equal(grossPurchasePrice(price(127000)), 127000);
  assert.equal(net.purchasePrice, 100000);
  assert.equal(net.taxBasis, "net");
  assert.equal(grossPurchasePrice(price(0, "net")), 0);
  assert.equal(grossPurchasePrice(price(0)), 0);
});

test("unit prices round decimal half cents accurately, including the largest accepted stored value", () => {
  for (const [input, basis, expected] of [
    [1.5, "net", 1.91], [0.5, "net", 0.64], [0.1, "net", 0.13],
    [1.005, "gross", 1.01], [2.675, "gross", 2.68], [1.234, "net", 1.57],
    [999999999.99, "net", 1269999999.99], [999999999.99, "gross", 999999999.99],
    [1e-7, "gross", 0], [1e-7, "net", 0],
  ]) assert.equal(grossPurchasePrice(price(input, basis)), expected, `${input} ${basis}`);
});

test("missing, invalid, negative and nonfinite prices remain unknown instead of appearing free", () => {
  assert.equal(grossPurchasePrice(), null);
  for (const value of [null, undefined, -1, NaN, Infinity, -Infinity]) {
    assert.equal(grossPurchasePrice(price(value)), null);
  }
  assert.equal(grossPurchasePrice(price(10, "unknown")), null);
});

test("the stock summary includes climates and fractional materials at gross purchase prices", () => {
  const result = summarizeWarehouseValue(
    [item(3, 1), item(2.5, 0.75, "material", "Rézcső")],
    prices(price(100000, "net"), price(1.5, "gross", "material", "Rézcső")),
  );
  assert.deepEqual(plain(result), {
    grossStockValue: 381003.75, reservedValue: 127001.13, freeValue: 254002.62,
    missingStockPriceCount: 0, pricedStockItemCount: 2,
  });
});

test("known zero and unknown positive stock are counted separately; missing out-of-stock prices do not mark value incomplete", () => {
  const result = summarizeWarehouseValue(
    [item(1), item(2, 1, "material", "zero"), item(3, 1, "material", "missing"),
      item(4, 2, "material", "unset"), item(0, 1, "material", "out"), item(-2, 0, "material", "negative")],
    prices(price(100), price(0, "net", "material", "zero"), price(null, "gross", "material", "unset")),
  );
  assert.deepEqual(plain(result), {
    grossStockValue: 100, reservedValue: 0, freeValue: 100,
    missingStockPriceCount: 2, pricedStockItemCount: 2,
  });
});

test("over-reservation is capped at physical stock and never makes stock value or free value negative", () => {
  const result = summarizeWarehouseValue([item(1.5, 200)], prices(price(100)));
  assert.deepEqual(plain(result), {
    grossStockValue: 150, reservedValue: 150, freeValue: 0,
    missingStockPriceCount: 0, pricedStockItemCount: 1,
  });
});

test("negative and nonfinite stock or reservations cannot create phantom warehouse value", () => {
  for (const stock of [-1, NaN, Infinity, -Infinity]) {
    assert.deepEqual(plain(summarizeWarehouseValue([item(stock, 5)], prices(price(100)))), {
      grossStockValue: 0, reservedValue: 0, freeValue: 0,
      missingStockPriceCount: 0, pricedStockItemCount: 0,
    });
  }
  for (const reserved of [-1, NaN, Infinity, -Infinity]) {
    const result = summarizeWarehouseValue([item(2, reserved)], prices(price(100)));
    assert.equal(result.grossStockValue, 200);
    assert.equal(result.reservedValue, 0);
    assert.equal(result.freeValue, 200);
  }
});

test("line rounding handles decimal ties and splits gross value exactly in cents", () => {
  const result = summarizeWarehouseValue(
    [item(0.29, 0.01), item(0.03, 0.01, "material", "rounding")],
    prices(price(1.5), price(0.5, "gross", "material", "rounding")),
  );
  assert.equal(result.grossStockValue, 0.46);
  assert.equal(result.reservedValue, 0.03);
  assert.equal(result.freeValue, 0.43);
  assert.equal(Math.round(result.grossStockValue * 100),
    Math.round(result.reservedValue * 100) + Math.round(result.freeValue * 100));
});

test("rounding is applied to the displayed gross unit price before multiplying quantities", () => {
  const result = summarizeWarehouseValue([item(3, 1)], prices(price(0.5, "net")));
  assert.equal(grossPurchasePrice(price(0.5, "net")), 0.64);
  assert.deepEqual(plain(result), {
    grossStockValue: 1.92, reservedValue: 0.64, freeValue: 1.28,
    missingStockPriceCount: 0, pricedStockItemCount: 1,
  });
});

test("climate IDs and identical material names resolve separate prices without mutating inputs", () => {
  const inputs = Object.freeze([Object.freeze(item(1, 0)), Object.freeze(item(2, 1, "material", "ac"))]);
  const rows = [Object.freeze(price(100)), Object.freeze(price(10, "gross", "material", "ac"))];
  const lookup = prices(...rows);
  const before = JSON.stringify([inputs, Array.from(lookup.entries())]);
  const result = summarizeWarehouseValue(inputs, lookup);
  assert.equal(result.grossStockValue, 120);
  assert.equal(result.reservedValue, 10);
  assert.equal(JSON.stringify([inputs, Array.from(lookup.entries())]), before);
});

test("grouping places positive physical stock first and sorts both groups by Hungarian alphabet", () => {
  const names = ["Dió", "Árnyék", "Cukor", "Zsiráf", "Csalán", "Őz", "Öböl", "Alma"];
  const stocked = new Set(["Zsiráf", "Csalán", "Dió", "Cukor"]);
  const inputs = Object.freeze(names.map(name => Object.freeze({ name })));
  const groups = groupWarehouseItems(inputs, value => stocked.has(value.name) ? 0.5 : 0);
  assert.deepEqual(plain(groups.map(group => ({ ...group, items: group.items.map(value => value.name) }))), [
    { key: "in-stock", title: "Raktáron", items: ["Cukor", "Csalán", "Dió", "Zsiráf"] },
    { key: "other", title: "További tételek", items: ["Alma", "Árnyék", "Öböl", "Őz"] },
  ]);
  assert.deepEqual(inputs.map(value => value.name), names);
  for (const group of groups) for (const value of group.items) assert.ok(inputs.includes(value));
});

test("grouping keeps stable equal-name order, treats invalid stock as other, and always returns both groups", () => {
  const inputs = [
    { name: "alma", id: 1, stock: 1 }, { name: "Alma", id: 2, stock: 2 },
    { name: "Béla", id: 3, stock: -1 }, { name: "Cecil", id: 4, stock: NaN },
    { name: "Dóra", id: 5, stock: Infinity },
  ];
  const groups = groupWarehouseItems(inputs, value => value.stock);
  assert.deepEqual(plain(groups.map(group => group.items.map(value => value.id))), [[1, 2], [3, 4, 5]]);
  assert.deepEqual(plain(groupWarehouseItems([], () => 0)), [
    { key: "in-stock", title: "Raktáron", items: [] }, { key: "other", title: "További tételek", items: [] },
  ]);
});
