const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness, noop } = require("./helpers.cjs");
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ["2026-11-06T12:00:00Z"])); } }
const h = harness({ Date: FixedDate }, { react: React, "react/jsx-runtime": require("react/jsx-runtime"),
  "./GoogleMapCanvas": { GoogleMapCanvas: () => null } });
const choices = h.load("src/lib/alinflow/maintenance-contact-choice.ts");
const map = h.load("src/lib/alinflow/maintenance-map.ts");
const shared = h.load("src/lib/alinflow/shared-maintenance.ts");
const devices = h.load("src/lib/alinflow/maintenance-devices.ts");
const selection = (...numbers) => numbers.map(unitNumber => ({ productName: "Minta klíma", unitNumber }));
const installation = { id: "customer", activeAppointmentId: "installation", appointmentType: "installation", status: "Lezárva",
  name: "Teszt", city: "", address: "", date: "2025-01-01",
  quoteItems: [{ productId: "manual", customName: "Minta klíma", isManual: true, quantity: 4 }] };
const visit = { ...installation, activeAppointmentId: "visit", appointmentType: "maintenance", date: "2026-11-01",
  maintenanceInstallationIds: ["installation"], maintenanceDeviceSelections: { installation: selection(1) } };
const original = map.buildMaintenanceMapPoints([installation, visit])[0];
const preference = { installationId: "installation", sourceInstallationId: "installation", sourceWorkspaceId: "source",
  sourceWorkspaceName: "Source", choice: "open", updatedAt: "2026-11-06T11:00:00Z", isSource: true,
  declinedDevices: selection(2, 3, 4) };
const apply = (pref, point = original) => choices.applyMaintenanceContactPreferences([point], pref ? [pref] : [])[0];
const statuses = point => Array.from(point.maintenanceDevices, device => device.status);
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test("one serviced and three individually declined devices keep one current installation without false maintenance", () => {
  const before = JSON.stringify(original);
  const result = apply(preference);
  assert.equal(result.status, "ok");
  assert.equal(result.nextMaintenanceDue, "2027-11-01");
  assert.deepEqual(statuses(result), ["ok", "optOut", "optOut", "optOut"]);
  assert.deepEqual(Array.from(result.maintenanceDevices, device => device.maintenanceCount), [1, 0, 0, 0]);
  assert.equal(result.maintenanceCount, 1);
  assert.match(map.maintenanceDeviceSummary(result.maintenanceDevices), /Rendben: 1 \/ 4 klíma · Nem kéri: 3/);
  assert.equal(JSON.stringify(original), before);
});

test("reopening one declined unit immediately restores its existing due date while the other two stay declined", () => {
  const result = apply({ ...preference, declinedDevices: selection(3, 4) }, apply(preference));
  assert.equal(result.status, "overdue");
  assert.equal(result.nextMaintenanceDue, "2026-01-01");
  assert.deepEqual(statuses(result), ["ok", "overdue", "optOut", "optOut"]);
  assert.equal(result.maintenanceDevices[1].lastMaintenanceDate, undefined);
});

test("explicit open does not erase partial maintenance and legacy full refusal remains reversible per unit", () => {
  const open = apply({ ...preference, declinedDevices: null });
  assert.equal(open.status, "overdue");
  assert.equal(open.nextMaintenanceDue, "2026-01-01", "latest visit must not turn all four green");
  const legacy = { ...original, status: "optOut", customer: { ...installation, maintenanceOptOut: true } };
  assert.deepEqual(statuses(apply(undefined, legacy)), Array(4).fill("optOut"));
  assert.deepEqual(statuses(apply(preference, legacy)), ["ok", "optOut", "optOut", "optOut"]);
  const all = apply({ ...preference, choice: "declined", declinedDevices: null });
  assert.equal(all.status, "optOut");
  assert.deepEqual(statuses(all), Array(4).fill("optOut"));
  assert.equal(all.maintenanceDevices[0].lastMaintenanceDate, "2026-11-01");
});

