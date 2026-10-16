const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");
const h = harness({}, { "@/lib/supabase": { supabase: {} }, "node:crypto": require("node:crypto") });
const products = h.load("src/lib/alinflow/products.ts");
const devices = h.load("src/lib/alinflow/appointment-devices.ts");
const declarations = h.load("src/lib/alinflow/purchase-declarations.ts");
const materials = h.load("src/lib/alinflow/materials.ts");
const workReports = h.load("src/lib/alinflow/work-report.ts");
const map = h.load("src/lib/alinflow/maintenance-map.ts");
const contactSources = h.load("src/lib/alinflow/google-contacts-source.ts");
const plain = value => JSON.parse(JSON.stringify(value));
products.setActiveProducts([{ id: "synthetic-ac", name: "Tesztklíma", price: 200000, installPrice: 60000,
  externalSource: "klimalin", imageUrl: "https://example.invalid/ac.png", productUrl: "https://example.invalid/ac" }]);
const climate = { productId: "synthetic-ac", quantity: 2 };
const legacy = { productId: "", customName: "Régi kézi klíma", isManual: true, quantity: 1, customPrice: 120000, customInstallPrice: 50000 };
const extra = { itemType: "extra", productId: "", customName: "Kondenzvíz szivattyú", isManual: true, quantity: 2, customPrice: 10000, customInstallPrice: 0 };

test("explicit extra item survives storage and JSON snapshots without changing legacy manual climates", () => {
  const saved = products.quoteItemToRow(extra, "quote-one");
  assert.equal(saved.description, "|install_price=0|item_type=extra");
  const restored = products.quoteItemFromRow(saved);
  assert.equal(restored.itemType, "extra"); assert.equal(restored.isManual, true);
  assert.equal(restored.productId, ""); assert.equal(restored.customName, extra.customName);
  assert.equal(restored.quantity, 2); assert.equal(restored.customPrice, 10000); assert.equal(restored.customInstallPrice, 0);
  assert.equal(products.cleanQuoteItems([restored])[0].itemType, "extra");
  const old = products.quoteItemToRow(legacy, "quote-old");
  assert.equal(old.description, "|install_price=50000");
  assert.equal(products.quoteItemFromRow(old).itemType, undefined);
  assert.equal(products.isExtraQuoteItem(products.quoteItemFromRow(old)), false);
  assert.equal(products.cleanQuoteItems([legacy])[0].itemType, undefined);
});

test("extra names matching catalog climates never become catalog stock or device items on reload", () => {
  const item = { ...extra, productId: "synthetic-ac", customName: "Tesztklíma" };
  const row = products.quoteItemToRow(item, "quote-one"), reloaded = products.quoteItemFromRow(row);
  assert.equal(reloaded.productId, ""); assert.equal(reloaded.isManual, true); assert.equal(reloaded.itemType, "extra");
  assert.equal(products.cleanQuoteItems([item])[0].productId, "");
  assert.deepEqual(plain(products.itemProductMedia(item)), {});
  assert.equal(devices.deviceSlots([reloaded]).length, 0);
});

test("extra rows remain in all price totals but not climate counts, summaries or serial-number slots", () => {
  const items = [climate, legacy, extra];
  assert.equal(products.cleanQuoteItems(items).length, 3);
  assert.equal(products.climateQuoteItems(items).length, 2);
  assert.equal(products.qty(items), 3);
  assert.equal(products.total(items), 540000);
  assert.equal(products.quoteInstallTotal(items), 170000);
  assert.equal(devices.deviceSlots(items).length, 3);
  assert.match(products.climateSummary(items), /Tesztklíma/);
  assert.match(products.climateSummary(items), /Régi kézi klíma/);
  assert.doesNotMatch(products.climateSummary(items), /szivattyú/);
  assert.equal(devices.deviceSlots([{ ...extra, quantity: 2.5 }]).length, 0, "An extra quantity is not validated as a count of serial-numbered devices");
});

test("extra amount defaults to no installation labor but an explicit split roundtrips intact", () => {
  assert.equal(products.itemInstallPrice({ ...extra, customInstallPrice: undefined }), 0);
  const split = { ...extra, customInstallPrice: 3000 };
  assert.equal(products.itemDeviceTotal(split), 14000); assert.equal(products.itemInstallTotal(split), 6000);
  const loaded = products.quoteItemFromRow(products.quoteItemToRow(split, "q"));
  assert.equal(products.itemDeviceTotal(loaded), 14000); assert.equal(products.itemInstallTotal(loaded), 6000);
  assert.equal(products.itemPriceLine(split), "Egyéb tétel");
  assert.equal(products.itemName({ ...extra, customName: "" }), "Egyéb tétel");
});

