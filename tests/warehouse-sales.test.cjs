const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const catalog = [
  { id: "synthetic-ac-a", name: "Synthetic AC A", price: 300000, installPrice: 80000 },
  { id: "synthetic-ac-b", name: "Synthetic AC B", price: 200000, installPrice: 60000 },
];
const item = (patch = {}) => ({ productId: "synthetic-ac-a", quantity: 1, ...patch });
const work = (patch = {}) => ({
  id: "synthetic-customer", activeAppointmentId: "synthetic-appointment",
  appointmentType: "installation", date: "2026-11-12", status: "Időpont foglalva",
  stockDeducted: false, quotePricingMode: "bundle", quoteItems: [item()], ...patch,
});
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(products = catalog) {
  const h = harness({}, { "@/lib/supabase": { supabase: {} } });
  const productHelpers = h.load("src/lib/alinflow/products.ts");
  productHelpers.setActiveProducts(products);
  const { summarizeReservedClimateSales } = h.load("src/lib/alinflow/warehouse-value.ts");
  return {
    ...productHelpers,
    summarize: (works, availableProducts = products) => plain(summarizeReservedClimateSales(works, availableProducts)),
  };
}

test("reserved climate sales include only dated, unfinished installation reservations", () => {
  const f = fixture();
  const excluded = [
    { date: undefined }, { date: "" }, { appointmentType: "survey" },
    { appointmentType: "maintenance" }, { status: "Lezárva" },
    { status: "Lemondva" }, { stockDeducted: true },
  ].map((patch, index) => work({ ...patch, activeAppointmentId: `excluded-${index}` }));
  assert.deepEqual(f.summarize([work(), ...excluded]), { total: 300000, incompleteWorkCount: 0 });
  assert.deepEqual(f.summarize(excluded), { total: 0, incompleteWorkCount: 0 });
});

test("legacy installation type and overdue unfinished reservations retain their existing reservation meaning", () => {
  const f = fixture();
  assert.deepEqual(f.summarize([
    work({ appointmentType: undefined }),
    work({ activeAppointmentId: "older-work", date: "2025-01-01", quoteItems: [item({ customPrice: 250000 })] }),
  ]), { total: 550000, incompleteWorkCount: 0 });
});

test("saved quote prices and quantities determine sales including installation, not current catalog prices", () => {
  const f = fixture();
  const works = [work({ quoteItems: [
    item({ quantity: 2, customPrice: 250000, customInstallPrice: 60000 }),
    item({ productId: "synthetic-ac-b", quantity: 3, customPrice: 170000, customInstallPrice: 50000 }),
  ] })];
  const expected = { total: 1010000, incompleteWorkCount: 0 };
  assert.deepEqual(f.summarize(works), expected);
  const changedCatalog = catalog.map(product => ({ ...product, price: product.price + 500000 }));
  f.setActiveProducts(changedCatalog);
  assert.deepEqual(f.summarize(works, changedCatalog), expected, "later catalog changes must not reprice saved reservations");
});

test("legacy lines without saved price use the active catalog full installation price", () => {
  const f = fixture();
  assert.deepEqual(f.summarize([work({ quoteItems: [
    item({ quantity: 2 }), item({ productId: "synthetic-ac-b", quantity: 1, customPrice: "" }),
  ] })]), { total: 800000, incompleteWorkCount: 0 });
});

test("separate booked appointments for the same customer are both included at their own agreed prices", () => {
  const f = fixture();
  assert.deepEqual(f.summarize([
    work({ activeAppointmentId: "first-installation", quoteItems: [item({ customPrice: 220000 })] }),
    work({ activeAppointmentId: "second-installation", quoteItems: [item({ quantity: 2, customPrice: 230000 })] }),
  ]), { total: 680000, incompleteWorkCount: 0 });
});