test("source, delegated coordination and accepted mirror resolve the same per-device choices", () => {
  const item = { grantId: "grant", installationId: "installation", sourceWorkspaceId: "source", sourceWorkspaceName: "Source",
    customer: { name: "Teszt", phone: "", email: "", postalCode: "", city: "", address: "" },
    installationDate: installation.date, climates: [{ productName: "Minta klíma", quantity: 4 }],
    lastMaintenanceDate: visit.date, maintenanceCount: 1,
    maintenanceHistory: [{ date: visit.date, status: "Lezárva", selectedDevices: selection(1) }] };
  const recipient = shared.sharedMaintenanceMapPoint(item);
  const mirrored = shared.mergeSharedMaintenancePoints([{ ...original, appointmentId: "mirror", customerId: "recipient",
    customer: { ...installation, id: "recipient", activeAppointmentId: "mirror" } }], [{ ...item, targetInstallationId: "mirror" }])[0];
  for (const point of [recipient, mirrored]) {
    const result = apply({ ...preference, installationId: "mirror", isSource: false }, point);
    assert.deepEqual(statuses(result), statuses(apply(preference)));
    assert.equal(result.status, "ok");
  }
  const wrongSource = apply({ ...preference, sourceWorkspaceId: "unrelated", isSource: false }, recipient);
  assert.equal(wrongSource.status, "overdue");
});

test("device-choice validation rejects malformed and repeated identities while preserving old nullable DTOs", () => {
  for (const declinedDevices of [undefined, null, [], selection(1), [{ productName: "  MINTA KLÍMA  ", unitNumber: 1 }]]) {
    assert.equal(choices.isMaintenanceContactPreference({ ...preference, declinedDevices }), true);
  }
  for (const declinedDevices of [{}, [null], [{ productName: "", unitNumber: 1 }], [{ productName: "Minta klíma", unitNumber: 0 }],
    [{ productName: "Minta klíma", unitNumber: 1.5 }], [{ productName: "Minta klíma", unitNumber: 1, extra: true }],
    [{ productName: "a".repeat(301), unitNumber: 1 }], [...selection(1), { productName: "  MINTA KLÍMA  ", unitNumber: 1 }]]) {
    assert.equal(choices.isMaintenanceContactPreference({ ...preference, declinedDevices }), false);
  }
  assert.deepEqual(Array.from(choices.declinedMaintenanceDevices(installation.quoteItems, preference), d => d.unitNumber), [2, 3, 4]);
  assert.equal(choices.preferenceDeclinesDevice({ ...preference, declinedDevices: selection(1) }, { productName: " MINTA KLÍMA ", unitNumber: 1 }), true);
  assert.equal(choices.declinedMaintenanceDevices(installation.quoteItems, undefined, true).length, 4);
});

const { MaintenanceChoiceControls } = h.load("src/components/alinflow/MaintenanceChoiceControls.tsx");
const { InstalledClimateMaintenanceCard } = h.functions(["workIdentity", "workDateTimeLabel", "workAddressLabel", "ClimateMaintenanceHistory", "InstalledClimateMaintenanceCard"],
  { ...devices, ...map, ...choices, ...h.load("src/lib/alinflow/products.ts"), ...h.load("src/lib/alinflow/format.ts"),
    ...h.load("src/lib/alinflow/constants.ts"), ...h.load("src/components/alinflow/MaintenanceChoiceControls.tsx") }, "src/components/alinflow/WorkPagePanel.tsx");
