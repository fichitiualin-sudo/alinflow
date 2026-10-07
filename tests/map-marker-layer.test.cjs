const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const plain = value => JSON.parse(JSON.stringify(value));
const { summarizeMapMarkers } = harness().load("src/lib/alinflow/map-marker-style.ts");
const segment = (key, count, color = "#22c55e") => ({ key, label: key, count, color });
const source = (id, patch = {}) => ({ id: String(id), latitude: 47 + Number(id) / 10000,
  longitude: 19, label: "1", title: `Helyszín ${id}`, segments: [segment("ok", 1)], ...patch });

function fixture({ zoom = 10, hasBounds = true, synchronousFit = false } = {}) {
  const markerInstances = [];
  const clearedListeners = [];
  const removedListeners = [];
  const listeners = [];
  const clusterers = [];
  const algorithms = [];
  const selected = [];
  const document = { activeElement: null, createElement: tag => new Element(tag) };
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.attributes = {}; this.value = ""; }
    set textContent(value) { this.value = value; this.children = []; }
    get textContent() { return this.value + this.children.map(child => child.textContent).join(""); }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.value = ""; this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    querySelector(selector) { return descend(this).find(item => item.tagName === selector) || null; }
    focus() { document.activeElement = this; }
  }
  class Marker {
    constructor(options) {
      this.options = options; this.position = options.position; this.icon = options.icon;
      this.title = options.title; this.zIndex = options.zIndex; this.map = options.map;
      this.iconUpdates = []; this.mapUpdates = []; this.events = new Map();
      markerInstances.push(this);
    }
    addListener(name, callback) { this.events.set(name, callback); return { marker: this, name }; }
    click() { this.events.get("click")?.(); }
    getPosition() { return this.position; }
    setIcon(icon) { this.icon = icon; this.iconUpdates.push(icon); }
    setTitle(title) { this.title = title; }
    setZIndex(zIndex) { this.zIndex = zIndex; }
    setMap(map) { this.map = map; this.mapUpdates.push(map); }
  }
  const emit = (target, name) => {
    for (const listener of [...listeners]) {
      if (listener.removed || listener.target !== target || listener.name !== name) continue;
      listener.removed = true;
      listener.callback();
    }
  };
  const maps = {
    Marker,
    LatLngBounds: class LatLngBounds { constructor() { this.positions = []; } extend(value) { this.positions.push(value); return this; } },
    event: {
      addListenerOnce(target, name, callback) { const listener = { target, name, callback, removed: false }; listeners.push(listener); return listener; },
      removeListener(listener) { listener.removed = true; removedListeners.push(listener); },
      clearInstanceListeners(marker) { marker.events.clear(); clearedListeners.push(marker); },
    },
  };
  const map = {
    zoom, hasBounds, fitCalls: [], centerCalls: [], zoomCalls: [],
    getZoom() { return this.zoom; },
    setZoom(value) { this.zoom = value; this.zoomCalls.push(value); },
    getBounds() { return this.hasBounds ? {} : undefined; },
    setCenter(value) { this.centerCalls.push(value); },
    fitBounds(bounds, padding) { this.fitCalls.push({ bounds, padding }); if (synchronousFit) { this.zoom = 23; emit(this, "idle"); } },
  };
  const info = {
    openCalls: [], closeCalls: 0, content: null, position: null, isOpen: false,
    close() { this.closeCalls++; this.isOpen = false; },
    setContent(content) { this.content = content; },
    setPosition(position) { this.position = position; },
    open(options) { this.openCalls.push(options); this.isOpen = true; },
  };
  class MarkerClusterer {
    constructor(options) { this.options = options; this.markers = []; this.clusters = []; this.renderCalls = 0; this.mapUpdates = []; this.removals = []; this.clearCalls = 0; clusterers.push(this); }
    getMap() { return this.map; }
    setMap(map) { this.map = map; this.mapUpdates.push(map); if (map) this.render(); }
    addMarker(marker, noDraw) { assert.equal(noDraw, true); this.markers.push(marker); }
    removeMarker(marker, noDraw) { assert.equal(noDraw, true); this.markers = this.markers.filter(item => item !== marker); this.removals.push(marker); }
    render() { this.renderCalls++; }
    clearMarkers(noDraw) { assert.equal(noDraw, true); this.markers = []; this.clearCalls++; }
  }
  class SuperClusterViewportAlgorithm { constructor(options) { this.options = options; algorithms.push(this); } }
  const callbacks = { itemLabel: "telepítés", onSelectMarker: id => selected.push(id), createPopupContent: id => {
    const item = document.createElement("p"); item.textContent = `Részletek ${id}`; return item;
  } };
  const { createMapMarkerLayer } = harness({ document }, {
    "@googlemaps/markerclusterer": { MarkerClusterer, SuperClusterViewportAlgorithm },
    "./map-marker-style": { summarizeMapMarkers, markerDotIcon: (_maps, summary, selected, cluster = false) => ({ summary: plain(summary), selected, cluster }) },
  }).load("src/lib/alinflow/map-marker-layer.ts");
  const layer = createMapMarkerLayer({ maps, map, info, getCallbacks: () => callbacks });
  const clusterer = clusterers[0];
  const addCluster = (indices = clusterer.markers.map((_, index) => index)) => {
    const cluster = { markers: indices.map(index => clusterer.markers[index]), position: { lat: 47, lng: 19 } };
    cluster.marker = clusterer.options.renderer.render(cluster);
    clusterer.clusters.push(cluster);
    return cluster;
  };
  return { layer, document, markerInstances, maps, map, info, clusterer, algorithms,
    selected, callbacks, addCluster, emit, listeners, removedListeners, clearedListeners };
}

