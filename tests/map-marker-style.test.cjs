const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const source = (id, segments, label = "1") => ({ id, latitude: 47, longitude: 19, title: id, label, segments });
const segment = (key, count, color = "#ef4444") => ({ key, count, color, label: key });
const plain = value => JSON.parse(JSON.stringify(value));
const style = extra => harness(extra).load("src/lib/alinflow/map-marker-style.ts");

function canvasFixture() {
  const drawings = [];
  const document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const drawing = { arcs: [], text: [], strokes: [] };
      drawings.push(drawing);
      const context = {
        scale(...args) { drawing.scale = args; },
        beginPath() {},
        arc(...args) { drawing.arcs.push(args); },
        fill() {},
        stroke() { drawing.strokes.push(this.strokeStyle); },
        measureText(value) { return { width: value.length * parseFloat(this.font.split(" ")[1]) * 0.55 }; },
        fillText(...args) { drawing.text.push({ args, color: this.fillStyle, font: this.font }); },
      };
      const canvas = {
        getContext(kind) { assert.equal(kind, "2d"); return context; },
        toDataURL(kind) { assert.equal(kind, "image/png"); return `data:image/png;base64,mock-${drawings.length}`; },
      };
      drawing.canvas = canvas;
      return canvas;
    },
  };
  const maps = { Size: class Size { constructor(width, height) { Object.assign(this, { width, height }); } },
    Point: class Point { constructor(x, y) { Object.assign(this, { x, y }); } } };
  return { ...style({ document }), drawings, maps };
}

test("map marker style module loads without DOM and empty summary is empty", () => {
  assert.deepEqual(plain(style().summarizeMapMarkers([])), { count: 0, segments: [] });
});

test("mixed location groups keep every status and sum actual installations rather than markers", () => {
  const markers = [
    source("shared-site", [segment("overdue", 2), segment("ok", 3, "#22c55e")], "5"),
    source("next-site", [segment("dueSoon", 4, "#f59e0b"), segment("ok", 1, "#22c55e")], "5"),
  ];
  const summary = style().summarizeMapMarkers(markers);
  assert.equal(summary.count, 10);
  assert.deepEqual(plain(summary.segments.map(({ key, count }) => ({ key, count }))), [
    { key: "overdue", count: 2 }, { key: "dueSoon", count: 4 }, { key: "ok", count: 4 },
  ]);
});

test("segments have fixed business order independent of source order and are not mutated", () => {
  const markers = ["callback", "unknown", "optOut", "ok", "dueSoon", "overdue"].map((key, i) => source(key, [segment(key, i + 1)]));
  const before = structuredClone(markers);
  markers.forEach(item => { item.segments.forEach(Object.freeze); Object.freeze(item.segments); Object.freeze(item); });
  Object.freeze(markers);
  const { summarizeMapMarkers } = style();
  const summary = summarizeMapMarkers(markers);
  assert.deepEqual(plain(summary), plain(summarizeMapMarkers([...markers].reverse())));
  assert.deepEqual(plain(summary.segments.map(item => item.key)), ["overdue", "dueSoon", "ok", "optOut", "unknown", "callback"]);
  assert.deepEqual(markers, before);
});

test("same status metadata remains deterministic even with inconsistent source metadata", () => {
  const markers = [source("a", [{ key: "ok", count: 2, color: "#22c55e", label: "Rendben" }]),
    source("b", [{ key: "ok", count: 3, color: "#22C55E", label: "Rendben" }])];
  const { summarizeMapMarkers } = style();
  assert.deepEqual(plain(summarizeMapMarkers(markers)), plain(summarizeMapMarkers([...markers].reverse())));
  assert.equal(summarizeMapMarkers(markers).count, 5);
});

test("numeric labels provide legacy counts; invalid counts never inflate or corrupt the total", () => {
  const markers = [source("a", undefined, "12"), source("b", [], "2"), source("c", undefined, "hely"),
    source("d", [segment("ok", NaN), segment("overdue", -3)], "4"),
    source("e", [segment("ok", 2.5)], "0"), source("f", undefined, "Infinity")];
  const summary = style().summarizeMapMarkers(markers);
  assert.equal(summary.count, 21);
  assert.equal(summary.segments.length, 1);
  assert.equal(summary.segments[0].color, "#0f766e");
});

