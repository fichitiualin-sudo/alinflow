const assert = require("node:assert/strict");
const test = require("node:test");
const { harness, noop } = require("./helpers.cjs");
const priceFile = "src/components/alinflow/InventoryPurchasePrice.tsx";
const warehouseFile = "src/components/alinflow/WarehousePanel.tsx";
const jsx = { "react/jsx-runtime": require("react/jsx-runtime") };
const valueHarness = harness({}, { "@/lib/supabase": { supabase: {} } });
const warehouseValue = valueHarness.load("src/lib/alinflow/warehouse-value.ts");
const { parsePurchasePrice } = valueHarness.load("src/lib/alinflow/inventory-purchase-prices.ts");
const item = { itemType: "climate", itemKey: "synthetic-ac" };
const inventoryPriceKey = (value) => JSON.stringify([value.itemType, value.itemKey]);
const record = (workspaceId = "workspace-a", purchasePrice = 120000) => ({
  ...item, workspaceId, purchasePrice, taxBasis: "net", updatedAt: "2026-09-14T12:00:00Z",
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(setImmediate);

// Persistent state/ref slots and effect cleanup exercise the real component/hook handlers.
function hookRuntime() {
  const slots = [];
  let cursor = 0, dirty = false, unmounted = false, lateWrites = 0;
  let pending = [];
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (next) => {
        if (unmounted) { lateWrites++; return; }
        slots[index].value = typeof next === "function" ? next(slots[index].value) : next;
        dirty = true;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      const changed = !previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]));
      if (changed) {
        slots[index] = { dependencies, cleanup: previous?.cleanup };
        pending.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  return { hooks, render(callback) {
    let value;
    for (let iteration = 0; iteration < 20; iteration++) {
      dirty = false; cursor = 0; value = callback();
      const effects = pending; pending = []; effects.forEach((effect) => effect());
      if (!dirty) return value;
    }
    throw new Error("Hook render did not settle");
  }, unmount() { slots.forEach((slot) => slot.cleanup?.()); unmounted = true; }, get lateWrites() { return lateWrites; } };
}

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function texts(tree, print = false) {
  if (Array.isArray(tree)) return tree.map((child) => texts(child, print)).join(" ");
  if (tree === null || tree === undefined || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  if (print && String(tree.props?.className || "").split(/\s+/).includes("print:hidden")) return "";
  return texts(tree.props?.children, print);
}
function createPriceHook({ list, save = async () => record(), workspaceId = "workspace-a" }) {
  const runtime = hookRuntime();
  const { useInventoryPurchasePrices } = harness().functions(["useInventoryPurchasePrices"], {
    ...runtime.hooks, inventoryPriceKey, listInventoryPurchasePrices: list, saveInventoryPurchasePrice: save,
  }, priceFile);
  let currentWorkspace = workspaceId;
  const run = { runtime, render(nextWorkspace = currentWorkspace) { currentWorkspace = nextWorkspace;
    run.value = runtime.render(() => useInventoryPurchasePrices(currentWorkspace)); return run.value; } };
  run.render();
  return run;
}

test("purchase price hook: loading failure blocks writes; explicit retry loads saved prices", async () => {
  const first = deferred(), second = deferred();
  let reads = 0, writes = 0;
  const run = createPriceHook({ list: () => ++reads === 1 ? first.promise : second.promise,
    save: async () => { writes++; return record(); } });
  assert.equal(run.value.loading, true);
  await assert.rejects(run.value.save(item, "123", "net"), /betöltése szükséges/);
  first.reject(new Error("synthetic load failure")); await tick(); run.render();
  assert.equal(run.value.loading, false); assert.ok(run.value.error); assert.equal(run.value.prices.size, 0);
  await assert.rejects(run.value.save(item, "123", "net"), /betöltése szükséges/);
  assert.equal(writes, 0);
  run.value.retry(); run.render();
  assert.equal(run.value.loading, true); assert.equal(run.value.error, "");
  second.resolve([record()]); await tick(); run.render();
  assert.equal(run.value.prices.get(inventoryPriceKey(item)).purchasePrice, 120000);
  assert.equal(run.value.loading, false); assert.equal(run.value.error, "");
});

test("purchase price hook: old workspace response and error cannot overwrite the current workspace", async () => {
  for (const oldFails of [false, true]) {
    const old = deferred(), current = deferred();
    const run = createPriceHook({ list: (workspace) => workspace === "workspace-a" ? old.promise : current.promise });
    run.render("workspace-b");
    current.resolve([record("workspace-b", 220000)]); await tick(); run.render();
    if (oldFails) old.reject(new Error("old workspace failure")); else old.resolve([record("workspace-a", 999999)]);
    await tick(); run.render();
    assert.equal(run.value.prices.get(inventoryPriceKey(item)).workspaceId, "workspace-b");
    assert.equal(run.value.prices.get(inventoryPriceKey(item)).purchasePrice, 220000);
    assert.equal(run.value.error, ""); assert.equal(run.value.loading, false);
  }
});

test("purchase price hook: late load and failed load after unmount perform no state writes", async () => {
  for (const fails of [false, true]) {
    const request = deferred(); const run = createPriceHook({ list: () => request.promise });
    run.runtime.unmount();
    if (fails) request.reject(new Error("synthetic late error")); else request.resolve([record()]);
    await tick();
    assert.equal(run.runtime.lateWrites, 0);
  }
});

test("purchase price hook: save keeps the loaded version and cannot update a new workspace or unmounted view", async () => {
  for (const unmount of [false, true]) {
    const request = deferred(), calls = [];
    const run = createPriceHook({ list: async (workspace) => [record(workspace)], save: (...args) => { calls.push(args); return request.promise; } });
    await tick(); run.render();
    const result = run.value.save(item, "150000", "gross");
    const checked = assert.rejects(result, /raktár közben megváltozott/);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], "workspace-a");
    assert.equal(calls[0][4].updatedAt, record().updatedAt);
    if (unmount) run.runtime.unmount(); else { run.render("workspace-b"); await tick(); run.render(); }
    request.resolve(record("workspace-a", 150000)); await checked;
    if (unmount) assert.equal(run.runtime.lateWrites, 0);
    else assert.equal(run.value.prices.get(inventoryPriceKey(item)).workspaceId, "workspace-b");
  }
});