function descend(element) { return element.children.flatMap(child => [child, ...descend(child)]); }
function button(root, label) { return descend(root).find(item => item.tagName === "button" && item.textContent === label); }

test("600 unchanged locations reuse every marker and preserve viewport; selection only restyles old and new", () => {
  const f = fixture();
  const sources = Array.from({ length: 600 }, (_, index) => source(index));
  f.layer.update(sources);
  const original = [...f.clusterer.markers];
  assert.equal(original.length, 600);
  assert.equal(f.map.fitCalls.length, 1);
  assert.equal(f.clusterer.renderCalls, 1);
  assert.ok(original.every(marker => marker.options.optimized === true));
  f.layer.update(structuredClone(sources));
  assert.equal(f.markerInstances.length, 600);
  assert.deepEqual(f.clusterer.markers, original);
  assert.equal(f.map.fitCalls.length, 1);
  assert.equal(f.clusterer.renderCalls, 1);
  f.layer.update(structuredClone(sources), "20");
  assert.equal(original.filter(marker => marker.iconUpdates.length).length, 1);
  assert.equal(original[20].icon.selected, true);
  f.layer.update(sources, "21");
  assert.equal(original.filter(marker => marker.iconUpdates.length).length, 2);
  assert.equal(original[20].icon.selected, false);
  assert.equal(original[21].icon.selected, true);
  assert.equal(f.markerInstances.length, 600);
  assert.equal(f.map.fitCalls.length, 1);
});

test("metadata and weighted status changes refresh the active cluster without reclustering or fitting", () => {
  const f = fixture();
  const sources = [source(0, { segments: [segment("overdue", 2, "#ef4444"), segment("ok", 3)] }), source(1)];
  f.layer.update(sources);
  const cluster = f.addCluster();
  assert.equal(cluster.marker.icon.summary.count, 6);
  const instances = f.markerInstances.length;
  const next = structuredClone(sources);
  next[0].segments[0].count = 4;
  next[0].title = "Nový název";
  f.layer.update(next);
  assert.equal(f.markerInstances.length, instances);
  assert.equal(f.clusterer.renderCalls, 1);
  assert.equal(f.map.fitCalls.length, 1);
  assert.equal(cluster.marker.icon.summary.count, 8);
  assert.deepEqual(cluster.marker.icon.summary.segments.map(item => [item.key, item.count]), [["overdue", 4], ["ok", 4]]);
  assert.match(cluster.marker.title, /8 telepítés/);
  assert.equal(f.clusterer.markers[0].title, "Nový název");
  f.layer.update(next, "1");
  assert.equal(cluster.marker.icon.selected, true);
  assert.equal(cluster.marker.zIndex, 1001);
});

