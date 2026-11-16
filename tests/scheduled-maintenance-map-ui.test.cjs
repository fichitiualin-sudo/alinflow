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

const elements = node => React.isValidElement(node)
  ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
const text = node => typeof node === "string" || typeof node === "number" ? String(node)
  : React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : "";
const plain = value => JSON.parse(JSON.stringify(value));

function panelFixture(points) {
  const slots = []; let cursor = 0;
  const GoogleMapCanvas = () => null;
  const api = harness({ document: { createElement: tag => new Element(tag) } }, {
    react: { useId: () => "map-search", useState: initial => {
      const index = cursor++; slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, next => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
    }, useRef: initial => { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useMemo: callback => callback(), useCallback: callback => callback, useEffect: noop },
    "react/jsx-runtime": require("react/jsx-runtime"), "./GoogleMapCanvas": { GoogleMapCanvas },
  }).load("src/components/alinflow/MaintenanceMapPanel.tsx");
  const props = { points, googleMapsApiKey: "", geocodingBusy: false, onOpenCustomer: noop,
    onGeocodeMissing: noop, onToggleMaintenanceOptOut: noop };
  return { render(nextPoints = points) {
    cursor = 0;
    const tree = api.MaintenanceMapPanel({ ...props, points: nextPoints });
    const nodes = elements(tree);
    return { tree, nodes, canvas: nodes.find(node => node.type === GoogleMapCanvas).props,
      button: label => nodes.find(node => node.type === "button" && text(node) === label),
      articles: nodes.filter(node => node.type === "article") };
  } };
}

function point(id, overrides = {}) {
  return { appointmentId: id, customerId: `customer-${id}`, customerName: `Synthetic ${id}`,
    customer: { id: `customer-${id}`, phone: "", quoteItems: [] }, climateSummary: "Test AC", address: "Test Street 1",
    city: "Test City", installationDate: "2025-01-01", installationLabel: "Test installation",
    lastMaintenanceDate: "2025-02-01", nextMaintenanceDue: "2026-02-01", maintenanceCount: 1,
    maintenanceOrigin: "own", status: "overdue", latitude: 47, longitude: 19, ...overrides };
}
const booked = (unitNumber = 1, date = "2026-11-18", time = "10:30") => ({ productName: "Test AC", unitNumber,
  status: "scheduled", maintenanceCount: 1, lastMaintenanceDate: "2025-02-01", nextMaintenanceDue: "2026-02-01",
  scheduledMaintenanceDate: date, scheduledMaintenanceTime: time });
const pendingPoint = (id, overrides = {}) => point(id, { status: "scheduled", scheduledMaintenanceDate: "2026-11-18",
  scheduledMaintenanceTime: "10:30", maintenanceDevices: [booked()], ...overrides });

test("purple filter counts partial bookings and follows the current search and origin toggles", () => {
  const partial = pendingPoint("partial", { status: "overdue", maintenanceDevices: [booked(), { ...booked(2),
    status: "overdue", scheduledMaintenanceDate: undefined, scheduledMaintenanceTime: undefined }] });
  const fixture = panelFixture([pendingPoint("own"), pendingPoint("external", { maintenanceOrigin: "external" }), partial,
    point("done", { status: "ok" })]);
  let view = fixture.render();
  assert.ok(view.button("Egyeztetve (3)"));
  const dot = elements(view.button("Egyeztetve (3)")).find(node => node.type === "span");
  assert.equal(dot.props.style.backgroundColor, "#8b5cf6");
  view.button("Egyeztetve (3)").props.onClick();
  view = fixture.render();
  assert.equal(view.button("Egyeztetve (3)").props["aria-pressed"], true);
  assert.equal(view.articles.length, 3);
  assert.ok(view.articles.some(article => text(article).includes("Synthetic partial")));
  const externalLabel = view.nodes.find(node => node.type === "label" && text(node) === "Karbantartásra átvett");
  elements(externalLabel).find(node => node.type === "input").props.onChange({ target: { checked: false } });
  view = fixture.render();
  assert.ok(view.button("Egyeztetve (2)"));
  assert.equal(view.articles.length, 2);
  view.nodes.find(node => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "partial" } });
  view = fixture.render();
  assert.ok(view.button("Egyeztetve (1)"));
  assert.equal(view.articles.length, 1);
});

test("coincident marker retains purple, red and green segments without counting booked devices as extra installations", () => {
  const partial = pendingPoint("partial", { status: "overdue", maintenanceDevices: [booked(), { ...booked(2),
    status: "overdue", scheduledMaintenanceDate: undefined, scheduledMaintenanceTime: undefined }] });
  const view = panelFixture([pendingPoint("scheduled"), partial, point("done", { status: "ok" })]).render();
  assert.equal(view.canvas.markers.length, 1);
  assert.equal(view.canvas.markers[0].label, "3");
  assert.deepEqual(plain(view.canvas.markers[0].segments.map(({ key, color, count }) => ({ key, color, count }))), [
    { key: "overdue", color: "#ef4444", count: 1 }, { key: "scheduled", color: "#8b5cf6", count: 1 },
    { key: "ok", color: "#22c55e", count: 1 },
  ]);
});

test("list and popup show agreed dates and individual device bookings while preserving completed history", () => {
  const p = pendingPoint("multi", { maintenanceDevices: [booked(), booked(2, "2026-11-19", "14:00")] });
  const fixture = panelFixture([p]);
  const view = fixture.render();
  const card = text(view.articles[0]);
  assert.match(card, /Egyeztetett karbantartás: 2026\.11\.18 · 10:30/);
  assert.match(card, /2\. készülékEgyeztetveEgyeztetett karbantartás: 2026\.11\.19 · 14:00/);
  assert.match(card, /Utolsó karbantartás: 2025\.02\.01/);
  assert.match(card, /Karbantartások száma: 1/);
  const popup = view.canvas.createPopupContent(view.canvas.markers[0].id).textContent;
  assert.match(popup, /Egyeztetett karbantartás: 2026\.11\.18 · 10:30/);
  assert.match(popup, /Egyeztetve: Test AC · 2\. készülék · 2026\.11\.19 · 14:00/);
  const completed = fixture.render([point("multi", { status: "ok", lastMaintenanceDate: "2026-11-19", maintenanceCount: 2 })]);
  assert.ok(completed.button("Egyeztetve (0)"));
  assert.doesNotMatch(text(completed.articles[0]), /Egyeztetett karbantartás/);
  assert.doesNotMatch(completed.canvas.createPopupContent(completed.canvas.markers[0].id).textContent, /Egyeztetett karbantartás/);
  assert.equal(completed.canvas.markers[0].segments[0].color, "#22c55e");
});

test("date-only appointment is displayed without an invented time", () => {
  const view = panelFixture([pendingPoint("date-only", { scheduledMaintenanceTime: undefined,
    maintenanceDevices: [{ ...booked(), scheduledMaintenanceTime: undefined }] })]).render();
  const scheduledLine = elements(view.articles[0]).find(node => node.type === "p" && text(node).startsWith("Egyeztetett karbantartás:"));
  assert.equal(text(scheduledLine), "Egyeztetett karbantartás: 2026.11.18");
});