test("purchase price hook: saves for different rows merge without losing the first saved price", async () => {
  const a = deferred(), b = deferred();
  const secondItem = { itemType: "material", itemKey: "Synthetic pipe" };
  const run = createPriceHook({ list: async () => [], save: (_workspace, target) => target.itemType === "climate" ? a.promise : b.promise });
  await tick(); run.render();
  const first = run.value.save(item, "150000", "gross"), second = run.value.save(secondItem, "4000", "net");
  b.resolve({ ...record(), ...secondItem, purchasePrice: 4000 }); await second;
  a.resolve(record("workspace-a", 150000)); await first; run.render();
  assert.equal(run.value.prices.size, 2);
  assert.equal(run.value.prices.get(inventoryPriceKey(item)).purchasePrice, 150000);
  assert.equal(run.value.prices.get(inventoryPriceKey(secondItem)).purchasePrice, 4000);
});

function createEditor(onSave, initial = {}) {
  const runtime = hookRuntime();
  const { InventoryPurchasePriceEditor } = harness({}, jsx).functions(["InventoryPurchasePriceEditor"], {
    ...runtime.hooks, ...warehouseValue, parsePurchasePrice, ft: (value) => `${value} Ft`,
  }, priceFile);
  const props = { item, itemName: "Synthetic AC", unit: "db", price: record(), disabled: false, onSave, ...initial };
  let tree;
  const run = { runtime, render(changes = {}) { Object.assign(props, changes); tree = runtime.render(() => InventoryPurchasePriceEditor(props)); return tree; },
    nodes: (predicate) => nodes(tree, predicate), buttons: (label) => nodes(tree, (node) => node.type === "button" && node.props.children === label),
    text: (print) => texts(tree, print), get tree() { return tree; } };
  run.render(); return run;
}

test("purchase price editor: double save is guarded and inputs/cancel stay disabled while saving", async () => {
  const request = deferred(), calls = [];
  const run = createEditor((...args) => { calls.push(args); return request.promise; });
  run.buttons("Ár módosítása")[0].props.onClick(); run.render();
  run.nodes((node) => node.type === "input")[0].props.onChange({ target: { value: "123,45" } });
  run.nodes((node) => node.type === "select")[0].props.onChange({ target: { value: "gross" } }); run.render();
  const save = run.buttons("Beszerzési ár mentése")[0].props.onClick;
  save(); save(); run.render();
  assert.equal(calls.length, 1); assert.equal(calls[0][1], "123,45"); assert.equal(calls[0][2], "gross");
  assert.ok(run.nodes((node) => node.type === "input" || node.type === "select").every((node) => node.props.disabled));
  assert.equal(run.buttons("Mégse")[0].props.disabled, true); assert.equal(run.buttons("Mentés...")[0].props.disabled, true);
  request.resolve(record("workspace-a", 123.45)); await tick(); run.render({ price: record("workspace-a", 123.45) });
  assert.equal(run.nodes((node) => node.type === "input").length, 0);
  assert.match(run.text(), /Beszerzési ár mentve/);
});

