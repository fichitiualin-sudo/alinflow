const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { harness, noop } = require("./helpers.cjs");

const plain = value => JSON.parse(JSON.stringify(value));
function installation(extra = {}) {
  return { appointmentId: "installation-one", customerId: "customer-one", installationDate: "2025-01-01",
    status: "overdue", customer: { id: "customer-one", status: "Lezárva" }, ...extra };
}
function targets() {
  return harness().functions(["contactSmsTarget"], { todayIso: () => "2026-11-14" }).contactSmsTarget;
}

test("contact SMS selects exact installation scope, keeping accepted own work separate from unaccepted shared work", () => {
  const target = targets();
  assert.deepEqual(plain(target(installation())), { type: "own", customerId: "customer-one", installationId: "installation-one" });
  const shared = installation({ sharedMaintenance: { grantId: "grant-one", installationId: "source-one" },
    appointmentId: "shared:grant-one:source-one", customerId: "shared:grant-one:source-one" });
  assert.deepEqual(plain(target(shared)), { type: "shared", grantId: "grant-one", installationId: "source-one" });
  assert.deepEqual(plain(target(installation({ maintenanceOrigin: "external", maintenanceSourceName: "Source brand" }))),
    { type: "own", customerId: "customer-one", installationId: "installation-one" }, "accepted own installation uses its provider's own message");
});

test("unfinished, cancelled and future installations never offer maintenance outreach", () => {
  const target = targets();
  for (const status of ["Időpont foglalva", "Szerelés folyamatban", "Lemondva", "Visszahívandó"]) {
    assert.equal(target(installation({ customer: { status } })), null, status);
  }
  assert.equal(target(installation({ installationDate: "2026-11-15" })), null);
  assert.equal(target(installation({ installationDate: undefined })), null);
  assert.ok(target(installation({ customer: { status: "Szerelés kész – admin folyamatban" } })));
});

test("refusal and original-installer choice preserve current source/recipient boundaries", () => {
  const target = targets();
  assert.equal(target(installation({ status: "optOut" })), null);
  assert.equal(target(installation({ customer: { status: "Lezárva", maintenanceOptOut: true } })), null);
  assert.equal(target(installation({ maintenanceContactPreference: { choice: "declined", isSource: true } })), null);
  assert.equal(target(installation({ maintenanceContactPreference: { choice: "original_installer", isSource: false } })), null);
  assert.ok(target(installation({ maintenanceContactPreference: { choice: "original_installer", isSource: true } })));
});

test("current reopened preference takes precedence over a legacy refusal on the customer snapshot", () => {
  const target = targets();
  assert.ok(target(installation({ customer: { status: "Lezárva", maintenanceOptOut: true },
    maintenanceContactPreference: { choice: "open", isSource: true } })), "current open choice must restore the action");
});

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.attributes = {}; this.value = ""; }
  set textContent(value) { this.value = value; this.children = []; }
  get textContent() { return this.value + this.children.map(child => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = value; }
}
const document = { createElement: tag => new Element(tag) };
const descendants = node => [node, ...node.children.flatMap(descendants)];

