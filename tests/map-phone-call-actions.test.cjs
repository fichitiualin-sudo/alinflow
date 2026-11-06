const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { harness, noop } = require("./helpers.cjs");

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
test("popup call keeps native tel navigation, records only the call and leaves customer/route actions separate", () => {
  const { createMapPopupActions } = harness({ document }).load("src/lib/alinflow/map-popup-actions.ts");
  let calls = 0, opens = 0, prevented = false;
  const actions = createMapPopupActions({ name: "Customer", phone: "+36 30 123 4567", destination: "Budapest",
    onCall: () => { calls++; }, onOpenCustomer: () => { opens++; } });
  const call = actions.children.find(node => node.textContent === "Hívás");
  assert.equal(call.tagName, "a"); assert.match(call.href, /^tel:/);
  assert.equal(call.onclick({ preventDefault() { prevented = true; } }), undefined);
  assert.equal(calls, 1); assert.equal(opens, 0); assert.equal(prevented, false);
  const route = actions.children.find(node => node.textContent === "Útvonal");
  assert.equal(route.target, "_blank"); assert.equal(route.onclick, undefined);
  actions.children.find(node => node.tagName === "button").onclick();
  assert.equal(opens, 1); assert.equal(calls, 1);
  const missing = createMapPopupActions({ name: "Missing", phone: "", destination: "", onCall: () => { calls++; }, onOpenCustomer: noop });
  assert.equal(missing.children.some(node => node.textContent === "Hívás"), false);
});

function mapFixture(file, componentName) {
  const slots = []; let cursor = 0;
  const GoogleMapCanvas = () => null;
  const api = harness({ document }, {
    react: { useId: () => "id", useState: initial => {
      const index = cursor++; slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, next => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
    }, useRef: initial => { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
      useMemo: callback => callback(), useCallback: callback => callback, useEffect: noop },
    "react/jsx-runtime": require("react/jsx-runtime"), "./GoogleMapCanvas": { GoogleMapCanvas },
  }).load(file);
  const findCanvas = node => React.isValidElement(node) ? node.type === GoogleMapCanvas ? node
    : React.Children.toArray(node.props.children).map(findCanvas).find(Boolean) : undefined;
  return { render(props) { cursor = 0; return findCanvas(api[componentName](props)).props; } };
}
test("maintenance popup logs against the latest actual/shared point without opening work or accepting a handoff", () => {
  const h = harness(); const { buildMaintenanceMapPoints } = h.load("src/lib/alinflow/maintenance-map.ts");
  const installation = { id: "customer", activeAppointmentId: "installation", appointmentType: "installation", status: "Lezárva", name: "Customer",
    phone: "+36301234567", date: "2025-01-01", mapLatitude: 47, mapLongitude: 19,
    quoteItems: [{ isManual: true, customName: "AC", quantity: 1, productId: "manual" }] };
  const point = { ...buildMaintenanceMapPoints([installation])[0], latitude: 47, longitude: 19 };
  const f = mapFixture("src/components/alinflow/MaintenanceMapPanel.tsx", "MaintenanceMapPanel");
  const calls = [], opened = [], sharedOpened = [];
  const props = { points: [point], googleMapsApiKey: "", geocodingBusy: false, onOpenCustomer: item => opened.push(item),
    onOpenShared: item => sharedOpened.push(item), onCallCustomer: item => calls.push(item), onGeocodeMissing: noop, onToggleMaintenanceOptOut: noop };
  const canvas = f.render(props);
  const popup = canvas.createPopupContent(canvas.markers[0].id);
  const call = descendants(popup).find(node => node.textContent === "Hívás");
  call.onclick(); assert.equal(calls[0], point); assert.equal(opened.length, 0); assert.equal(sharedOpened.length, 0);
  const updated = { ...point, customerName: "Updated", sharedMaintenance: { grantId: "grant", installationId: "source" } };
  f.render({ ...props, points: [updated] }); call.onclick(); assert.equal(calls[1], updated);
  assert.equal(opened.length, 0); assert.equal(sharedOpened.length, 0);
  f.render({ ...props, points: [] }); call.onclick(); assert.equal(calls.length, 2, "a removed/revoked point cannot be logged through old popup content");
});

test("callback popup records the latest customer while leaving native tel navigation and selection unchanged", () => {
  const f = mapFixture("src/components/alinflow/CallbackMapPanel.tsx", "CallbackMapPanel");
  const customer = { id: "customer", name: "Customer", city: "Tápiószele", postalCode: "2766", phone: "+36301234567",
    status: "Visszahívandó", quoteItems: [], source: "Facebook" };
  const calls = [], opened = [];
  const props = { customers: [customer], googleMapsApiKey: "", onOpenCustomer: item => opened.push(item), onDeleteCustomer: async () => true,
    onCallCustomer: item => calls.push(item) };
  const canvas = f.render(props); const popup = canvas.createPopupContent(canvas.markers[0].id);
  const call = descendants(popup).find(node => node.textContent === "Hívás");
  assert.match(call.href, /^tel:/); call.onclick(); assert.equal(calls[0], customer); assert.equal(opened.length, 0);
  const updated = { ...customer, name: "Updated" };
  f.render({ ...props, customers: [updated] }); call.onclick(); assert.equal(calls[1], updated);
  f.render({ ...props, customers: [] }); call.onclick(); assert.equal(calls.length, 2);
});
