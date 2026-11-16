const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ["2026-11-16T12:00:00Z"])); } }
const h = harness({ Date: FixedDate });
const map = h.load("src/lib/alinflow/maintenance-map.ts");
const shared = h.load("src/lib/alinflow/shared-maintenance.ts");
const choices = h.load("src/lib/alinflow/maintenance-contact-choice.ts");
const { applyScheduledMaintenance } = h.load("src/lib/alinflow/maintenance-scheduled-map.ts");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const customerId = id(1), installationId = id(2), visitId = id(3), sourceWorkspaceId = id(4);
const selection = (...numbers) => numbers.map(unitNumber => ({ productName: "Minta klíma", unitNumber }));
const installation = {
  id: customerId, activeAppointmentId: installationId, appointmentType: "installation", status: "Lezárva",
  name: "Teszt Ügyfél", city: "Minta város", address: "Minta utca 1.", date: "2025-01-01", time: "08:00",
  quoteItems: [{ productId: "manual", customName: "Minta klíma", isManual: true, quantity: 2 }],
};
const booked = overrides => ({ ...installation, activeAppointmentId: visitId, appointmentType: "maintenance",
  status: "Időpont foglalva", date: "2026-11-20", time: "10:30", maintenanceInstallationIds: [installationId], ...overrides });
const schedule = overrides => ({ installationId, sourceInstallationId: installationId, sourceWorkspaceId,
  maintenanceAppointmentId: visitId, date: "2026-11-20", time: "10:30", providerName: "Teszt partner", ...overrides });
const preference = overrides => ({ installationId, sourceInstallationId: installationId, sourceWorkspaceId,
  sourceWorkspaceName: "Teszt forrás", choice: "open", updatedAt: "2026-11-16T11:00:00Z", isSource: true, ...overrides });
const received = overrides => ({ grantId: id(5), installationId, sourceWorkspaceId, sourceWorkspaceName: "Teszt forrás",
  customer: { name: "Teszt Ügyfél", phone: "", email: "", postalCode: "", city: "Minta város", address: "Minta utca 1." },
  installationDate: installation.date, installationTime: installation.time, climates: [{ productName: "Minta klíma", quantity: 2 }],
  latitude: null, longitude: null, lastMaintenanceDate: null, maintenanceCount: 0, ...overrides });
const pipeline = (works = [installation], { results = [], incoming = [], preferences = [], schedules = [] } = {}) => {
  const own = shared.applySharedMaintenanceResults(map.buildMaintenanceMapPoints(works), results);
  const points = choices.applyMaintenanceContactPreferences(shared.mergeSharedMaintenancePoints(own, incoming), preferences);
  return applyScheduledMaintenance(points, works, schedules);
};
const statuses = point => Array.from(point.maintenanceDevices || [], device => device.status);
const history = point => JSON.stringify({ maintenanceCount: point.maintenanceCount, lastMaintenanceDate: point.lastMaintenanceDate,
  nextMaintenanceDue: point.nextMaintenanceDue, devices: Array.from(point.maintenanceDevices || [], device => ({
    maintenanceCount: device.maintenanceCount, lastMaintenanceDate: device.lastMaintenanceDate, nextMaintenanceDue: device.nextMaintenanceDue,
  })) });

test("saved whole-installation booking is purple without recording completed maintenance or mutating inputs", () => {
  const works = [installation, booked()];
  const before = JSON.stringify(works), baseline = pipeline()[0];
  const result = pipeline(works)[0];
  assert.equal(result.status, "scheduled");
  assert.deepEqual(statuses(result), ["scheduled", "scheduled"]);
  assert.equal(result.scheduledMaintenanceDate, "2026-11-20");
  assert.equal(result.scheduledMaintenanceTime, "10:30");
  assert.equal(history(result), history(baseline));
  assert.equal(JSON.stringify(works), before);
  assert.equal(map.maintenanceMapStatusLabel(result.status), "Egyeztetve");
  assert.equal(map.maintenanceMapStatusColor(result.status), "#8b5cf6");
  const beforePoint = JSON.stringify(baseline);
  applyScheduledMaintenance([baseline], works);
  assert.equal(JSON.stringify(baseline), beforePoint);
});