test("SMS popup action composes separately from calling, opening work, routes and handoff acceptance", () => {
  const { createMapPopupActions } = harness({ document }).load("src/lib/alinflow/map-popup-actions.ts");
  let sms = 0, calls = 0, opens = 0;
  const actions = createMapPopupActions({ name: "Teszt Ügyfél", phone: "+36301234567", destination: "Tesztváros",
    onCall: () => calls++, onOpenCustomer: () => opens++, onContactSms: () => sms++ });
  const button = actions.children.find(node => node.textContent === "Nem vette fel – SMS");
  assert.equal(button.tagName, "button"); assert.equal(button.type, "button");
  assert.equal(button.attributes["aria-label"], "Nem vette fel – SMS: Teszt Ügyfél");
  button.onclick();
  assert.equal(sms, 1); assert.equal(calls, 0); assert.equal(opens, 0);
  assert.equal(actions.children.find(node => node.textContent === "Hívás").href, "tel:+36301234567");
  assert.match(actions.children.find(node => node.textContent === "Útvonal").href, /^https:\/\/www.google.com\/maps\//);
  const callbacks = createMapPopupActions({ name: "Teszt Ügyfél", phone: "", destination: "", onOpenCustomer: noop });
  assert.equal(callbacks.children.some(node => node.textContent === "Nem vette fel – SMS"), false);
});

function mapFixture() {
  const slots = []; let cursor = 0, tree;
  const GoogleMapCanvas = () => null;
  const { MaintenanceMapPanel } = harness({ document }, {
    react: { useId: () => "id", useState: initial => {
      const index = cursor++; slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, next => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
    }, useRef: initial => { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
      useMemo: callback => callback(), useCallback: callback => callback, useEffect: noop },
    "react/jsx-runtime": require("react/jsx-runtime"), "./GoogleMapCanvas": { GoogleMapCanvas },
  }).load("src/components/alinflow/MaintenanceMapPanel.tsx");
  const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
  return {
    render(props) { cursor = 0; tree = MaintenanceMapPanel(props); return nodes(tree).find(node => node.type === GoogleMapCanvas).props; },
    buttons() { return nodes(tree).filter(node => node.type === "button" && node.props.children === "Nem vette fel – SMS"); },
  };
}

function mapPoint() {
  const { buildMaintenanceMapPoints } = harness().load("src/lib/alinflow/maintenance-map.ts");
  return { ...buildMaintenanceMapPoints([{ id: "customer-one", activeAppointmentId: "installation-one", appointmentType: "installation", status: "Lezárva",
    name: "Teszt Ügyfél", phone: "+36301234567", date: "2025-01-01", mapLatitude: 47, mapLongitude: 19,
    quoteItems: [{ isManual: true, customName: "Teszt klíma", quantity: 1, productId: "manual" }] }])[0], latitude: 47, longitude: 19 };
}

test("existing map popup checks the latest point and current eligibility before opening SMS", () => {
  const point = mapPoint(), fixture = mapFixture(), chosen = [], opened = [], calls = [];
  const props = { points: [point], googleMapsApiKey: "", geocodingBusy: false, onOpenCustomer: item => opened.push(item),
    onCallCustomer: item => calls.push(item), onGeocodeMissing: noop, onToggleMaintenanceOptOut: noop,
    onContactSms: item => chosen.push(item), canContactSms: item => item.status !== "optOut" };
  const canvas = fixture.render(props), popup = canvas.createPopupContent(canvas.markers[0].id);
  const sms = descendants(popup).find(node => node.textContent === "Nem vette fel – SMS");
  sms.onclick(); assert.equal(chosen[0], point);
  const fresh = { ...point, customerName: "Frissített teszt ügyfél", sharedMaintenance: { grantId: "grant", installationId: "source" } };
  fixture.render({ ...props, points: [fresh] }); sms.onclick(); assert.equal(chosen[1], fresh);
  fixture.render({ ...props, points: [{ ...fresh, status: "optOut" }] }); sms.onclick(); assert.equal(chosen.length, 2);
  fixture.render({ ...props, points: [] }); sms.onclick(); assert.equal(chosen.length, 2);
  assert.equal(opened.length, 0); assert.equal(calls.length, 0);
});

test("map list shows only eligible SMS actions and never mutates the original installation", () => {
  const point = mapPoint(), fixture = mapFixture(), chosen = [];
  const before = plain(point);
  const props = { points: [point], googleMapsApiKey: "", geocodingBusy: false, onOpenCustomer: noop, onGeocodeMissing: noop, onToggleMaintenanceOptOut: noop,
    onContactSms: item => chosen.push(item), canContactSms: () => true };
  fixture.render(props);
  assert.equal(fixture.buttons().length, 1); fixture.buttons()[0].props.onClick();
  assert.equal(chosen[0], point); assert.deepEqual(plain(point), before);
  fixture.render({ ...props, canContactSms: () => false }); assert.equal(fixture.buttons().length, 0);
});

test("opening contact SMS requires the active user and workspace and performs no phone or work mutation", () => {
  for (const [workspace, user, expected] of [[{ id: "workspace" }, { id: "user" }, 1], [null, { id: "user" }, 0], [{ id: "workspace" }, null, 0]]) {
    const writes = [];
    const { openContactSms } = harness().functions(["openContactSms"], { activeWorkspace: workspace, user, contactSmsContextKey: "current-context",
      setContactSmsSelection: value => writes.push(plain(value)),
      recordCustomerPhoneCall: () => assert.fail("SMS is not a phone call"), startSharedMaintenance: () => assert.fail("SMS is not an order") });
    const target = { type: "shared", grantId: "grant", installationId: "source" };
    openContactSms(target); assert.equal(writes.length, expected);
    if (expected) { assert.equal(writes[0].workspaceId, "workspace"); assert.equal(writes[0].userId, "user"); assert.equal(writes[0].contextKey, "current-context"); assert.deepEqual(writes[0].target, target); }
  }
});

test("an open preview synchronously disappears when its workspace, user, context or eligible target changes", () => {
  const point = installation();
  const target = targets()(point);
  const selection = { workspaceId: "workspace", userId: "user", contextKey: "work:customer-one:installation-one", target };
  const context = { activeWorkspace: { id: "workspace" }, user: { id: "user" }, contactSmsContextKey: selection.contextKey,
    contactSmsSelection: selection, maintenanceMapPoints: [point], contactSmsTarget: targets(),
    MaintenanceContactSmsDialog: "sms-preview", setContactSmsSelection: noop };
  function render(extra = {}) {
    return harness({}, { "react/jsx-runtime": require("react/jsx-runtime") })
      .functions(["renderContactSmsDialog"], { ...context, ...extra }).renderContactSmsDialog();
  }
  assert.equal(render().type, "sms-preview");
  for (const extra of [
    { activeWorkspace: { id: "another-workspace" } },
    { user: { id: "another-user" } },
    { user: null },
    { contactSmsContextKey: "work:customer-one:installation-two" },
    { contactSmsContextKey: "work:customer-two:installation-one" },
    { contactSmsContextKey: "maintenanceMap:customer-one:installation-one" },
    { maintenanceMapPoints: [] },
    { maintenanceMapPoints: [installation({ status: "optOut" })] },
    { maintenanceMapPoints: [installation({ maintenanceContactPreference: { choice: "original_installer", isSource: false } })] },
  ]) assert.equal(render(extra), null, JSON.stringify(extra));
});

test("a removed shared grant or another installation never retains the previous recipient's preview", () => {
  const point = installation({ sharedMaintenance: { grantId: "grant-one", installationId: "source-one" } });
  const target = targets()(point);
  const context = { activeWorkspace: { id: "workspace" }, user: { id: "user" }, contactSmsContextKey: "shared-context",
    contactSmsSelection: { workspaceId: "workspace", userId: "user", contextKey: "shared-context", target },
    contactSmsTarget: targets(), MaintenanceContactSmsDialog: "sms-preview", setContactSmsSelection: noop };
  const render = points => harness({}, { "react/jsx-runtime": require("react/jsx-runtime") })
    .functions(["renderContactSmsDialog"], { ...context, maintenanceMapPoints: points }).renderContactSmsDialog();
  assert.equal(render([point]).type, "sms-preview");
  assert.equal(render([installation({ sharedMaintenance: { grantId: "grant-two", installationId: "source-one" } })]), null);
  assert.equal(render([installation({ sharedMaintenance: { grantId: "grant-one", installationId: "source-two" } })]), null);
  assert.equal(render([]), null);
});