test("moving one coordinate replaces only that marker and removes its old listeners", () => {
  const f = fixture();
  const sources = [source(0), source(1), source(2)];
  f.layer.update(sources);
  const original = [...f.clusterer.markers];
  f.layer.update(sources.map(item => item.id === "1" ? { ...item, longitude: 20 } : item));
  assert.equal(f.markerInstances.length, 4);
  assert.equal(f.clusterer.markers.length, 3);
  assert.ok(f.clusterer.markers.includes(original[0]));
  assert.ok(f.clusterer.markers.includes(original[2]));
  assert.ok(!f.clusterer.markers.includes(original[1]));
  assert.deepEqual(f.clusterer.removals, [original[1]]);
  assert.ok(f.clearedListeners.includes(original[1]));
  assert.equal(original[1].map, null);
  assert.equal(original[1].events.size, 0);
  assert.equal(f.map.fitCalls.length, 2);
  assert.equal(f.clusterer.renderCalls, 2);
});

test("removals and invalid coordinates clean markers; empty results reset a bounded default view", () => {
  const f = fixture();
  f.layer.update([source(0), source(1), source(2, { latitude: NaN })]);
  assert.equal(f.clusterer.markers.length, 2);
  const removed = f.clusterer.markers[1];
  f.layer.update([source(0), source(1, { longitude: 181 })]);
  assert.equal(f.clusterer.markers.length, 1);
  assert.equal(removed.map, null);
  assert.ok(f.clearedListeners.includes(removed));
  f.layer.update([]);
  assert.equal(f.clusterer.markers.length, 0);
  assert.deepEqual(plain(f.map.centerCalls.at(-1)), { lat: 47.2, lng: 19.5 });
  assert.equal(f.map.zoom, 7);
});

test("viewport clustering stays enabled through maximum map zoom and waits for usable map bounds", () => {
  const f = fixture({ hasBounds: false });
  assert.deepEqual(plain(f.algorithms[0].options), { radius: 110, maxZoom: 20, viewportPadding: 100 });
  f.layer.update([source(0)]);
  assert.equal(f.clusterer.renderCalls, 0);
  f.map.hasBounds = true;
  f.clusterer.render();
  assert.equal(f.clusterer.renderCalls, 1);
});

test("fit listener caps synchronous fits and replacement cancels obsolete listeners", () => {
  const synchronous = fixture({ synchronousFit: true });
  synchronous.layer.update([source(0)], "", 11);
  assert.equal(synchronous.map.zoom, 11);
  const f = fixture();
  f.layer.update([source(0)]);
  const initial = f.listeners[0];
  f.layer.update([source(0)], "", 12);
  assert.ok(f.removedListeners.includes(initial));
  f.map.zoom = 18;
  f.emit(f.map, "idle");
  assert.equal(f.map.zoom, 12);
});

test("group popup displays exact total and every colored status; zoom is an explicit action", () => {
  const f = fixture();
  f.layer.update([source(0, { segments: [segment("overdue", 2, "#ef4444"), segment("ok", 3)] }),
    source(1, { segments: [segment("dueSoon", 4, "#f59e0b")] })]);
  const cluster = f.addCluster();
  f.clusterer.options.onClusterClick({}, cluster);
  assert.match(f.info.content.textContent, /9 telepítés · 2 helyszín/);
  assert.match(f.info.content.textContent, /overdue: 2/);
  assert.match(f.info.content.textContent, /dueSoon: 4/);
  assert.match(f.info.content.textContent, /ok: 3/);
  const dots = descend(f.info.content).filter(item => item.className === "alinflow-map-status-dot");
  assert.deepEqual(dots.map(item => item.style.backgroundColor), ["#ef4444", "#f59e0b", "#22c55e"]);
  assert.ok(dots.every(item => item.attributes["aria-hidden"] === "true"));
  assert.equal(f.map.fitCalls.length, 1, "opening cluster must not immediately zoom away from counts");
  assert.equal(f.info.openCalls.at(-1).anchor, undefined, "popup must survive cluster marker replacement during auto-pan");
  button(f.info.content, "Mutasd közelebbről").onclick();
  assert.equal(f.info.isOpen, false);
  assert.equal(f.map.fitCalls.length, 2);
  f.emit(f.map, "idle");
  assert.equal(f.map.zoom, 11);
});

