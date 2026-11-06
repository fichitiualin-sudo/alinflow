const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness, noop } = require("./helpers.cjs");
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ["2026-11-06T12:00:00Z"])); } }
const h = harness({ Date: FixedDate }, { "react/jsx-runtime": require("react/jsx-runtime") });
const map = h.load("src/lib/alinflow/maintenance-map.ts");
const shared = h.load("src/lib/alinflow/shared-maintenance.ts");
const devices = h.load("src/lib/alinflow/maintenance-devices.ts");
const products = h.load("src/lib/alinflow/products.ts");
const format = h.load("src/lib/alinflow/format.ts");
const appointment = h.load("src/lib/alinflow/appointments.ts");
const constants = h.load("src/lib/alinflow/constants.ts");
const ac = { productId: "manual", customName: "Minta klíma", isManual: true, quantity: 4 };
const installation = { id: "customer", activeAppointmentId: "installation", appointmentType: "installation", status: "Lezárva",
  name: "Teszt", city: "", address: "", date: "2025-01-01", quoteItems: [ac] };
const selection = (...numbers) => numbers.map(unitNumber => ({ productName: "Minta klíma", unitNumber }));
const visit = (id, numbers, date = "2026-11-01") => ({ ...installation, activeAppointmentId: id, appointmentType: "maintenance",
  date, maintenanceInstallationIds: ["installation"], maintenanceDeviceSelections: numbers == null ? undefined : { installation: selection(...numbers) } });
const point = (...visits) => map.buildMaintenanceMapPoints([installation, ...visits])[0];
const lastDates = point => Array.from(point.maintenanceDevices, device => device.lastMaintenanceDate);

test("one of four devices advances only that device; the map keeps the other three overdue", () => {
  const result = point(visit("one", [2]));
  assert.equal(result.maintenanceDevices.length, 4);
  assert.deepEqual(lastDates(result), [undefined, "2026-11-01", undefined, undefined]);
  assert.equal(result.status, "overdue");
  assert.equal(result.nextMaintenanceDue, "2026-01-01");
  assert.equal(result.lastMaintenanceDate, "2026-11-01");
  assert.match(map.maintenanceDeviceSummary(result.maintenanceDevices), /Rendben: 1 \/ 4 klíma · Esedékes: 3/);
});

test("successive partial visits retain physical identities instead of shifting service to the first unit", () => {
  const result = point(visit("one", [2]), visit("two", [4], "2026-11-02"), visit("same-again", [2], "2026-11-03"));
  assert.deepEqual(lastDates(result), [undefined, "2026-11-03", undefined, "2026-11-02"]);
  assert.deepEqual(Array.from(result.maintenanceDevices, device => device.maintenanceCount), [0, 2, 0, 1]);
  assert.equal(result.status, "overdue");
});

test("four separate partial visits make every device current without modifying the installation", () => {
  const before = JSON.stringify(installation);
  const result = point(...[1, 2, 3, 4].map(number => visit(`visit-${number}`, [number], `2026-11-0${number}`)));
  assert.equal(result.status, "ok");
  assert.equal(result.nextMaintenanceDue, "2027-11-01");
  assert.equal(JSON.stringify(installation), before);
});

test("legacy whole-installation service remains whole; cancelled, future and merely booked work does not advance any unit", () => {
  const legacy = point(visit("legacy", null));
  assert.deepEqual(lastDates(legacy), Array(4).fill("2026-11-01"));
  assert.equal(legacy.status, "ok");
  const ignored = point({ ...visit("cancelled", [1]), status: "Lemondva" }, { ...visit("booked", [2]), status: "Időpont foglalva" }, visit("future", [3], "2026-12-01"));
  assert.deepEqual(lastDates(ignored), Array(4).fill(undefined));
});

const received = { grantId: "grant", installationId: "source", sourceWorkspaceId: "source-workspace", sourceWorkspaceName: "Forrás",
  customer: { name: "Teszt", phone: "", email: "", postalCode: "", city: "", address: "" },
  installationDate: "2025-01-01", installationTime: "08:00", climates: [{ productName: "Minta klíma", quantity: 4 }],
  latitude: null, longitude: null, lastMaintenanceDate: "2026-11-01", maintenanceCount: 1,
  maintenanceHistory: [{ date: "2026-11-01", providerName: "Partner", status: "Lezárva", selectedDevices: selection(2) }] };