test("explicit status counts are authoritative and zero/invalid segments are omitted", () => {
  const summary = style().summarizeMapMarkers([source("a", [segment("ok", 3), segment("overdue", 0), segment("unknown", Infinity)], "99")]);
  assert.equal(summary.count, 3);
  assert.deepEqual(plain(summary.segments.map(item => item.key)), ["ok"]);
});

test("donut icon uses retina PNG with centered dark exact count and small Google dimensions", () => {
  const f = canvasFixture();
  const summary = f.summarizeMapMarkers([source("a", [segment("overdue", 7), segment("ok", 5, "#22c55e")])]);
  const icon = f.markerDotIcon(f.maps, summary, false);
  assert.equal(icon.url, "data:image/png;base64,mock-1");
  assert.deepEqual(plain(icon.size), { width: 28, height: 28 });
  assert.deepEqual(plain(icon.scaledSize), { width: 28, height: 28 });
  assert.deepEqual(plain(icon.anchor), { x: 14, y: 14 });
  assert.equal(f.drawings[0].canvas.width, 56);
  assert.equal(f.drawings[0].canvas.height, 56);
  assert.deepEqual(f.drawings[0].scale, [2, 2]);
  assert.equal(f.drawings[0].text[0].args[0], "12");
  assert.equal(f.drawings[0].text[0].color, "#0f172a");
  assert.deepEqual(f.drawings[0].strokes, ["#ef4444", "#22c55e"]);
  const denseAddress = f.markerDotIcon(f.maps, f.summarizeMapMarkers([source("dense", [segment("ok", 150)])]), false);
  assert.deepEqual(plain(denseAddress.scaledSize), { width: 36, height: 36 });
  assert.deepEqual(plain(denseAddress.size), { width: 36, height: 36 });
});

test("rare status remains visibly present in the ring without altering exact summary counts", () => {
  const f = canvasFixture();
  const summary = f.summarizeMapMarkers([source("a", [segment("overdue", 1), segment("ok", 999, "#22c55e")])]);
  f.markerDotIcon(f.maps, summary, false, true);
  const arcs = f.drawings[0].arcs.slice(1);
  assert.ok(arcs[0][4] - arcs[0][3] >= Math.PI / 18 - 1e-10);
  assert.ok(Math.abs(arcs.reduce((sum, arc) => sum + arc[4] - arc[3], 0) - 2 * Math.PI) < 1e-10);
  assert.equal(summary.count, 1000);
  assert.deepEqual(plain(summary.segments.map(item => item.count)), [1, 999]);
});

test("cached rendering is reused, while selection, cluster size and composition invalidate it", () => {
  const f = canvasFixture();
  const a = f.summarizeMapMarkers([source("a", [segment("overdue", 2), segment("ok", 3, "#22c55e")])]);
  const b = f.summarizeMapMarkers([source("a", [segment("overdue", 3), segment("ok", 2, "#22c55e")])]);
  const icon = f.markerDotIcon(f.maps, a, false);
  assert.equal(f.markerDotIcon(f.maps, structuredClone(a), false).url, icon.url);
  assert.equal(f.drawings.length, 1);
  assert.notEqual(f.markerDotIcon(f.maps, a, true).url, icon.url);
  assert.equal(f.drawings[1].strokes[0], "#0f172a");
  const cluster = f.markerDotIcon(f.maps, a, false, true);
  assert.notEqual(cluster.url, icon.url);
  assert.deepEqual(plain(cluster.size), { width: 36, height: 36 });
  assert.deepEqual(plain(cluster.scaledSize), { width: 36, height: 36 });
  assert.notEqual(f.markerDotIcon(f.maps, b, false).url, icon.url);
  assert.equal(f.drawings.length, 4);
});

test("PNG cache evicts least recently used entries after 128 distinct styles", () => {
  const f = canvasFixture();
  const summaries = Array.from({ length: 129 }, (_, i) => f.summarizeMapMarkers([source("a", [segment("overdue", i + 1)])]));
  summaries.slice(0, 128).forEach(summary => f.markerDotIcon(f.maps, summary, false));
  const first = f.markerDotIcon(f.maps, summaries[0], false).url;
  f.markerDotIcon(f.maps, summaries[128], false);
  assert.equal(f.markerDotIcon(f.maps, summaries[0], false).url, first);
  assert.equal(f.drawings.length, 129);
  f.markerDotIcon(f.maps, summaries[1], false);
  assert.equal(f.drawings.length, 130);
});