test("explicit climate kind roundtrips while unknown internal fields never enter cleaned item snapshots", () => {
  const typedClimate = products.quoteItemFromRow(products.quoteItemToRow({ ...legacy, itemType: "climate" }, "q"));
  assert.equal(typedClimate.itemType, "climate"); assert.equal(products.qty([typedClimate]), 1);
  const clean = products.cleanQuoteItems([{ ...extra, purchasePrice: 111, secretInternalNote: "private" }])[0];
  assert.equal(clean.purchasePrice, undefined); assert.equal(clean.secretInternalNote, undefined);
  assert.equal(products.cleanQuoteItems([{ ...extra, customName: "", productId: "synthetic-ac" }]).length, 0);
});

test("new purchase declarations exclude extras while saved declaration items remain available unchanged", () => {
  const editor = declarations.purchaseDeclarationEditorItems([climate, legacy, extra]);
  assert.equal(editor.items.length, 2); assert.equal(editor.selectedKeys.length, 2);
  const savedDeclaration = { quoteItems: [extra] };
  const existing = declarations.purchaseDeclarationEditorItems([climate, extra], savedDeclaration);
  assert.equal(existing.items[Number(existing.selectedKeys[0])].customName, extra.customName, "Never discard a previously saved document item");
  const newRow = declarations.declarationToRow({ customerId: "customer", appointmentId: "work", workReportId: "report",
    seller: { id: "seller", name: "Teszt vállalkozás", taxNumber: "synthetic", representative: "Teszt" },
    quoteItems: [climate, extra], report: {}, legacySourceKey: "key" });
  assert.equal(newRow.quote_items.length, 1); assert.equal(newRow.quote_items[0].productId, climate.productId);
  assert.equal(declarations.declarationFromRow({ quote_items: [extra] }).quoteItems[0].itemType, "extra");
});

test("extras do not increase default installation materials and extra-only work has no automatic installation kit", () => {
  const usage = { materials: [{ name: "Rézcső", qty: "3", unit: "m" }] };
  assert.equal(materials.materialAmountForWork("Rézcső", [climate, extra], usage), 6);
  assert.equal(materials.materialAmountForWork("Rézcső", [extra], usage), 0);
  assert.equal(materials.materialAmountForWork("Rézcső", [], usage), 3, "Legacy unknown-item fallback remains unchanged");
  assert.equal(materials.materialAmountForWork("Rézcső", [extra], { ...usage, overrides: { "Rézcső": "4" } }), 4);
  assert.equal(materials.materialAmountForWork("Rézcső", [extra], { materials: [{ ...usage.materials[0], isExtra: true }] }), 3);
});

test("work-report climate snapshot and maintenance map do not invent climates for extra-only work", () => {
  const customer = { id: "customer", activeAppointmentId: "work", appointmentType: "installation", date: "2026-01-02", time: "08:00",
    status: "Lezárva", name: "Teszt", city: "Példaváros", address: "Példa utca 1.", phone: "", quoteItems: [extra] };
  assert.doesNotMatch(workReports.captureWorkReportSnapshot(customer, [climate, extra]).climateSummary, /szivattyú/);
  assert.equal(map.buildMaintenanceMapPoints([customer]).length, 0);
  assert.equal(map.buildMaintenanceMapPoints([{ ...customer, quoteItems: [legacy, extra] }]).length, 1);
  assert.equal(map.buildMaintenanceMapPoints([{ ...customer, quoteItems: [] }]).length, 1, "Old unknown-type installations remain visible");
});

test("Contacts source keeps every real climate but excludes extra-only work and extra lines", () => {
  const workspaceId = "workspace", row = value => ({ workspace_id: workspaceId, ...value });
  const base = {
    customers: [row({ id: "customer", name: "Teszt", phone: "+36301234567" })],
    appointments: [row({ id: "work", customer_id: "customer", quote_id: "quote", appointment_type: "installation", scheduled_date: "2026-01-02", status: "Lezárva" })],
    quotes: [row({ id: "quote", customer_id: "customer" })], devices: [], maintenanceLinks: [], excludedInstallationIds: [],
    quoteItems: [row({ id: "extra", ...products.quoteItemToRow(extra, "quote") })],
  };
  assert.equal(contactSources.projectGoogleContactSources(base, workspaceId, "2026-02-02").length, 0);
  const mixed = { ...base, quoteItems: [...base.quoteItems, row({ id: "climate", ...products.quoteItemToRow(legacy, "quote") })] };
  const exported = contactSources.projectGoogleContactSources(mixed, workspaceId, "2026-02-02");
  assert.equal(exported.length, 1); assert.match(exported[0].notes, /Régi kézi klíma/); assert.doesNotMatch(exported[0].notes, /szivattyú/);
  assert.equal(contactSources.projectGoogleContactSources({ ...base, quoteItems: [] }, workspaceId, "2026-02-02").length, 1);
});