test("received installations and owner-side partner results preserve the same partial selection", () => {
  const recipient = shared.sharedMaintenanceMapPoint(received);
  assert.deepEqual(lastDates(recipient), [undefined, "2026-11-01", undefined, undefined]);
  assert.equal(recipient.status, "overdue");
  const owner = shared.applySharedMaintenanceResults([point()], [{ installationId: "installation", date: "2026-11-01", status: "Lezárva", providerName: "Partner", selectedDevices: selection(2) }])[0];
  assert.deepEqual(lastDates(owner), lastDates(recipient));
  assert.equal(owner.status, "overdue");
  assert.equal(owner.maintenanceDevices[1].providerName, "Partner");
});

test("accepted handoff combines device histories by name and number across different catalog identities", () => {
  const local = point(visit("local", [4], "2026-11-03"));
  const result = shared.mergeSharedMaintenancePoints([local], [{ ...received, targetInstallationId: "installation" }])[0];
  assert.deepEqual(lastDates(result), [undefined, "2026-11-01", undefined, "2026-11-03"]);
  assert.equal(result.status, "overdue");
  assert.equal(result.maintenanceCount, 2);
  assert.equal(local.maintenanceDevices[1].lastMaintenanceDate, undefined, "Refresh never mutates the local state");
  assert.deepEqual(lastDates(shared.mergeSharedMaintenancePoints([local], [{ ...received, targetInstallationId: "installation" }])[0]), lastDates(result));
});

test("opt-out remains in force when partner maintenance is partially recorded", () => {
  const result = shared.applySharedMaintenanceResults([{ ...point(), status: "optOut" }], [{ installationId: "installation", date: "2026-11-01", status: "Lezárva", providerName: "Partner", selectedDevices: selection(1) }])[0];
  assert.equal(result.status, "optOut");
  assert.equal(result.maintenanceDevices.filter(device => device.lastMaintenanceDate).length, 1);
});

test("malformed historical quantity keeps the map available with unknown status, never false completion", () => {
  for (const quantity of [1.5, 1001]) {
    const broken = { ...installation, quoteItems: [{ ...ac, quantity }] };
    const result = map.buildMaintenanceMapPoints([broken, visit("partial", [1])])[0];
    assert.equal(result.status, "unknown");
    assert.equal(result.maintenanceDeviceDataInvalid, true);
    assert.equal(result.nextMaintenanceDue, undefined);
    const sharedResult = shared.applySharedMaintenanceResults([result], [{ installationId: "installation", date: "2026-11-01", status: "Lezárva", providerName: "Partner", selectedDevices: selection(1) }])[0];
    assert.equal(sharedResult.status, "unknown");
  }
});

test("customer history identifies the maintained unit and leaves three units without a maintenance date", () => {
  const ui = h.functions(["workIdentity", "compareWorkByDateDesc", "workDateTimeLabel", "workAddressLabel", "isCancelledWork", "hasInstalledClimateItems", "isInstalledClimateWork",
    "sharedMaintenanceHistoryRows", "ClimateMaintenanceHistory", "InstalledClimateMaintenanceCard"],
    { ...devices, ...map, ...products, ...format, ...appointment, ...constants, ...h.load("src/lib/alinflow/maintenance-contact-choice.ts"),
      ...h.load("src/components/alinflow/MaintenanceChoiceControls.tsx") }, "src/components/alinflow/WorkPagePanel.tsx");
  const rows = ui.sharedMaintenanceHistoryRows("customer", [installation], [{ installationId: "installation", date: "2026-11-01", status: "Lezárva", providerName: "Partner", selectedDevices: selection(2) }]);
  assert.match(rows[0].relatedClimateSummary, /2\. készülék/);
  const html = renderToStaticMarkup(React.createElement(ui.InstalledClimateMaintenanceCard, { installation, works: [], sharedRows: rows,
    onOpenWorkVersion: noop, onToggleMaintenanceOptOut: noop }));
  assert.equal((html.match(/Utolsó karbantartás: nincs adat/g) || []).length, 3);
  assert.equal((html.match(/Utolsó karbantartás: 2026.11.01/g) || []).length, 1);
  assert.match(html, /2\. készülék/);
  assert.match(html, /Partner/);
});