test("identical-position members remain selectable via paged keyboard buttons at zoom 19", () => {
  const f = fixture({ zoom: 19 });
  const sources = Array.from({ length: 23 }, (_, id) => source(id, { latitude: 47, longitude: 19 }));
  f.layer.update(sources);
  const cluster = f.addCluster();
  f.clusterer.options.onClusterClick({}, cluster);
  assert.equal(button(f.info.content, "Mutasd közelebbről"), undefined);
  assert.equal(button(f.info.content, "Előző").disabled, true);
  assert.equal(button(f.info.content, "Következő").disabled, false);
  assert.equal(descend(f.info.content).filter(item => item.tagName === "button" && item.textContent.startsWith("Helyszín")).length, 10);
  assert.ok(descend(f.info.content).filter(item => item.tagName === "button").every(item => item.type === "button"));
  button(f.info.content, "Következő").onclick();
  assert.equal(f.document.activeElement.textContent, "Helyszín 10");
  button(f.info.content, "Következő").onclick();
  assert.equal(button(f.info.content, "Következő").disabled, true);
  assert.equal(descend(f.info.content).filter(item => item.tagName === "button" && item.textContent.startsWith("Helyszín")).length, 3);
  button(f.info.content, "Előző").onclick();
  button(f.info.content, "Helyszín 10").onclick();
  assert.deepEqual(f.selected, ["10"]);
  assert.match(f.info.content.textContent, /Részletek 10/);
  assert.match(f.info.content.textContent, /ok: 1/);
});

test("a single coincident location retains its complete status breakdown beside existing details", () => {
  const f = fixture();
  f.layer.update([source(0, { segments: [segment("overdue", 1, "#ef4444"), segment("ok", 9)] })]);
  f.clusterer.markers[0].click();
  assert.deepEqual(f.selected, ["0"]);
  assert.match(f.info.content.textContent, /10 telepítés/);
  assert.match(f.info.content.textContent, /overdue: 1/);
  assert.match(f.info.content.textContent, /ok: 9/);
  assert.match(f.info.content.textContent, /Részletek 0/);
});

test("unchanged data and new selection preserve popup; deselection or content changes close stale details", () => {
  const f = fixture();
  const sources = [source(0), source(1)];
  f.layer.update(sources);
  f.clusterer.markers[0].click();
  f.layer.update(structuredClone(sources), "0");
  assert.equal(f.info.isOpen, true);
  f.layer.update(sources, "0");
  assert.equal(f.info.isOpen, true);
  f.layer.update(sources, "");
  assert.equal(f.info.isOpen, false);
  f.clusterer.markers[0].click();
  f.layer.update(sources.map(item => ({ ...item, title: item.title + " frissítve" })), "0");
  assert.equal(f.info.isOpen, false);
});

test("callbacks are read at click time and stale chooser references cannot open removed sources", () => {
  const f = fixture();
  f.layer.update([source(0), source(1)]);
  const cluster = f.addCluster();
  f.clusterer.options.onClusterClick({}, cluster);
  const stale = button(f.info.content, "Helyszín 1");
  f.layer.update([source(0)]);
  stale.onclick();
  assert.deepEqual(f.selected, []);
  assert.equal(f.info.isOpen, false);
  const newSelections = [];
  f.callbacks.onSelectMarker = id => newSelections.push(id);
  f.clusterer.markers[0].click();
  assert.deepEqual(newSelections, ["0"]);
});

test("disposal cancels fit, detaches clusterer and markers, closes popup, and is idempotent", () => {
  const f = fixture();
  const sources = [source(0), source(1)];
  f.layer.update(sources);
  const originals = [...f.clusterer.markers];
  const listener = f.listeners[0];
  const staleClick = originals[0].events.get("click");
  f.layer.dispose();
  assert.ok(f.removedListeners.includes(listener));
  assert.equal(f.clusterer.map, null);
  assert.equal(f.clusterer.markers.length, 0);
  assert.equal(f.clusterer.clearCalls, 1);
  assert.ok(originals.every(marker => marker.map === null && marker.events.size === 0));
  assert.equal(f.info.isOpen, false);
  const closes = f.info.closeCalls;
  f.layer.dispose();
  f.layer.update([source(2)]);
  staleClick();
  assert.equal(f.info.closeCalls, closes);
  assert.equal(f.clusterer.clearCalls, 1);
  assert.equal(f.markerInstances.length, 2);
  assert.deepEqual(f.selected, []);
});
