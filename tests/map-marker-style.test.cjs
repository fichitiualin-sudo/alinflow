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
      const drawing = { arcs: [], text: [], strokes: [], fills: [], paths: [], scales: [] };
      drawings.push(drawing);
      const context = {
        scale(...args) { drawing.scales.push(args); },
        translate() {},
        save() {},
        restore() {},
        clip() {},
        beginPath() {},
        moveTo(...args) { drawing.paths.push(["move", ...args]); },
        bezierCurveTo(...args) { drawing.paths.push(["curve", ...args]); },
        closePath() {},
        arc(...args) { drawing.arcs.push(args); },
        fill() { drawing.fills.push(this.fillStyle); },
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

test("original pin uses retina PNG, original shape and responsive sizes while retaining counts", () => {
  const f = canvasFixture();
  const summary = f.summarizeMapMarkers([source("a", [segment("overdue", 7), segment("ok", 5, "#22c55e")])]);
  const icon = f.markerPinIcon(f.maps, summary, false);
  assert.equal(icon.url, "data:image/png;base64,mock-1");
  assert.deepEqual(plain(icon.size), { width: 34, height: 40 });
  assert.deepEqual(plain(icon.scaledSize), { width: 34, height: 40 });
  assert.deepEqual(plain(icon.anchor), { x: 17, y: 40 });
  assert.equal(f.drawings[0].canvas.width, 68);
  assert.equal(f.drawings[0].canvas.height, 80);
  assert.deepEqual(f.drawings[0].scales, [[2, 2], [40 / 48, 40 / 48]]);
  assert.equal(f.drawings[0].text[0].args[0], "12");
  assert.equal(f.drawings[0].text[0].color, "#0f172a");
  assert.deepEqual(f.drawings[0].fills, ["#ef4444", "#ef4444", "#22c55e", "#ffffff"]);
  assert.deepEqual(f.drawings[0].strokes, ["#0f172a"]);
  assert.deepEqual(f.drawings[0].paths.slice(0, 5), [
    ["move", 20, 46], ["curve", 20, 46, 36, 28.6, 36, 17.8],
    ["curve", 36, 8.5, 28.8, 1, 20, 1], ["curve", 11.2, 1, 4, 8.5, 4, 17.8],
    ["curve", 4, 28.6, 20, 46, 20, 46],
  ]);
  const denseAddress = f.markerPinIcon(f.maps, f.summarizeMapMarkers([source("dense", [segment("ok", 150)])]), false);
  assert.deepEqual(plain(denseAddress.scaledSize), { width: 34, height: 40 });
  assert.deepEqual(plain(denseAddress.size), { width: 34, height: 40 });
  assert.deepEqual(plain(denseAddress.anchor), { x: 17, y: 40 });
  assert.equal(f.drawings[1].text[0].args[0], "150");
  assert.match(f.drawings[1].text[0].font, /11px/);
  const single = f.markerPinIcon(f.maps, f.summarizeMapMarkers([source("single", [segment("ok", 1)])]), false);
  assert.deepEqual(plain(single.size), { width: 34, height: 40 });
  assert.deepEqual(plain(single.anchor), { x: 17, y: 40 });
  assert.equal(f.drawings[2].text.length, 0, "one installation keeps the original unnumbered white center");
  assert.deepEqual(f.drawings[2].arcs[0], [20, 18, 7, 0, 2 * Math.PI]);
  const mobile = f.markerPinIcon(f.maps, f.summarizeMapMarkers([source("single", [segment("ok", 1)])]), false, true);
  assert.deepEqual(plain(mobile.size), { width: 18, height: 22 });
  assert.deepEqual(plain(mobile.anchor), { x: 9, y: 22 });
  const mobileGroup = f.markerPinIcon(f.maps, summary, false, true);
  assert.deepEqual(plain(mobileGroup.size), { width: 24, height: 28 });
  assert.deepEqual(plain(mobileGroup.anchor), { x: 12, y: 28 });
  assert.equal(f.drawings[4].text[0].args[0], "12");
});

test("rare status remains visibly present in the pin head without altering exact summary counts", () => {
  const f = canvasFixture();
  const summary = f.summarizeMapMarkers([source("a", [segment("overdue", 1), segment("ok", 999, "#22c55e")])]);
  f.markerPinIcon(f.maps, summary, false);
  const arcs = f.drawings[0].arcs.slice(0, 2);
  assert.ok(arcs[0][4] - arcs[0][3] >= Math.PI / 18 - 1e-10);
  assert.ok(Math.abs(arcs.reduce((sum, arc) => sum + arc[4] - arc[3], 0) - 2 * Math.PI) < 1e-10);
  assert.equal(summary.count, 1000);
  assert.deepEqual(plain(summary.segments.map(item => item.count)), [1, 999]);
});

test("cached pin rendering is reused while selection and status composition invalidate it", () => {
  const f = canvasFixture();
  const a = f.summarizeMapMarkers([source("a", [segment("overdue", 2), segment("ok", 3, "#22c55e")])]);
  const b = f.summarizeMapMarkers([source("a", [segment("overdue", 3), segment("ok", 2, "#22c55e")])]);
  const icon = f.markerPinIcon(f.maps, a, false);
  assert.equal(f.markerPinIcon(f.maps, structuredClone(a), false).url, icon.url);
  assert.equal(f.drawings.length, 1);
  const selected = f.markerPinIcon(f.maps, a, true);
  assert.notEqual(selected.url, icon.url);
  assert.deepEqual(f.drawings[1].strokes, ["#0f172a", "#0f172a"]);
  assert.deepEqual(plain(selected.size), plain(icon.size), "selection does not enlarge the pin");
  assert.notEqual(f.markerPinIcon(f.maps, b, false).url, icon.url);
  assert.equal(f.drawings.length, 3);
});

test("PNG cache evicts least recently used entries after 128 distinct styles", () => {
  const f = canvasFixture();
  const summaries = Array.from({ length: 129 }, (_, i) => f.summarizeMapMarkers([source("a", [segment("overdue", i + 1)])]));
  summaries.slice(0, 128).forEach(summary => f.markerPinIcon(f.maps, summary, false));
  const first = f.markerPinIcon(f.maps, summaries[0], false).url;
  f.markerPinIcon(f.maps, summaries[128], false);
  assert.equal(f.markerPinIcon(f.maps, summaries[0], false).url, first);
  assert.equal(f.drawings.length, 129);
  f.markerPinIcon(f.maps, summaries[1], false);
  assert.equal(f.drawings.length, 130);
});
