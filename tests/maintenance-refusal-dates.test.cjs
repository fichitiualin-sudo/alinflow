const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness, noop } = require("./helpers.cjs");
const h = harness({}, { react: React, "react/jsx-runtime": require("react/jsx-runtime"), "./GoogleMapCanvas": { GoogleMapCanvas: () => null } });
const choices = h.load("src/lib/alinflow/maintenance-contact-choice.ts");
const controls = h.load("src/components/alinflow/MaintenanceChoiceControls.tsx");
const map = h.load("src/lib/alinflow/maintenance-map.ts");
const selection = (...numbers) => numbers.map(unitNumber => ({ productName: "Minta klíma", unitNumber }));
const earlier = "2026-11-05T08:10:00.123456+00:00";
const later = "2026-11-06T12:34:00Z";
const legacy = "2025-12-04T17:30:00+00:00";
const preference = { installationId: "installation", sourceInstallationId: "installation", sourceWorkspaceId: "source",
  sourceWorkspaceName: "Source", choice: "open", updatedAt: "2026-11-07T11:00:00Z", isSource: true,
  declinedDevices: selection(2, 4), declinedAt: null,
  declinedDeviceDates: [{ ...selection(2)[0], declinedAt: earlier }, { ...selection(4)[0], declinedAt: later }] };
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test("refusal dates use Budapest winter/summer offsets and exact compact local formatting", () => {
  assert.equal(choices.formatMaintenanceRefusalDate(later), "2026.11.06. 13:34");
  assert.equal(choices.formatMaintenanceRefusalDate("2026-07-06T12:34:00Z"), "2026.07.06. 14:34");
  assert.equal(choices.formatMaintenanceRefusalDate("2026-07-06T22:34:00Z"), "2026.07.07. 00:34");
  assert.equal(choices.formatMaintenanceRefusalDate("2026-10-25T01:30:00Z"), "2026.10.25. 02:30");
  for (const value of [null, undefined, "", "invalid", "2026-11-06", "2026-11-06T12:34:00", "2026-99-99T25:30:00Z", "2026-02-30T12:30:00Z"]) {
    assert.equal(choices.formatMaintenanceRefusalDate(value), "");
  }
});

test("each checked device retains its own timestamp and unchecked devices expose none", () => {
  assert.equal(choices.maintenanceDeviceDeclinedAt(preference, selection(2)[0]), earlier);
  assert.equal(choices.maintenanceDeviceDeclinedAt(preference, { productName: " MINTA KLÍMA ", unitNumber: 4 }), later);
  assert.equal(choices.maintenanceDeviceDeclinedAt(preference, selection(1)[0]), undefined);
  assert.equal(choices.maintenanceDeviceDeclinedAt({ ...preference, declinedDevices: selection(4) }, selection(2)[0]), undefined);
  assert.equal(choices.maintenanceDeclinedAt(preference), undefined);
  assert.equal(choices.maintenanceDeviceDeclinedAt({ ...preference, isSource: false }, selection(2)[0]), earlier);
});

test("a last-device refusal does not invent dates for the earlier undated refusals", () => {
  const all = { ...preference, choice: "declined", declinedDevices: null, declinedAt: later,
    declinedDeviceDates: [{ ...selection(4)[0], declinedAt: later }] };
  assert.equal(choices.maintenanceDeclinedAt(all), later);
  assert.equal(choices.maintenanceDeviceDeclinedAt(all, selection(4)[0]), later);
  for (const device of selection(1, 2, 3)) assert.equal(choices.maintenanceDeviceDeclinedAt(all, device), undefined);
  assert.equal(choices.maintenanceDeviceDeclinedAt({ ...all, declinedDeviceDates: null }, selection(4)[0]), undefined);
});

test("old explicit preferences never borrow updatedAt or legacy dates; absent preferences can use recorded legacy refusal", () => {
  const old = { ...preference, choice: "declined", declinedDevices: null, declinedAt: undefined, declinedDeviceDates: undefined };
  assert.equal(choices.maintenanceDeclinedAt(old, true, legacy), undefined);
  assert.equal(choices.maintenanceDeviceDeclinedAt(old, selection(2)[0], true, legacy), undefined);
  assert.equal(choices.maintenanceDeclinedAt(undefined, true, legacy), legacy);
  assert.equal(choices.maintenanceDeviceDeclinedAt(undefined, selection(2)[0], true, legacy), legacy);
  assert.equal(choices.maintenanceDeclinedAt(undefined, false, legacy), undefined);
  assert.equal(choices.maintenanceDeviceDeclinedAt(undefined, selection(2)[0], false, legacy), undefined);
  assert.equal(choices.maintenanceDeclinedAt({ ...old, choice: "open", declinedAt: later }, true, legacy), undefined);
});