test("purchase price editor: load errors disable an open form and prevent saving", () => {
  let saves = 0;
  const run = createEditor(async () => { saves++; return record(); });
  run.buttons("Ár módosítása")[0].props.onClick(); run.render({ disabled: true });
  const button = run.buttons("Beszerzési ár mentése")[0];
  assert.equal(button.props.disabled, true); button.props.onClick();
  assert.equal(saves, 0);
  assert.match(run.text(), /Nem elérhető/);
  assert.ok(run.nodes((node) => node.type === "input" || node.type === "select").every((node) => node.props.disabled));
});

test("purchase price editor: failed save keeps the editable value, and a later retry can succeed", async () => {
  let attempts = 0;
  const run = createEditor(async () => { if (++attempts === 1) throw new Error("synthetic error"); return record(); });
  run.buttons("Ár módosítása")[0].props.onClick(); run.render();
  run.nodes((node) => node.type === "input")[0].props.onChange({ target: { value: "3456" } }); run.render();
  run.buttons("Beszerzési ár mentése")[0].props.onClick(); await tick(); run.render();
  assert.equal(run.nodes((node) => node.type === "input")[0].props.value, "3456");
  assert.equal(run.buttons("Beszerzési ár mentése")[0].props.disabled, false);
  assert.equal(run.nodes((node) => node.props?.role === "status").length, 1);
  run.buttons("Beszerzési ár mentése")[0].props.onClick(); await tick(); run.render();
  assert.equal(attempts, 2); assert.match(run.text(), /Beszerzési ár mentve/);
});

test("purchase price editor: late save success or failure after unmount never updates state", async () => {
  for (const fails of [false, true]) {
    const request = deferred(); const run = createEditor(() => request.promise);
    run.buttons("Ár módosítása")[0].props.onClick(); run.render();
    run.buttons("Beszerzési ár mentése")[0].props.onClick(); run.runtime.unmount();
    if (fails) request.reject(new Error("synthetic error")); else request.resolve(record());
    await tick(); assert.equal(run.runtime.lateWrites, 0);
  }
});

test("purchase price editor: read and edit modes are entirely hidden from print output", () => {
  const run = createEditor(async () => record());
  assert.match(run.text(), /152400 Ft/); assert.equal(run.text(true), "");
  assert.equal(run.nodes((node) => node.props?.["data-internal-purchase-price"] !== undefined).length, 1);
  run.buttons("Ár módosítása")[0].props.onClick(); run.render();
  assert.match(run.text(), /Beszerzési ár mentése/); assert.equal(run.text(true), "");
  assert.ok(run.tree.props.className.split(/\s+/).includes("print:hidden"));
});

test("purchase price editor: gross read display preserves the original net value and basis when editing and saving", async () => {
  const saved = record(), calls = [];
  const before = JSON.stringify(saved);
  const run = createEditor(async (...args) => { calls.push(args); return saved; }, { price: saved });
  assert.match(run.text(), /152400 Ft/);
  assert.doesNotMatch(run.text(), /120000 Ft/);
  assert.match(run.text(), /bruttó/i);
  run.buttons("Ár módosítása")[0].props.onClick(); run.render();
  assert.equal(run.nodes((node) => node.type === "input")[0].props.value, "120000");
  assert.equal(run.nodes((node) => node.type === "select")[0].props.value, "net");
  assert.match(run.text(), /27%/);
  run.buttons("Beszerzési ár mentése")[0].props.onClick(); await tick(); run.render();
  assert.equal(calls.length, 1); assert.equal(calls[0][1], "120000"); assert.equal(calls[0][2], "net");
  assert.equal(JSON.stringify(saved), before);
  assert.match(run.text(), /152400 Ft/);
});