test("past unfinished appointments remain scheduled; time alone never completes the maintenance", () => {
  const point = pipeline([installation, booked({ date: "2026-11-10" })])[0];
  assert.equal(point.status, "scheduled");
  assert.equal(point.scheduledMaintenanceDate, "2026-11-10");
  assert.equal(point.maintenanceCount, 0);
  assert.equal(point.lastMaintenanceDate, undefined);
});

test("completion turns the booked installation green and cancellation or deletion restores its original due state", () => {
  const done = pipeline([installation, booked({ date: "2026-11-15", status: "Lezárva" })])[0];
  assert.equal(done.status, "ok");
  assert.equal(done.maintenanceCount, 1);
  assert.equal(done.lastMaintenanceDate, "2026-11-15");
  assert.equal(done.scheduledMaintenanceDate, undefined);
  for (const works of [[installation], [installation, booked({ status: "Lemondva" })]]) {
    const point = pipeline(works)[0];
    assert.equal(point.status, "overdue");
    assert.equal(point.scheduledMaintenanceDate, undefined);
    assert.equal(point.maintenanceCount, 0);
  }
});

test("invalid, unsaved and non-maintenance appointments cannot set the scheduled marker", () => {
  for (const patch of [
    { activeAppointmentId: undefined }, { activeAppointmentId: "" }, { appointmentType: "survey" },
    { status: "Új érdeklődő" }, { date: "" }, { date: "invalid" }, { date: "2026-02-30" },
    { time: "" }, { time: undefined }, { time: "24:00" }, { time: "10:90" },
    { appointmentCancelledAt: "2026-11-16T11:00:00Z" },
  ]) {
    assert.equal(pipeline([installation, booked(patch)])[0].status, "overdue", JSON.stringify(patch));
  }
});

test("persisted SQL time with seconds is accepted as an agreed appointment", () => {
  assert.equal(pipeline([installation, booked({ time: "10:30:00" })])[0].status, "scheduled");
});

test("historical installations without device rows still allow an explicit whole-installation appointment", () => {
  const noDevices = { ...installation, quoteItems: [] };
  const result = pipeline([noDevices, booked()])[0];
  assert.equal(result.status, "scheduled");
  assert.equal(result.maintenanceCount, 0);
  assert.equal(result.nextMaintenanceDue, pipeline([noDevices])[0].nextMaintenanceDue);
});

test("invalid physical device data cannot be hidden by a whole-installation booking", () => {
  const invalid = { ...installation, quoteItems: [{ ...installation.quoteItems[0], quantity: 1.5 }] };
  const result = pipeline([invalid, booked()])[0];
  assert.equal(result.maintenanceDeviceDataInvalid, true);
  assert.equal(result.status, "unknown");
  assert.equal(result.scheduledMaintenanceDate, undefined);
});

test("an explicit installation link and matching local customer identity are both required", () => {
  for (const patch of [
    { maintenanceInstallationIds: undefined }, { maintenanceInstallationIds: [] },
    { maintenanceInstallationIds: [id(99)] }, { id: id(99) },
  ]) assert.equal(pipeline([installation, booked(patch)])[0].status, "overdue", JSON.stringify(patch));
  const otherInstallation = { ...installation, activeAppointmentId: id(8) };
  const points = pipeline([installation, otherInstallation, booked()]);
  assert.equal(points.find(point => point.appointmentId === installationId).status, "scheduled");
  assert.equal(points.find(point => point.appointmentId === id(8)).status, "overdue");
});