test("date DTO validation remains compatible with old responses and rejects malformed or duplicate dates", () => {
  assert.equal(choices.isMaintenanceContactPreference(preference), true);
  assert.equal(choices.isMaintenanceContactPreference({ ...preference, declinedAt: undefined, declinedDeviceDates: undefined }), true);
  assert.equal(choices.isMaintenanceContactPreference({ ...preference, declinedAt: null, declinedDeviceDates: null }), true);
  for (const patch of [{ declinedAt: "2026-11-06" }, { declinedAt: 0 }, { declinedDeviceDates: {} },
    { declinedDeviceDates: [null] }, { declinedDeviceDates: [{ ...selection(2)[0], declinedAt: "bad" }] },
    { declinedDeviceDates: [{ ...selection(2)[0], declinedAt: later, unrelated: true }] },
    { declinedDeviceDates: [{ ...selection(2)[0], declinedAt: earlier }, { productName: " MINTA KLÍMA ", unitNumber: 2, declinedAt: later }] }]) {
    assert.equal(choices.isMaintenanceContactPreference({ ...preference, ...patch }), false);
  }
});

test("the whole-refusal control shows a small date only when checked and known", () => {
  const props = { legacyOptOut: false, allowOriginalInstaller: true, onChange: noop, declinedAt: later };
  assert.match(render(controls.MaintenanceChoiceControls, { ...props, choice: "declined" }), /Megjelölve: 2026\.11\.06\. 13:34/);
  for (const choice of ["open", "original_installer"]) assert.doesNotMatch(render(controls.MaintenanceChoiceControls, { ...props, choice }), /Megjelölve:/);
  const unknown = render(controls.MaintenanceChoiceControls, { ...props, choice: "declined", declinedAt: null });
  assert.doesNotMatch(unknown, /Megjelölve:|mt-0\.5/);
});

const installation = { id: "customer", activeAppointmentId: "installation", appointmentType: "installation", status: "Lezárva",
  name: "Teszt", city: "", address: "", date: "2025-01-01",
  quoteItems: [{ productId: "manual", customName: "Minta klíma", isManual: true, quantity: 4 }] };
const { InstalledClimateMaintenanceCard } = h.functions(["workIdentity", "workDateTimeLabel", "workAddressLabel", "ClimateMaintenanceHistory", "InstalledClimateMaintenanceCard"],
  { ...choices, ...controls, ...map, ...h.load("src/lib/alinflow/maintenance-devices.ts"), ...h.load("src/lib/alinflow/products.ts"),
    ...h.load("src/lib/alinflow/format.ts"), ...h.load("src/lib/alinflow/constants.ts") }, "src/components/alinflow/WorkPagePanel.tsx");
const cardProps = { installation, works: [], onOpenWorkVersion: noop, onToggleMaintenanceOptOut: noop,
  onChangeMaintenancePreference: noop, onChangeMaintenanceDevicePreference: noop };
test("customer and map cards show two distinct per-device dates without using the later preference update", () => {
  const point = choices.applyMaintenanceContactPreferences(map.buildMaintenanceMapPoints([installation]), [preference])[0];
  const { MaintenanceMapPanel } = h.load("src/components/alinflow/MaintenanceMapPanel.tsx");
  for (const html of [render(InstalledClimateMaintenanceCard, { ...cardProps, maintenanceContactPreference: preference }),
    render(MaintenanceMapPanel, { points: [point], googleMapsApiKey: "", geocodingBusy: false, onOpenCustomer: noop,
      onGeocodeMissing: noop, onToggleMaintenanceOptOut: noop, onChangeMaintenancePreference: noop, onChangeMaintenanceDevicePreference: noop })]) {
    assert.equal((html.match(/Megjelölve:/g) || []).length, 2);
    assert.match(html, /Megjelölve: 2026\.11\.05\. 09:10/);
    assert.match(html, /Megjelölve: 2026\.11\.06\. 13:34/);
    assert.doesNotMatch(html, /2026\.11\.07\. 12:00/);
  }
});

test("single-unit customer card keeps known legacy date, hides unknown explicit date and clears date on reopening", () => {
  const single = { ...installation, quoteItems: [{ ...installation.quoteItems[0], quantity: 1 }], maintenanceOptOut: true, maintenanceOptOutAt: legacy };
  assert.match(render(InstalledClimateMaintenanceCard, { ...cardProps, installation: single }), /Megjelölve: 2025\.12\.04\. 18:30/);
  for (const pref of [{ ...preference, choice: "declined", declinedAt: null, declinedDeviceDates: null },
    { ...preference, choice: "open", declinedAt: later }]) {
    assert.doesNotMatch(render(InstalledClimateMaintenanceCard, { ...cardProps, installation: single, maintenanceContactPreference: pref }), /Megjelölve:/);
  }
});