test("purchase price editor: gross input is not converted twice, while zero and missing prices remain distinct", () => {
  const run = createEditor(async () => record(), { price: { ...record(), purchasePrice: 127000, taxBasis: "gross" } });
  assert.match(run.text(), /127000 Ft/); assert.doesNotMatch(run.text(), /161290 Ft/);
  run.render({ price: { ...record(), purchasePrice: 0 } });
  assert.match(run.text(), /0 Ft/); assert.doesNotMatch(run.text(), /Nincs megadva/);
  run.render({ price: { ...record(), purchasePrice: null } });
  assert.match(run.text(), /Nincs megadva/); assert.doesNotMatch(run.text(), /\d+ Ft/);
  run.render({ price: undefined }); assert.match(run.text(), /Nincs megadva/);
  run.render({ price: record(), disabled: true });
  assert.match(run.text(), /Nem elérhető/); assert.doesNotMatch(run.text(), /\d+ Ft/);
});

test("purchase price editor: gross preview follows decimal input and basis without rewriting the entered amount", () => {
  let saves = 0;
  const run = createEditor(async () => { saves++; return record(); });
  run.buttons("Ár módosítása")[0].props.onClick(); run.render();
  const preview = () => run.nodes((node) => node.type === "span" && texts(node).includes("Bruttó egységár:"));
  run.nodes((node) => node.type === "input")[0].props.onChange({ target: { value: "1000,50" } }); run.render();
  assert.match(texts(preview()[0]), /1270\.64 Ft/);
  assert.equal(run.nodes((node) => node.type === "input")[0].props.value, "1000,50");
  run.nodes((node) => node.type === "select")[0].props.onChange({ target: { value: "gross" } }); run.render();
  assert.match(texts(preview()[0]), /1000\.5 Ft/);
  assert.equal(run.nodes((node) => node.type === "input")[0].props.value, "1000,50");
  for (const value of ["", "1,2,3"]) {
    run.nodes((node) => node.type === "input")[0].props.onChange({ target: { value } }); run.render();
    assert.equal(preview().length, 0);
  }
  assert.equal(saves, 0);
});

function createWarehouse(priceState = {}, changes = {}) {
  const runtime = hookRuntime(), stockCalls = [];
  function Editor() {}
  const { WarehousePanel, WarehouseValueSummary } = harness({}, jsx).functions(["WarehousePanel", "WarehouseValueSummary"], {
    ...runtime.hooks, ...warehouseValue, inventoryPriceKey, InventoryPurchasePriceEditor: Editor,
    ft: (value) => `${value} Ft`,
    useInventoryPurchasePrices: () => ({ prices: new Map(), loading: false, error: "", retry: noop, save: noop, ...priceState }),
    Shell: "main", Back: "back", ClimateProductManager: "manager",
    Card: "card", StockBadge: "badge", Field: "label", statusPillClass: String,
    document: { getElementById: () => ({ value: "3" }) },
  }, warehouseFile);
  const products = Array.from({ length: 24 }, (_, index) => ({ id: `ac-${index}`, name: `Teszt klíma ${index}`, price: 200000, installPrice: 60000 }));
  const materials = Array.from({ length: 23 }, (_, index) => ({ name: `Szerelési anyag ${index}`, stock: 8, unit: "m", lowAt: 1 }));
  const props = { workspaceId: "workspace-a", products, materialInventory: materials, stockOf: () => 10, reservedForProduct: () => 2,
    materialReserved: () => 3, addStock: (...args) => stockCalls.push(["climate", ...args]), addMaterialStock: (...args) => stockCalls.push(["material", ...args]), ...changes };
  let tree;
  function expandSummary(node) {
    if (Array.isArray(node)) return node.map(expandSummary);
    if (!node || typeof node !== "object") return node;
    if (node.type === WarehouseValueSummary) return expandSummary(WarehouseValueSummary(node.props));
    return { ...node, props: { ...node.props, children: expandSummary(node.props?.children) } };
  }
  const run = { stockCalls, render() { tree = expandSummary(runtime.render(() => WarehousePanel(props))); },
    nodes: (predicate) => nodes(tree, predicate), editors: () => nodes(tree, (node) => node.type === Editor),
    search(value) { nodes(tree, (node) => node.type === "input" && node.props.type === "search")[0].props.onChange({ target: { value } }); run.render(); },
    text: (print) => texts(tree, print) };
  run.render(); return run;
}