test("a partial booking keeps unbooked overdue units red and remains discoverable through the scheduled filter", () => {
  const point = pipeline([installation, booked({ maintenanceDeviceSelections: { [installationId]: selection(2) } })])[0];
  assert.equal(point.status, "overdue");
  assert.deepEqual(statuses(point), ["overdue", "scheduled"]);
  assert.equal(point.maintenanceDevices[0].scheduledMaintenanceDate, undefined);
  assert.equal(point.maintenanceDevices[1].scheduledMaintenanceDate, "2026-11-20");
  const visibility = { own: true, external: true };
  assert.equal(map.filterMaintenanceMapPoints([point], { visibility, status: "scheduled" }).length, 1);
  assert.equal(map.filterMaintenanceMapPoints([point], { visibility, status: "overdue" }).length, 1);
  assert.equal(map.filterMaintenanceMapPoints([point], { visibility, status: "ok" }).length, 0);
});

test("an unbooked due-soon unit remains amber beside a booked device", () => {
  const point = pipeline([{ ...installation, date: "2025-12-01" },
    booked({ maintenanceDeviceSelections: { [installationId]: selection(1) } })])[0];
  assert.equal(point.status, "dueSoon");
  assert.deepEqual(statuses(point), ["scheduled", "dueSoon"]);
});

test("separate bookings cover the actual physical devices and retain their own appointment dates", () => {
  const point = pipeline([installation,
    booked({ maintenanceDeviceSelections: { [installationId]: selection(1) } }),
    booked({ activeAppointmentId: id(9), date: "2026-11-21", time: "09:00", maintenanceDeviceSelections: { [installationId]: selection(2) } }),
  ])[0];
  assert.equal(point.status, "scheduled");
  assert.deepEqual(Array.from(point.maintenanceDevices, device => device.scheduledMaintenanceDate), ["2026-11-20", "2026-11-21"]);
  assert.equal(point.scheduledMaintenanceDate, "2026-11-20");
  assert.equal(point.maintenanceCount, 0);
});

test("empty, malformed and unknown device selections never imply a whole-installation booking", () => {
  for (const selected of [[], {}, [null], [{ productName: "", unitNumber: 1 }], selection(3), [...selection(1), ...selection(1)]]) {
    const point = pipeline([installation, booked({ maintenanceDeviceSelections: { [installationId]: selected } })])[0];
    assert.equal(point.status, "overdue", JSON.stringify(selected));
    assert.deepEqual(statuses(point), ["overdue", "overdue"]);
  }
  const legacy = pipeline([installation, booked({ maintenanceDeviceSelections: { [installationId]: null } })])[0];
  assert.equal(legacy.status, "scheduled");
});

test("stale pending visits do not override later completion; a later annual appointment does", () => {
  const completed = booked({ activeAppointmentId: id(10), date: "2026-11-15", status: "Lezárva" });
  for (const date of ["2026-11-14", "2026-11-15"]) {
    const point = pipeline([installation, completed, booked({ date })])[0];
    assert.equal(point.status, "ok");
    assert.equal(point.scheduledMaintenanceDate, undefined);
    assert.equal(point.maintenanceCount, 1);
  }
  const current = pipeline([installation, completed])[0];
  const annual = pipeline([installation, completed, booked({ date: "2027-11-15" })])[0];
  assert.equal(annual.status, "scheduled");
  assert.equal(annual.scheduledMaintenanceDate, "2027-11-15");
  assert.equal(history(annual), history(current));
});

test("completion is compared per device so an unfinished second unit keeps its booking", () => {
  const completed = booked({ activeAppointmentId: id(10), date: "2026-11-15", status: "Lezárva",
    maintenanceDeviceSelections: { [installationId]: selection(1) } });
  const point = pipeline([installation, completed, booked({ date: "2026-11-14" })])[0];
  assert.deepEqual(statuses(point), ["ok", "scheduled"]);
  assert.equal(point.status, "scheduled");
  assert.equal(point.maintenanceDevices[0].scheduledMaintenanceDate, undefined);
  assert.equal(point.maintenanceDevices[1].scheduledMaintenanceDate, "2026-11-14");
  assert.equal(point.maintenanceCount, 1);
});

