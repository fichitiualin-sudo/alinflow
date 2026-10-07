const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const plain = value => JSON.parse(JSON.stringify(value));
const { summarizeMapMarkers } = harness().load("src/lib/alinflow/map-marker-style.ts");
const segment = (key, count, color = "#22c55e") => ({ key, label: key, count, color });
const source = (id, patch = {}) => ({ id: String(id), latitude: 47 + Number(id) / 10000,
  longitude: 19, label: "1", title: `Helyszín ${id}`, segments: [segment("ok", 1)], ...patch });

function fixture({ zoom = 10, synchronousFit = false } = {}) {
  const markerInstances = [], clearedListeners = [], removedListeners = [], listeners = [], selected = [];
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.attributes = {}; this.value = ""; }
    set textContent(value) { this.value = value; this.children = []; }
    get textContent() { return this.value + this.children.map(child => child.textContent).join(""); }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const document = { createElement: tag => new Element(tag) };
  class Marker {
    constructor(options) {
      Object.assign(this, options); this.options = options;
      this.iconUpdates = []; this.mapUpdates = []; this.positionUpdates = []; this.events = new Map();
      markerInstances.push(this);
    }
    addListener(name, callback) { this.events.set(name, callback); return { marker: this, name }; }
    click() { this.events.get("click")?.(); }
    getPosition() { return this.position; }
    setPosition(position) { this.position = position; this.positionUpdates.push(position); }
    setIcon(icon) { this.icon = icon; this.iconUpdates.push(icon); }
    setTitle(title) { this.title = title; }
    setZIndex(zIndex) { this.zIndex = zIndex; }
    setMap(map) { this.map = map; this.mapUpdates.push(map); }
  }
  const emit = (target, name) => {
    for (const listener of [...listeners]) {
      if (listener.removed || listener.target !== target || listener.name !== name) continue;
      listener.removed = true; listener.callback();
    }
  };
  const maps = { Marker,
    LatLngBounds: class LatLngBounds { constructor() { this.positions = []; } extend(value) { this.positions.push(value); return this; } },
    event: {
      addListenerOnce(target, name, callback) { const listener = { target, name, callback, removed: false }; listeners.push(listener); return listener; },
      removeListener(listener) { listener.removed = true; removedListeners.push(listener); },
      clearInstanceListeners(marker) { marker.events.clear(); clearedListeners.push(marker); },
    },
  };
  const map = { zoom, fitCalls: [], centerCalls: [], zoomCalls: [],
    getZoom() { return this.zoom; }, setZoom(value) { this.zoom = value; this.zoomCalls.push(value); },
    setCenter(value) { this.centerCalls.push(value); },
    fitBounds(bounds, padding) { this.fitCalls.push({ bounds, padding }); if (synchronousFit) { this.zoom = 23; emit(this, "idle"); } },
  };
  const info = { openCalls: [], closeCalls: 0, content: null, position: null, isOpen: false,
    close() { this.closeCalls++; this.isOpen = false; }, setContent(content) { this.content = content; },
    setPosition(position) { this.position = position; }, open(options) { this.openCalls.push(options); this.isOpen = true; },
  };
  const callbacks = { itemLabel: "telepítés", onSelectMarker: id => selected.push(id), createPopupContent: id => {
    const item = document.createElement("p"); item.textContent = `Részletek ${id}`; return item;
  } };
  const { createMapMarkerLayer } = harness({ document }, {
    "./map-marker-style": { summarizeMapMarkers, markerPinIcon: (_maps, summary, selected) => ({ summary: plain(summary), selected }) },
  }).load("src/lib/alinflow/map-marker-layer.ts");
  const layer = createMapMarkerLayer({ maps, map, info, getCallbacks: () => callbacks });
  return { layer, markerInstances, maps, map, info, selected, callbacks, emit, listeners, removedListeners, clearedListeners };
}

function descend(element) { return element.children.flatMap(child => [child, ...descend(child)]); }

test("600 close locations stay attached individually at every zoom without reconstruction or refitting", () => {
  const f = fixture();
  const sources = Array.from({ length: 600 }, (_, index) => source(index));
  f.layer.update(sources); f.emit(f.map, "idle");
  const original = [...f.markerInstances];
  assert.equal(original.length, 600);
  assert.ok(original.every(marker => marker.options.optimized === true && marker.map === f.map));
  for (const zoom of [5, 7, 12, 16, 19]) {
    f.map.zoom = zoom; f.emit(f.map, "zoom_changed"); f.emit(f.map, "drag"); f.emit(f.map, "idle");
    f.layer.update(structuredClone(sources));
    assert.equal(f.markerInstances.length, 600);
    assert.ok(original.every(marker => marker.map === f.map && !marker.mapUpdates.length));
    assert.equal(f.map.fitCalls.length, 1);
    assert.equal(f.map.zoom, zoom);
  }
  assert.ok(original.every(marker => !marker.iconUpdates.length && !marker.positionUpdates.length));
});