test("warehouse: all rows above ten remain on one page, with exact stock handlers and purchase-price targets", () => {
  const run = createWarehouse();
  assert.equal(run.editors().filter((node) => node.props.item.itemType === "climate").length, 24);
  assert.equal(run.editors().filter((node) => node.props.item.itemType === "material").length, 23);
  assert.doesNotMatch(run.text(), /Következő|Előző|oldalanként/);
  const stockButtons = run.nodes((node) => node.type === "button" && node.props.children === "Készlet módosítása");
  assert.equal(stockButtons.length, 47);
  const productRow = run.nodes((node) => node.key === "climate-ac-23")[0];
  const materialRow = run.nodes((node) => node.key === "material-Szerelési anyag 22")[0];
  nodes(productRow, (node) => node.type === "button" && node.props.children === "Készlet módosítása")[0].props.onClick();
  nodes(materialRow, (node) => node.type === "button" && node.props.children === "Készlet módosítása")[0].props.onClick();
  assert.deepEqual(run.stockCalls, [["climate", "ac-23", 3], ["material", "Szerelési anyag 22", 3]]);
  assert.ok(run.editors().some((node) => node.props.item.itemKey === "ac-23"));
  assert.ok(run.editors().some((node) => node.props.item.itemKey === "Szerelési anyag 22"));
});

test("warehouse: case-insensitive search filters both lists and clearing restores every row", () => {
  const run = createWarehouse();
  run.search("  KLÍMA 23 "); assert.equal(run.editors().length, 1); assert.equal(run.editors()[0].props.item.itemKey, "ac-23");
  run.search("ANYAG 22"); assert.equal(run.editors().length, 1); assert.equal(run.editors()[0].props.item.itemKey, "Szerelési anyag 22");
  run.search("absent item"); assert.equal(run.editors().length, 0);
  assert.match(run.text(), /Nincs megfelelő klíma/); assert.match(run.text(), /Nincs megfelelő szerelési anyag/);
  run.search(""); assert.equal(run.editors().length, 47);
});

test("warehouse: initial load and read failures disable all price editors without disabling stock handlers", () => {
  for (const priceState of [{ loading: true }, { error: "synthetic failure" }]) {
    const run = createWarehouse(priceState);
    assert.ok(run.editors().every((node) => node.props.disabled));
    const button = run.nodes((node) => node.type === "button" && node.props.children === "Készlet módosítása")[0];
    assert.notEqual(button.props.disabled, true); button.props.onClick(); assert.equal(run.stockCalls.length, 1);
  }
});

function valueFixture({ missing = true } = {}) {
  const products = [
    { id: "priced-net", name: "Alfa klíma", price: 200000, installPrice: 60000 },
    { id: "priced-gross", name: "Béta klíma", price: 200000, installPrice: 60000 },
    ...(missing ? [{ id: "unpriced", name: "Hiányzó árú klíma", price: 200000, installPrice: 60000 }] : []),
    { id: "empty-unpriced", name: "Nincs készleten", price: 200000, installPrice: 60000 },
  ];
  const materialInventory = [{ name: "Cső", stock: 2.5, unit: "m", lowAt: 1 }, { name: "Ingyenes anyag", stock: 5, unit: "db", lowAt: 1 }];
  const records = [
    { ...record(), itemKey: "priced-net", purchasePrice: 1000, taxBasis: "net" },
    { ...record(), itemKey: "priced-gross", purchasePrice: 2000, taxBasis: "gross" },
    { ...record(), itemType: "material", itemKey: "Cső", purchasePrice: 10.5, taxBasis: "gross" },
    { ...record(), itemType: "material", itemKey: "Ingyenes anyag", purchasePrice: 0, taxBasis: "gross" },
  ];
  return { priceState: { prices: new Map(records.map((entry) => [inventoryPriceKey(entry), entry])) }, changes: {
    products, materialInventory, stockOf: (id) => ({ "priced-net": 2, "priced-gross": 1, unpriced: 3, "empty-unpriced": 0 })[id],
    reservedForProduct: (id) => ({ "priced-net": 1, "priced-gross": 5, unpriced: 1, "empty-unpriced": 4 })[id],
    materialReserved: (name) => name === "Cső" ? 1.5 : 2,
  } };
}

function summaryNode(run) {
  const summaries = run.nodes((node) => node.props?.["data-internal-stock-value"] !== undefined);
  assert.equal(summaries.length, 1);
  return summaries[0];
}

test("warehouse: gross stock/reserved/free values cover the whole inventory independently of search", () => {
  const fixture = valueFixture({ missing: false });
  const before = JSON.stringify(fixture.changes.products);
  const run = createWarehouse(fixture.priceState, fixture.changes);
  const summary = texts(summaryNode(run));
  assert.match(summary, /4566\.25 Ft/); assert.match(summary, /3285\.75 Ft/); assert.match(summary, /1280\.5 Ft/);
  assert.doesNotMatch(summary, /részösszeg/i);
  run.search("Alfa"); assert.equal(run.editors().length, 1);
  assert.equal(texts(summaryNode(run)), summary);
  run.search("No matching item"); assert.equal(run.editors().length, 0);
  assert.equal(texts(summaryNode(run)), summary);
  assert.equal(JSON.stringify(fixture.changes.products), before);
});