test("whole and per-device refusals take priority over a conflicting scheduled visit", () => {
  const whole = pipeline([installation, booked()], { preferences: [preference({ choice: "declined" })] })[0];
  assert.equal(whole.status, "optOut");
  assert.deepEqual(statuses(whole), ["optOut", "optOut"]);
  assert.equal(whole.scheduledMaintenanceDate, undefined);
  const partial = pipeline([installation, booked()], { preferences: [preference({ declinedDevices: selection(2) })] })[0];
  assert.deepEqual(statuses(partial), ["scheduled", "optOut"]);
  assert.equal(partial.status, "scheduled");
  assert.equal(partial.maintenanceDevices[1].scheduledMaintenanceDate, undefined);
  const legacy = pipeline([{ ...installation, maintenanceOptOut: true }, booked()])[0];
  assert.equal(legacy.status, "optOut");
});

test("shared schedules mark the source installation without inflating completed service history", () => {
  const point = pipeline([installation], { schedules: [schedule()] })[0];
  assert.equal(point.status, "scheduled");
  assert.equal(history(point), history(pipeline()[0]));
  assert.deepEqual(statuses(point), ["scheduled", "scheduled"]);
});

test("shared source identity resolves both unaccepted and accepted installations through the final pipeline", () => {
  const unaccepted = pipeline([], { incoming: [received()], schedules: [schedule()] });
  assert.equal(unaccepted.length, 1);
  assert.equal(unaccepted[0].status, "scheduled");
  const mirrorId = id(11), mirrorCustomer = id(12);
  const local = { ...installation, id: mirrorCustomer, activeAppointmentId: mirrorId, maintenanceOrigin: "external" };
  const accepted = pipeline([local], { incoming: [received({ targetInstallationId: mirrorId, targetCustomerId: mirrorCustomer })],
    schedules: [schedule({ installationId: mirrorId })] });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].appointmentId, mirrorId);
  assert.equal(accepted[0].status, "scheduled");
  assert.equal(accepted[0].maintenanceCount, 0);
});

test("wrong shared provenance and malformed shared schedule rows cannot affect an unrelated installation", () => {
  const base = shared.sharedMaintenanceMapPoint(received());
  for (const patch of [{ sourceWorkspaceId: id(99) }, { sourceInstallationId: id(99) }, { maintenanceAppointmentId: "" },
    { date: "2026-02-30" }, { time: "25:00" }, { selectedDevices: [] }, { selectedDevices: [null] }]) {
    const point = applyScheduledMaintenance([base], [], [schedule(patch)])[0];
    assert.equal(point.status, "overdue", JSON.stringify(patch));
  }
});

test("partner completion makes stale partner schedules green without treating pending rows as history", () => {
  const result = { installationId, date: "2026-11-15", status: "Lezárva", providerName: "Teszt partner" };
  const point = pipeline([installation], { results: [result], schedules: [schedule({ date: "2026-11-14" })] })[0];
  assert.equal(point.status, "ok");
  assert.equal(point.maintenanceCount, 1);
  assert.equal(point.lastMaintenanceDate, "2026-11-15");
  assert.equal(point.scheduledMaintenanceDate, undefined);
});

test("duplicate local and shared views of the same booking do not duplicate history, devices or markers", () => {
  const once = pipeline([installation, booked()])[0];
  const duplicate = pipeline([installation, booked(), booked()], { schedules: [schedule(), schedule()] });
  assert.equal(duplicate.length, 1);
  assert.equal(duplicate[0].status, "scheduled");
  assert.equal(duplicate[0].maintenanceDevices.length, 2);
  assert.equal(history(duplicate[0]), history(once));
  assert.equal(duplicate[0].scheduledMaintenanceDate, once.scheduledMaintenanceDate);
});