test("extras and manual or missing-catalog devices are excluded even when they carry sales prices", () => {
  const f = fixture();
  assert.deepEqual(f.summarize([work({ quoteItems: [
    item({ customPrice: 240000 }),
    item({ itemType: "extra", customPrice: 999999, quantity: 4 }),
    item({ productId: "", isManual: true, customName: "External climate", customPrice: 888888 }),
    item({ productId: "missing-catalog-product", productName: "Old climate", customPrice: 777777 }),
  ] })]), { total: 240000, incompleteWorkCount: 0 });
  assert.deepEqual(f.summarize([work()], []), { total: 0, incompleteWorkCount: 0 });
});

test("unresolved alternative offers are not added together and flag each affected work once", () => {
  const f = fixture();
  assert.deepEqual(f.summarize([
    work({ activeAppointmentId: "chosen-work", quoteItems: [item({ customPrice: 150000 })] }),
    work({ activeAppointmentId: "alternatives-a", quotePricingMode: "alternatives", quoteItems: [
      item(), item({ productId: "synthetic-ac-b" }),
    ] }),
    work({ activeAppointmentId: "alternatives-b", quotePricingMode: "alternatives", quoteItems: [
      item({ customPrice: 260000 }),
      item({ productId: "", isManual: true, customName: "Alternative external unit", customPrice: 240000 }),
    ] }),
  ]), { total: 150000, incompleteWorkCount: 2 });
});

test("a single remaining alternative can be valued and excluded work cannot mark the result incomplete", () => {
  const f = fixture();
  assert.deepEqual(f.summarize([
    work({ quotePricingMode: "alternatives", quoteItems: [item({ customPrice: 230000, quantity: 2 })] }),
    work({ status: "Lemondva", quotePricingMode: "alternatives", quoteItems: [item(), item()] }),
    work({ activeAppointmentId: "not-warehouse", quotePricingMode: "alternatives", quoteItems: [
      item({ productId: "missing-a" }), item({ productId: "missing-b" }),
    ] }),
  ]), { total: 460000, incompleteWorkCount: 0 });
});

test("invalid amounts cannot contaminate the sum and mark an affected work only once", () => {
  const f = fixture();
  assert.deepEqual(f.summarize([work({ quoteItems: [
    item({ customPrice: -100 }), item({ customPrice: -200 }), item({ customPrice: 250000 }),
  ] })]), { total: 250000, incompleteWorkCount: 1 });
  const invalidCatalog = [{ ...catalog[0], price: Infinity }];
  const invalid = fixture(invalidCatalog);
  assert.deepEqual(invalid.summarize([work()]), { total: 0, incompleteWorkCount: 1 });
});

test("real zero prices stay valid, empty inputs are zero, and decimal line sums remain stable", () => {
  const f = fixture();
  assert.deepEqual(f.summarize([work({ quoteItems: [item({ customPrice: 0, customInstallPrice: 0 })] })]),
    { total: 0, incompleteWorkCount: 0 });
  assert.deepEqual(f.summarize([]), { total: 0, incompleteWorkCount: 0 });
  assert.deepEqual(f.summarize([work({ quoteItems: [
    item({ customPrice: 100000.1, quantity: 3 }), item({ customPrice: 200000.2, quantity: 1 }),
  ] })]), { total: 500000.5, incompleteWorkCount: 0 });
});

test("the calculation leaves source works, saved quote prices, and catalog data unchanged", () => {
  const products = Object.freeze(catalog.map(product => Object.freeze({ ...product })));
  const quoteItems = Object.freeze([Object.freeze(item({ quantity: 3, customPrice: 270000, customInstallPrice: 70000 }))]);
  const works = Object.freeze([Object.freeze(work({ quoteItems }))]);
  const before = JSON.stringify({ products, works });
  const f = fixture(products);
  assert.deepEqual(f.summarize(works), { total: 810000, incompleteWorkCount: 0 });
  assert.equal(JSON.stringify({ products, works }), before);
});