test("warehouse: unknown stocked prices mark a partial value while missing zero-stock and actual zero prices do not", () => {
  const fixture = valueFixture();
  const run = createWarehouse(fixture.priceState, fixture.changes);
  const summary = texts(summaryNode(run));
  assert.match(summary, /4566\.25 Ft/);
  assert.match(summary, /részösszeg/i);
  assert.match(summary, /1\s+raktáron lévő tételnél/i);
  assert.match(summary, /hiány|nincs megadva|nem.*adva/i);
  run.search("No matching item");
  assert.equal(texts(summaryNode(run)), summary);
});

test("warehouse: empty inventory shows a known zero but loading/error never present a completed zero valuation", () => {
  const empty = createWarehouse({}, { products: [], materialInventory: [] });
  const summary = texts(summaryNode(empty));
  assert.equal((summary.match(/0 Ft/g) || []).length, 3);
  assert.doesNotMatch(summary, /részösszeg|hiányzó ár/i);
  for (const priceState of [{ loading: true }, { error: "synthetic failure" }]) {
    const unavailable = createWarehouse(priceState, { products: [], materialInventory: [] });
    assert.doesNotMatch(texts(summaryNode(unavailable)), /\d+(?:[.,]\d+)? Ft/);
  }
  const allPricesUnknown = createWarehouse();
  const unknownSummary = texts(summaryNode(allPricesUnknown));
  assert.doesNotMatch(unknownSummary, /\d+(?:[.,]\d+)? Ft/);
  assert.equal((unknownSummary.match(/—/g) || []).length, 3);
  assert.match(unknownSummary, /47\s+raktáron lévő tételnél hiányzik/);
});

test("warehouse: complete and partial gross valuation blocks are hidden from printing", () => {
  for (const missing of [true, false]) {
    const fixture = valueFixture({ missing });
    const run = createWarehouse(fixture.priceState, fixture.changes);
    const summary = summaryNode(run);
    assert.ok(summary.props.className.split(/\s+/).includes("print:hidden"));
    assert.equal(texts(summary, true), "");
    assert.doesNotMatch(run.text(true), /4566\.25 Ft|3285\.75 Ft|1280\.5 Ft/);
  }
});

test("warehouse: stocked rows come first and both groups use Hungarian alphabetical order without mutating input", () => {
  const products = [
    { id: "z", name: "Zéta", price: 1, installPrice: 0 }, { id: "a", name: "Alfa", price: 1, installPrice: 0 },
    { id: "ar", name: "Árpa", price: 1, installPrice: 0 }, { id: "b", name: "Béta", price: 1, installPrice: 0 },
    { id: "cs", name: "Csillag", price: 1, installPrice: 0 }, { id: "d", name: "Doboz", price: 1, installPrice: 0 },
  ];
  const materialInventory = [
    { name: "Öblítő", stock: 1, unit: "db", lowAt: 1 }, { name: "Dió", stock: 0, unit: "db", lowAt: 1 },
    { name: "Áram", stock: 0.5, unit: "m", lowAt: 1 }, { name: "Cédrus", stock: 0, unit: "db", lowAt: 1 },
  ];
  const before = JSON.stringify({ products, materialInventory });
  const run = createWarehouse({}, { products, materialInventory,
    stockOf: (id) => ({ z: 3, a: 0, ar: 3, b: -1, cs: 2, d: 0 })[id], reservedForProduct: () => 0, materialReserved: () => 0 });
  assert.deepEqual(run.editors().filter((node) => node.props.item.itemType === "climate").map((node) => node.props.item.itemKey), ["ar", "cs", "z", "a", "b", "d"]);
  assert.deepEqual(run.editors().filter((node) => node.props.item.itemType === "material").map((node) => node.props.item.itemKey), ["Áram", "Öblítő", "Cédrus", "Dió"]);
  assert.equal(JSON.stringify({ products, materialInventory }), before);
  assert.doesNotMatch(run.text(), /Raktár logika|Foglalás ≠ levonás|Mit jelent\?/);
  assert.equal(run.nodes((node) => ["Raktár logika", "Mit jelent?"].includes(node.props?.title)).length, 0);
});
