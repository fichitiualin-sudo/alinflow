const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const {
  buildMaintenanceMapPoints,
  filterMaintenanceMapPoints,
  groupMaintenanceMapPoints,
  maintenanceMapOriginLabel,
  normalizeMaintenanceMapVisibility,
} = harness().load("src/lib/alinflow/maintenance-map.ts");

const point = (appointmentId, patch = {}) => ({
  appointmentId,
  customer: { id: "customer-1", name: "Teszt ügyfél", quoteItems: [] },
  customerId: "customer-1",
  customerName: "Teszt ügyfél",
  climateSummary: "Teszt klíma",
  address: "Teszt cím",
  city: "Teszt település",
  installationLabel: "Telepítés",
  maintenanceCount: 0,
  status: "ok",
  latitude: 47,
  longitude: 19,
  ...patch,
});
const ids = points => Array.from(points, item => item.appointmentId);

test("the two origin switches independently include legacy, own and external installations", () => {
  const points = [
    point("legacy"),
    point("own", { maintenanceOrigin: "own" }),
    point("external", { maintenanceOrigin: "external" }),
  ];
  for (const [own, external, expected] of [
    [true, true, ["legacy", "own", "external"]],
    [true, false, ["legacy", "own"]],
    [false, true, ["external"]],
    [false, false, []],
  ]) {
    assert.deepEqual(ids(filterMaintenanceMapPoints(points, { visibility: { own, external } })), expected);
  }
});

test("origin filtering combines with maintenance state and accent-insensitive search", () => {
  const points = [
    point("own-overdue", { maintenanceOrigin: "own", status: "overdue" }),
    point("external-overdue", { maintenanceOrigin: "external", maintenanceSourceName: "  Átadó  Kft. ", status: "overdue" }),
    point("external-ok", { maintenanceOrigin: "external", maintenanceSourceName: "Átadó Kft." }),
    point("external-other", { maintenanceOrigin: "external", maintenanceSourceName: "Másik szerelő", status: "overdue" }),
  ];
  const visibility = { own: false, external: true };
  assert.deepEqual(ids(filterMaintenanceMapPoints(points, { visibility, search: "atado kft", status: "overdue" })), ["external-overdue"]);
  assert.deepEqual(ids(filterMaintenanceMapPoints(points, { visibility, search: "TESZT  UGYFEL", status: "ok" })), ["external-ok"]);
  assert.deepEqual(ids(filterMaintenanceMapPoints(points, { visibility, search: "nincs ilyen" })), []);
});

test("shared-location markers contain only visible origins and retain their own status", () => {
  const points = [
    point("own", { maintenanceOrigin: "own", status: "overdue" }),
    point("external", { maintenanceOrigin: "external", status: "ok" }),
    point("external-missing-location", { maintenanceOrigin: "external", latitude: undefined }),
  ];
  const filtered = filterMaintenanceMapPoints(points, { visibility: { own: false, external: true } });
  const groups = groupMaintenanceMapPoints(filtered);
  assert.deepEqual(ids(filtered), ["external", "external-missing-location"]);
  assert.equal(groups.length, 1);
  assert.deepEqual(ids(groups[0].points), ["external"]);
  assert.equal(groups[0].status, "ok");
  assert.equal(groupMaintenanceMapPoints(filterMaintenanceMapPoints(points, { visibility: { own: false, external: false } })).length, 0);
});

test("filtering never edits customer records, document references or maintenance opt-out", () => {
  const input = [point("external", {
    maintenanceOrigin: "external",
    status: "optOut",
    customer: { id: "customer-1", quoteItems: [], maintenanceOptOut: true, activeWorkReportId: "report-1" },
  })];
  const before = structuredClone(input);
  Object.freeze(input[0].customer);
  Object.freeze(input[0]);
  Object.freeze(input);
  const filtered = filterMaintenanceMapPoints(input, { visibility: { own: false, external: true }, status: "optOut" });
  assert.equal(filtered[0], input[0]);
  assert.deepEqual(input, before);
});

test("invalid or absent preferences default to both groups and valid off switches survive", () => {
  for (const value of [undefined, null, "bad", 12, {}, { own: "false", external: 0 }]) {
    const result = normalizeMaintenanceMapVisibility(value);
    assert.equal(result.own, true);
    assert.equal(result.external, true);
  }
  const bothOff = normalizeMaintenanceMapVisibility({ own: false, external: false });
  assert.equal(bothOff.own, false);
  assert.equal(bothOff.external, false);
  const partial = normalizeMaintenanceMapVisibility({ external: false });
  assert.equal(partial.own, true);
  assert.equal(partial.external, false);
});

test("point construction defaults legacy origin and preserves external installation maintenance links", () => {
  const customer = { id: "customer-1", name: "Teszt ügyfél", city: "Tesztváros", address: "Teszt cím", quoteItems: [] };
  const works = [
    { ...customer, activeAppointmentId: "legacy", appointmentType: "installation", status: "Lezárva", date: "2024-01-01" },
    { ...customer, activeAppointmentId: "external", appointmentType: "installation", status: "Lezárva", date: "2024-01-01",
      maintenanceOrigin: "external", maintenanceSourceName: "  Példa Szerelő  " },
    { ...customer, activeAppointmentId: "own", appointmentType: "installation", status: "Lezárva", date: "2024-01-01",
      maintenanceOrigin: "own", maintenanceSourceName: "Régi átadó" },
    { ...customer, activeAppointmentId: "maintenance", appointmentType: "maintenance", status: "Lezárva", date: "2025-01-01",
      maintenanceInstallationIds: ["external"] },
  ];
  const before = structuredClone(works);
  const points = buildMaintenanceMapPoints(works);
  assert.equal(points.length, 3);
  const legacy = points.find(item => item.appointmentId === "legacy");
  const own = points.find(item => item.appointmentId === "own");
  const external = points.find(item => item.appointmentId === "external");
  assert.equal(legacy.maintenanceOrigin, "own");
  assert.equal(legacy.maintenanceCount, 0);
  assert.equal(own.maintenanceSourceName, undefined);
  assert.equal(external.maintenanceOrigin, "external");
  assert.equal(external.maintenanceSourceName, "Példa Szerelő");
  assert.equal(external.maintenanceCount, 1);
  assert.equal(external.lastMaintenanceDate, "2025-01-01");
  assert.equal(external.nextMaintenanceDue, "2026-01-01");
  assert.deepEqual(works, before);
});

test("origin labels show the source only for externally installed units", () => {
  assert.equal(maintenanceMapOriginLabel(point("legacy")), "Saját telepítés");
  assert.equal(maintenanceMapOriginLabel(point("own", { maintenanceOrigin: "own", maintenanceSourceName: "Régi átadó" })), "Saját telepítés");
  assert.equal(maintenanceMapOriginLabel(point("external", { maintenanceOrigin: "external" })), "Karbantartásra átvett");
  assert.equal(maintenanceMapOriginLabel(point("external", { maintenanceOrigin: "external", maintenanceSourceName: "  Példa  " })), "Karbantartásra átvett · Példa");
});