test("selection only updates previous and next marker while preserving all other pins and viewport", () => {
  const f = fixture(), sources = Array.from({ length: 600 }, (_, index) => source(index));
  f.layer.update(sources); f.layer.update(structuredClone(sources), "20");
  assert.equal(f.markerInstances.filter(marker => marker.iconUpdates.length).length, 1);
  assert.equal(f.markerInstances[20].icon.selected, true);
  f.layer.update(sources, "21");
  assert.equal(f.markerInstances.filter(marker => marker.iconUpdates.length).length, 2);
  assert.equal(f.markerInstances[20].icon.selected, false);
  assert.equal(f.markerInstances[21].icon.selected, true);
  assert.equal(f.markerInstances[21].zIndex, 1001);
  assert.equal(f.markerInstances.length, 600); assert.equal(f.map.fitCalls.length, 1);
  assert.ok(f.markerInstances.every(marker => !marker.mapUpdates.length));
});

test("metadata and all weighted statuses update only the affected pin without changing geometry", () => {
  const f = fixture(), sources = [source(0, { segments: [segment("overdue", 2, "#ef4444"), segment("ok", 3)] }), source(1)];
  f.layer.update(sources);
  const next = structuredClone(sources); next[0].segments[0].count = 4; next[0].title = "Frissített helyszín";
  f.layer.update(next);
  assert.equal(f.markerInstances.length, 2); assert.equal(f.map.fitCalls.length, 1);
  assert.equal(f.markerInstances[0].icon.summary.count, 7);
  assert.deepEqual(f.markerInstances[0].icon.summary.segments.map(item => [item.key, item.count]), [["overdue", 4], ["ok", 3]]);
  assert.equal(f.markerInstances[0].title, "Frissített helyszín"); assert.equal(f.markerInstances[1].iconUpdates.length, 0);
  assert.ok(f.markerInstances.every(marker => !marker.mapUpdates.length && !marker.positionUpdates.length));
});

test("a changed coordinate moves the existing pin and retains its click listener", () => {
  const f = fixture(), sources = [source(0), source(1), source(2)]; f.layer.update(sources);
  const original = [...f.markerInstances], click = original[1].events.get("click");
  f.layer.update(sources.map(item => item.id === "1" ? { ...item, longitude: 20 } : item));
  assert.equal(f.markerInstances.length, 3);
  assert.deepEqual(plain(original[1].positionUpdates), [{ lat: sources[1].latitude, lng: 20 }]);
  assert.equal(original[0].positionUpdates.length, 0); assert.equal(original[2].positionUpdates.length, 0);
  assert.equal(original[1].events.get("click"), click); assert.equal(f.clearedListeners.length, 0);
  assert.ok(original.every(marker => marker.map === f.map && !marker.mapUpdates.length));
  assert.equal(f.map.fitCalls.length, 2);
});

test("removing or invalidating coordinates detaches affected pins and cleans listeners", () => {
  const f = fixture();
  f.layer.update([source(0), source(1), source(2, { latitude: NaN }), source(3, { longitude: Infinity }),
    source(4, { latitude: null }), source(5, { latitude: "47" })]);
  assert.equal(f.markerInstances.length, 2);
  const removed = f.markerInstances[1]; f.layer.update([source(0), source(1, { longitude: 181 })]);
  assert.equal(removed.map, null); assert.ok(f.clearedListeners.includes(removed)); assert.equal(removed.events.size, 0);
  assert.equal(f.markerInstances[0].map, f.map);
  f.layer.update([]);
  assert.ok(f.markerInstances.every(marker => marker.map === null));
  assert.deepEqual(plain(f.map.centerCalls.at(-1)), { lat: 47.2, lng: 19.5 }); assert.equal(f.map.zoom, 7);
});