function allInputs(node) {
  if (!React.isValidElement(node)) return [];
  return [...(node.type === "input" ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(allInputs)];
}
test("customer card has exactly one refusal checkbox per unit and sends only the changed physical unit", () => {
  const calls = [];
  const props = { installation, works: [visit], onOpenWorkVersion: noop, onToggleMaintenanceOptOut: noop,
    onChangeMaintenancePreference: () => { throw Error("Whole refusal must not be used"); },
    onChangeMaintenanceDevicePreference: (...args) => calls.push(args), maintenanceContactPreference: preference };
  const inputs = allInputs(InstalledClimateMaintenanceCard(props));
  assert.equal(inputs.length, 4);
  assert.deepEqual(inputs.map(input => input.props.checked), [false, true, true, true]);
  inputs[2].props.onChange({ target: { checked: false } });
  assert.equal(calls[0][0], installation);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), selection(3)[0]);
  assert.equal(calls[0][2], false);
  const html = render(InstalledClimateMaintenanceCard, { ...props, maintenancePreferenceBusy: true });
  assert.equal((html.match(/disabled=""/g) || []).length, 4);
  assert.equal((html.match(/Utolsó karbantartás: nincs adat/g) || []).length, 3);
  assert.doesNotMatch(html, /aria-label="Karbantartási választás"/);
});

test("map card shows the same four independent checkboxes and no competing installation-wide refusal", () => {
  const { MaintenanceMapPanel } = h.load("src/components/alinflow/MaintenanceMapPanel.tsx");
  const point = apply(preference);
  const html = render(MaintenanceMapPanel, { points: [point], googleMapsApiKey: "", geocodingBusy: false,
    onOpenCustomer: noop, onGeocodeMissing: noop, onToggleMaintenanceOptOut: noop, onChangeMaintenancePreference: noop,
    onChangeMaintenanceDevicePreference: noop, maintenanceOptOutBusyIds: [point.appointmentId] });
  const controls = html.match(/<input[^>]*aria-label="Nem kéri a karbantartást:[^>]*>/g) || [];
  assert.equal(controls.length, 4);
  assert.equal(controls.filter(input => input.includes('checked=""')).length, 3);
  assert.equal(controls.filter(input => input.includes('disabled=""')).length, 4);
  assert.match(html, /Rendben: 1 \/ 4 klíma · Nem kéri: 3/);
  assert.doesNotMatch(html, /aria-label="Karbantartási választás"/);
});

function client(response = preference) {
  const calls = [], state = { response, error: null };
  const api = harness({}, { "@/lib/supabase": { supabase: { rpc: async (name, args) => {
    calls.push({ name, args }); return { data: state.response, error: state.error };
  } } } }).load("src/lib/alinflow/shared-maintenance-client.ts");
  return { api, calls, state };
}
test("per-unit client sends an OCC-checked intent and validates acknowledged device state and provenance", async () => {
  const c = client();
  const saved = await c.api.setMaintenanceDevicePreference("source", "installation", selection(3)[0], true, preference.updatedAt);
  assert.equal(saved, preference);
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls[0])), { name: "set_maintenance_device_preference", args: {
    p_workspace_id: "source", p_installation_id: "installation", p_device: selection(3)[0], p_declined: true,
    p_expected_updated_at: preference.updatedAt, p_grant_id: null } });
  c.state.response = { ...preference, installationId: "mirror", isSource: false };
  await c.api.setMaintenanceDevicePreference("recipient", "installation", selection(2)[0], true, preference.updatedAt, "grant");
  assert.equal(c.calls[1].args.p_grant_id, "grant");
  for (const response of [{ ...preference, declinedDevices: undefined }, { ...preference, declinedDevices: null },
    { ...preference, sourceInstallationId: "other", isSource: false }, { ...preference, isSource: false, declinedDevices: selection(1) }]) {
    c.state.response = response;
    await assert.rejects(c.api.setMaintenanceDevicePreference("recipient", "installation", selection(2)[0], true, preference.updatedAt, "grant"), /nem igazolható/);
  }
  c.state.error = { code: "40001", message: "conflict" };
  await assert.rejects(c.api.setMaintenanceDevicePreference("source", "installation", selection(2)[0], true, preference.updatedAt), /közben megváltozott/);
});
