const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database, noop } = require("./helpers.cjs");

const products = [
  { id: "archive-test-a", name: "Test climate A", price: 2000, install_price: 1000 },
  { id: "archive-test-b", name: "Test climate B", price: 3000, install_price: 1000 },
];

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}

// Exercise the actual component handlers with persistent state/ref hook slots.
function manager(onDeleteClimateProduct) {
  const slots = [];
  let cursor = 0;
  const context = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    ft: String,
  };
  const { ClimateProductManager } = harness({}, {
    "react/jsx-runtime": require("react/jsx-runtime"),
  }).functions(["ClimateProductManager", "Card", "Field", "productDevicePrice"], context,
    "src/components/alinflow/WarehousePanel.tsx");
  const props = {
    products, showClimateProductManager: true, productBusy: false, productMessage: "",
    newProduct: { name: "", price: "", install_price: "" },
    onToggleClimateProductManager: noop, onNewProductChange: noop,
    onAddClimateProduct: noop, onUpdateProductName: noop,
    onUpdateProductDevicePrice: noop, onUpdateProductInstallPrice: noop,
    onSaveClimateProduct: noop, onDeleteClimateProduct,
  };
  let tree;
  function render(changes = {}) {
    Object.assign(props, changes);
    cursor = 0;
    tree = ClimateProductManager(props);
  }
  render();
  return {
    render,
    buttons: text => nodes(tree, n => n.type === "button" && n.props.children === text),
    groups: () => nodes(tree, n => n.props?.role === "group"),
    statuses: () => nodes(tree, n => n.props?.role === "status"),
  };
}

test("Archive confirmation: opening, cancel and Escape do not write", () => {
  let writes = 0;
  let focusReturns = 0;
  const ui = manager(async () => { writes++; return true; });
  const trigger = { focus() { focusReturns++; } };
  assert.equal(ui.groups().length, 0);
  ui.buttons("Törlés")[1].props.onClick({ currentTarget: trigger });
  ui.render();
  assert.equal(writes, 0);
  assert.equal(ui.groups().length, 1);
  assert.match(ui.groups()[0].props["aria-label"], /Test climate B/);
  assert.equal(ui.buttons("Mégse")[0].props.autoFocus, true);
  ui.buttons("Mégse")[0].props.onClick();
  ui.render();
  assert.equal(ui.groups().length, 0);
  assert.equal(focusReturns, 1);
  ui.buttons("Törlés")[0].props.onClick({ currentTarget: trigger });
  ui.render();
  let prevented = false;
  ui.groups()[0].props.onKeyDown({ key: "Escape", preventDefault() { prevented = true; } });
  ui.render();
  assert.equal(prevented, true);
  assert.equal(ui.groups().length, 0);
  assert.equal(writes, 0);
  assert.equal(focusReturns, 2);
});

test("Archive confirmation: only selected product is written, duplicate clicks are guarded", async () => {
  const writes = [];
  let finish;
  const ui = manager(product => {
    writes.push(product.id);
    return new Promise(resolve => { finish = resolve; });
  });
  ui.buttons("Törlés")[1].props.onClick({ currentTarget: { focus: noop } });
  ui.render();
  const confirm = ui.buttons("Archiválás")[0].props.onClick;
  confirm();
  confirm();
  ui.buttons("Mégse")[0].props.onClick();
  ui.render({ productBusy: true });
  assert.deepEqual(writes, [products[1].id]);
  assert.equal(ui.groups().length, 1);
  assert.equal(ui.buttons("Archiválás...")[0].props.disabled, true);
  assert.equal(ui.buttons("Mégse")[0].props.disabled, true);
  finish(true);
  await new Promise(setImmediate);
  ui.render({ productBusy: false });
  assert.equal(ui.groups().length, 0);
});

test("Archive confirmation: failed save remains visible and allows retry", async () => {
  let writes = 0;
  const ui = manager(async () => { writes++; return writes > 1; });
  ui.render({ productMessage: "Previous operation" });
  ui.buttons("Törlés")[0].props.onClick({ currentTarget: { focus: noop } });
  ui.render();
  assert.equal(nodes(ui.groups()[0], n => n.props?.role === "status").length, 0);
  ui.buttons("Archiválás")[0].props.onClick();
  await new Promise(setImmediate);
  ui.render({ productMessage: "Archive failed" });
  assert.equal(ui.groups().length, 1);
  assert.equal(nodes(ui.groups()[0], n => n.props?.role === "status")[0].props.children, "Archive failed");
  ui.buttons("Archiválás")[0].props.onClick();
  await new Promise(setImmediate);
  ui.render();
  assert.equal(writes, 2);
  assert.equal(ui.groups().length, 0);
});

for (const fail of [false, true]) {
  test(`Archive persistence: ${fail ? "failure preserves catalog" : "soft archive is scoped, preserves history"}`, async () => {
    const operations = [];
    const busy = [];
    let catalog = products;
    let active = products;
    let message = "";
    const { deleteClimateProduct } = harness().functions(["deleteClimateProduct"], {
      products,
      supabase: database(op => {
        operations.push(op);
        return { error: fail ? { message: "test failure" } : null };
      }),
      workspaceQuery: query => query.eq("workspace_id", "test-workspace"),
      setProductBusy: value => busy.push(value),
      setProducts: value => { catalog = value; },
      setActiveProducts: value => { active = value; },
      setProductMessage: value => { message = value; },
    });
    assert.equal(await deleteClimateProduct(products[0]), !fail);
    assert.equal(operations.length, 1);
    assert.equal(operations[0].table, "climate_products");
    assert.equal(operations[0].method, "update");
    assert.deepEqual({ ...operations[0].value }, { active: false });
    assert.deepEqual(operations[0].filters, { id: products[0].id, workspace_id: "test-workspace" });
    assert.deepEqual(busy, [true, false]);
    assert.deepEqual(Array.from(catalog), fail ? products : [products[1]]);
    assert.deepEqual(Array.from(active), fail ? products : [products[1]]);
    assert.match(message, fail ? /test failure/ : /archiválva/);
  });
}
