const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");
const devices = harness().load("src/lib/alinflow/maintenance-devices.ts");
const plain = value => JSON.parse(JSON.stringify(value));
const item = { productId: "model-a", productName: "Synthetic AC", quantity: 4,
  customPrice: 200000, customInstallPrice: 70000 };

test("one of four units produces one maintenance item and preserves the installation", () => {
  const items = [item];
  const before = plain(items);
  const slots = devices.maintenanceDeviceSlots(items);
  assert.equal(slots.length, 4);
  assert.deepEqual(plain(slots).map(slot => slot.unitNumber), [1, 2, 3, 4]);
  const selected = [slots[2]];
  const result = devices.selectedMaintenanceQuoteItems(items, selected);
  assert.equal(result.length, 1);
  assert.equal(result[0].quantity, 1);
  assert.equal(result[0].customPrice, item.customPrice);
  assert.equal(result[0].customInstallPrice, item.customInstallPrice);
  assert.deepEqual(items, before);
  assert.deepEqual(plain(slots.map(slot => devices.maintenanceDeviceMatches(slot, selected))), [false, false, true, false]);
});

test("repeated partial visits retain independent dates for the actually selected units", () => {
  const slots = devices.maintenanceDeviceSlots([item]);
  const visits = [{ date: "2026-11-01", selected: [slots[0]] },
    { date: "2026-11-02", selected: [slots[2]] }, { date: "2026-11-03", selected: [slots[0]] }];
  const latest = slots.map(slot => visits.filter(visit => devices.maintenanceDeviceMatches(slot, visit.selected)).at(-1)?.date || null);
  assert.deepEqual(plain(latest), ["2026-11-03", null, "2026-11-02", null]);
});

test("same named models count cumulatively across rows and select the proper row quantity", () => {
  const items = [{ ...item, quantity: 2 }, { ...item, productId: "different-catalog-id", productName: " synthetic ac ", quantity: 2, customPrice: 300000 },
    { ...item, productName: "Other model", quantity: 1 },
    { productId: "", customName: "Extra work", quantity: 4, isManual: true, itemType: "extra" }];
  const slots = devices.maintenanceDeviceSlots(items);
  assert.deepEqual(plain(slots.map(slot => slot.unitNumber)), [1, 2, 3, 4, 1]);
  const result = devices.selectedMaintenanceQuoteItems(items, [{ productName: "SYNTHETIC AC", unitNumber: 3 }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].quantity, 1);
  assert.equal(result[0].productId, "different-catalog-id");
  assert.equal(result[0].customPrice, 300000);
});

test("source and handed-off catalog-free snapshots share device identities", () => {
  const source = devices.maintenanceDeviceSlots([item]);
  const target = devices.maintenanceDeviceSlots([{ productId: "manual-0", customName: "Synthetic AC", isManual: true, quantity: 4 }]);
  assert.deepEqual(plain(source.map(devices.maintenanceDeviceKey)), plain(target.map(devices.maintenanceDeviceKey)));
});

test("legacy missing and null selection still service every unit while explicit empty means none", () => {
  for (const value of [undefined, null]) {
    assert.equal(devices.selectedMaintenanceQuoteItems([item], value)[0].quantity, 4);
    assert.equal(devices.selectedMaintenanceDevices([item], value).length, 4);
    assert.equal(devices.maintenanceDeviceMatches({ productName: "Synthetic AC", unitNumber: 4 }, value), true);
  }
  assert.deepEqual(plain(devices.selectedMaintenanceQuoteItems([item], [])), []);
  assert.equal(devices.maintenanceDeviceMatches({ productName: "Synthetic AC", unitNumber: 1 }, []), false);
});

test("invalid or stale selections never silently expand to the entire installation", () => {
  for (const selection of [[{ productName: "Synthetic AC", unitNumber: 5 }], [{ productName: "Wrong model", unitNumber: 1 }],
    [{ productName: "Synthetic AC", unitNumber: 0 }], [{ productName: "Synthetic AC", unitNumber: 1.5 }],
    [{ productName: "Synthetic AC", unitNumber: "1" }], [{ productName: "", unitNumber: 1 }], [null],
    [{ productName: "Synthetic AC", unitNumber: 1 }, { productName: " SYNTHETIC AC ", unitNumber: 1 }], {}]) {
    assert.throws(() => devices.selectedMaintenanceQuoteItems([item], selection), /klím|kiválaszt/);
  }
  assert.throws(() => devices.maintenanceDeviceSlots([{ ...item, quantity: 1.5 }]), /egész darabszám/);
});

test("selection lookup preserves explicit empty selection and only falls back for absent entries", () => {
  const summary = { appointmentId: "install", quoteItems: [item], selectedDevices: [{ productName: "Synthetic AC", unitNumber: 2 }] };
  assert.deepEqual(plain(devices.maintenanceSelectionFor({ maintenanceInstallations: [summary] }, "install")), summary.selectedDevices);
  assert.deepEqual(plain(devices.maintenanceSelectionFor({ maintenanceDeviceSelections: { install: [] }, maintenanceInstallations: [summary] }, "install")), []);
  assert.equal(devices.maintenanceSelectionFor({ maintenanceInstallations: [{ ...summary, selectedDevices: null }] }, "install"), undefined);
  assert.equal(devices.maintenanceSelectionFor({}, "unknown"), undefined);
});

test("canonicalizing mirror aliases preserves partial selections and gives real IDs priority", () => {
  const { canonicalCustomerAppointments } = harness().load("src/lib/alinflow/maintenance-selection.ts");
  const real = [{ productName: "Synthetic AC", unitNumber: 3 }];
  const mirror = [{ productName: "Synthetic AC", unitNumber: 1 }];
  for (const entries of [[["install", real], ["mirror", mirror]], [["mirror", mirror], ["install", real]]]) {
    const input = { maintenanceDeviceSelections: Object.fromEntries([...entries, ["unknown", mirror], ["none", []]]) };
    const before = plain(input);
    const result = canonicalCustomerAppointments(input, new Map([["mirror", "install"]]));
    assert.deepEqual(plain(result.maintenanceDeviceSelections), { install: real, unknown: mirror, none: [] });
    assert.deepEqual(input, before);
  }
  const onlyAlias = canonicalCustomerAppointments({ maintenanceDeviceSelections: { mirror } }, new Map([["mirror", "install"]]));
  assert.deepEqual(plain(onlyAlias.maintenanceDeviceSelections), { install: mirror });
});