test("fit includes valid boundary coordinates and caps synchronous fits before later user zoom", () => {
  const f = fixture({ synchronousFit: true });
  f.layer.update([source(0, { latitude: -90, longitude: -180 }), source(1, { latitude: 90, longitude: 180 })], "", 11);
  assert.equal(f.markerInstances.length, 2);
  assert.deepEqual(plain(f.map.fitCalls[0].bounds.positions), [{ lat: -90, lng: -180 }, { lat: 90, lng: 180 }]);
  assert.equal(f.map.zoom, 11); f.map.zoom = 19; f.emit(f.map, "idle"); assert.equal(f.map.zoom, 19);
});

test("a replacement fit cancels obsolete listeners and applies the current zoom limit", () => {
  const f = fixture(); f.layer.update([source(0)]);
  const initial = f.listeners[0]; f.layer.update([source(0)], "", 12);
  assert.ok(f.removedListeners.includes(initial)); f.map.zoom = 18; f.emit(f.map, "idle"); assert.equal(f.map.zoom, 12);
});

test("normal location popup preserves every same-site color/count and details without clustering controls", () => {
  const f = fixture();
  f.layer.update([source(0, { segments: [segment("overdue", 2, "#ef4444"), segment("dueSoon", 4, "#f59e0b"), segment("ok", 3)] }), source(1)]);
  f.markerInstances[0].click(); assert.deepEqual(f.selected, ["0"]);
  for (const text of [/9 telepítés/, /overdue: 2/, /dueSoon: 4/, /ok: 3/, /Részletek 0/]) assert.match(f.info.content.textContent, text);
  const dots = descend(f.info.content).filter(item => item.className === "alinflow-map-status-dot");
  assert.deepEqual(dots.map(item => item.style.backgroundColor), ["#ef4444", "#f59e0b", "#22c55e"]);
  assert.ok(dots.every(item => item.attributes["aria-hidden"] === "true"));
  assert.equal(descend(f.info.content).filter(item => item.tagName === "button").length, 0);
  assert.doesNotMatch(f.info.content.textContent, /Mutasd közelebbről|helyszín/);
  assert.equal(f.map.fitCalls.length, 1); assert.equal(f.info.position, f.markerInstances[0].position);
});

test("without custom details a normal popup shows that location title and current item label", () => {
  const f = fixture(); f.callbacks.createPopupContent = undefined; f.callbacks.itemLabel = "visszahívandó ügyfél";
  f.layer.update([source(0, { title: "Tesztváros", segments: [segment("callback", 3, "#0f766e")] })]);
  f.markerInstances[0].click();
  assert.match(f.info.content.textContent, /3 visszahívandó ügyfél/); assert.match(f.info.content.textContent, /Tesztváros/);
});

test("selection preserves popup; deselection or changed data closes stale details", () => {
  const f = fixture(), sources = [source(0), source(1)]; f.layer.update(sources); f.markerInstances[0].click();
  f.layer.update(structuredClone(sources), "0"); assert.equal(f.info.isOpen, true);
  f.layer.update(sources, "0"); assert.equal(f.info.isOpen, true);
  f.layer.update(sources, ""); assert.equal(f.info.isOpen, false);
  f.markerInstances[0].click(); f.layer.update(sources.map(item => ({ ...item, title: item.title + " frissítve" })), "0");
  assert.equal(f.info.isOpen, false);
});

test("clicks use latest callbacks and removed locations cannot open stale details", () => {
  const f = fixture(); f.layer.update([source(0), source(1)]);
  const staleClick = f.markerInstances[1].events.get("click"); f.layer.update([source(0)]); staleClick();
  assert.deepEqual(f.selected, []); assert.equal(f.info.isOpen, false);
  const next = []; f.callbacks.onSelectMarker = id => next.push(id); f.markerInstances[0].click(); assert.deepEqual(next, ["0"]);
});

test("disposal cancels fit, detaches every pin, closes popup, and safely ignores later work", () => {
  const f = fixture(); f.layer.update([source(0), source(1)]);
  const listener = f.listeners[0], staleClick = f.markerInstances[0].events.get("click"); f.layer.dispose();
  assert.ok(f.removedListeners.includes(listener));
  assert.ok(f.markerInstances.every(marker => marker.map === null && marker.events.size === 0)); assert.equal(f.info.isOpen, false);
  const closes = f.info.closeCalls; f.layer.dispose(); f.layer.update([source(2)]); staleClick();
  assert.equal(f.info.closeCalls, closes); assert.ok(f.markerInstances.every(marker => marker.mapUpdates.length === 1));
  assert.equal(f.markerInstances.length, 2); assert.deepEqual(f.selected, []);
});
