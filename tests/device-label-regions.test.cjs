const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");

const photo = () => new Blob(["synthetic saved label"], { type: "image/jpeg" });

function setup({ width = 400, height = 220, rows = 1, slanted = false, blank = false, timer = setTimeout, missingContext = false, encode } = {}) {
  const source = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const localY = slanted ? (y - 0.3 * x) / 0.955 : y;
    const localX = slanted ? x - 0.15 * localY : x;
    const tx = localX - 30, ty = localY - 30;
    let color = [190, 190, 190];
    if (!blank && tx >= 0 && tx < 320 && ty >= 0 && ty < rows * 32 + 3) {
      color = tx < 150 ? [230, 220, 210] : [200, 240, 220];
      if (tx < 3 || tx >= 317 || (tx >= 147 && tx < 153) || ty % 32 < 3) color = [10, 10, 10];
      // Letter-like strokes must leave the surrounding white cell connected.
      const textX = tx < 150 ? tx - 20 : tx - 180;
      if (textX >= 0 && textX < 35 && textX % 9 < 4 && ty % 32 >= 10 && ty % 32 < 22) color = [30, 30, 30];
    }
    const index = (y * width + x) * 4;
    source.set([...color, 255], index);
  }
  const calls = { decodes: 0, closes: 0, draws: [], outputs: [], canvases: [] };
  const api = harness({ setTimeout: timer,
    createImageBitmap: async () => { calls.decodes++; return { width, height, close() { calls.closes++; } }; },
    document: { createElement(name) {
      assert.equal(name, "canvas");
      let output;
      const canvas = { width: 0, height: 0, getContext() {
        if (missingContext) return null;
        return { fillRect() {}, drawImage() { calls.draws.push([canvas.width, canvas.height]); },
          getImageData() {
            if (canvas.width === width && canvas.height === height) return { data: source };
            return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255) };
          },
          createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
          putImageData(image) { output = image.data; },
        };
      }, toBlob(callback, type) {
        calls.outputs.push({ data: output, width: canvas.width, height: canvas.height });
        if (encode) encode(callback, new Blob([output], { type }));
        else callback(new Blob([output], { type }));
      } };
      calls.canvases.push(canvas);
      return canvas;
    } },
  }).load("src/lib/alinflow/device-label-regions.ts");
  return { api, calls };
}

function pixel(output, x, y) { return [...output.data.slice((y * output.width + x) * 4, (y * output.width + x) * 4 + 3)]; }
function assertReleased(calls) { assert.equal(calls.closes, 1); assert.ok(calls.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)); }

test("table cells are paired with their own caption and deduplicated across brightness passes", async () => {
  const { api, calls } = setup();
  const regions = await api.prepareDeviceLabelRegions(photo());
  assert.equal(regions.length, 1);
  assert.equal(regions[0].image.type, "image/png");
  assert.equal(regions[0].labelImage.type, "image/png");
  assert.deepEqual(pixel(calls.outputs[0], 900, 70), [200, 240, 220], "value crop is the right cell");
  assert.deepEqual(pixel(calls.outputs[1], 900, 70), [230, 220, 210], "caption crop is the adjacent left cell");
  assert.deepEqual(pixel(calls.outputs[0], 2, 70), [255, 255, 255], "OCR receives a white outer margin");
  assertReleased(calls);
});

test("slanted cells are detected from pixels and rectified without photo coordinates", async () => {
  const { api, calls } = setup({ slanted: true, height: 300 });
  const regions = await api.prepareDeviceLabelRegions(photo());
  assert.equal(regions.length, 1);
  const value = calls.outputs[0];
  assert.deepEqual(pixel(value, 900, 45), [200, 240, 220]);
  assert.deepEqual(pixel(value, 900, 100), [200, 240, 220]);
  assert.deepEqual(pixel(calls.outputs[1], 900, 70), [230, 220, 210]);
  assertReleased(calls);
});

test("large tables have a bounded number of OCR regions", async () => {
  const { api, calls } = setup({ rows: 20, height: 720 });
  assert.equal((await api.prepareDeviceLabelRegions(photo())).length, 10);
  assert.equal(calls.outputs.length, 20);
  assertReleased(calls);
});

test("a blank picture produces no table-cell proposals", async () => {
  const { api, calls } = setup({ blank: true });
  assert.equal((await api.prepareDeviceLabelRegions(photo())).length, 0);
  assert.equal(calls.outputs.length, 0);
  assertReleased(calls);
});

test("decoded input is bounded to 1920 pixels on its longest side", async () => {
  const { api, calls } = setup({ width: 4000, height: 1, blank: true });
  assert.equal((await api.prepareDeviceLabelRegions(photo())).length, 0);
  assert.deepEqual(calls.draws, [[1920, 1]]);
  assertReleased(calls);
});

test("invalid input and cancellation before work do not decode a photo", async () => {
  const { api, calls } = setup();
  await assert.rejects(api.prepareDeviceLabelRegions(new Blob(["text"])), /mentett adattábla/);
  await assert.rejects(api.prepareDeviceLabelRegions(new Blob([new Uint8Array(500001)], { type: "image/png" })), /mentett adattábla/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.prepareDeviceLabelRegions(photo(), controller.signal), /megszakadt/);
  assert.equal(calls.decodes, 0);
});

test("cancellation during a flood fill releases all image resources", async () => {
  const controller = new AbortController();
  const { api, calls } = setup({ timer(callback) { controller.abort(); callback(); } });
  await assert.rejects(api.prepareDeviceLabelRegions(photo(), controller.signal), /megszakadt/);
  assert.equal(calls.outputs.length, 0);
  assertReleased(calls);
});

test("canvas failure releases the decoded bitmap", async () => {
  const { api, calls } = setup({ missingContext: true });
  await assert.rejects(api.prepareDeviceLabelRegions(photo()), /böngészőben nem érhető el/);
  assertReleased(calls);
});

test("cancellation while PNG encoding is pending releases canvases and ignores its late result", async () => {
  const controller = new AbortController();
  let finishEncoding;
  const { api, calls } = setup({ encode(callback, blob) { finishEncoding = () => callback(blob); controller.abort(); } });
  await assert.rejects(api.prepareDeviceLabelRegions(photo(), controller.signal), /megszakadt/);
  assertReleased(calls);
  finishEncoding();
  assert.equal(calls.outputs.length, 1, "late encoding must not continue into caption processing");
});

test("PNG encoding failure releases every allocated canvas", async () => {
  const { api, calls } = setup({ encode(callback) { callback(null); } });
  await assert.rejects(api.prepareDeviceLabelRegions(photo()), /kivágása nem sikerült/);
  assertReleased(calls);
});

function dashRaster({ connected = true, shortStroke = false, glyphs = true } = {}) {
  const width = 200, height = 200;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (left, top, right, bottom) => {
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const index = (y * width + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = 20;
    }
  };
  if (glyphs) { ink(40, 45, 60, 155); ink(101, 45, 121, 155); }
  if (connected) ink(60, 97, shortStroke ? 70 : 101, 105);
  return { data, width, height };
}

test("generic dash separation creates two bounded gaps and preserves the remaining glyph pixels", () => {
  const { separatedDashVariants } = harness().functions(["separatedDashVariants"], {}, "src/lib/alinflow/device-label-regions.ts");
  const input = dashRaster();
  const original = Uint8ClampedArray.from(input.data);
  const variants = separatedDashVariants(input);
  assert.equal(variants.length, 2);
  for (const variant of variants) {
    assert.deepEqual(pixel(variant, 80, 100), [0, 0, 0], "the middle of the dash remains visible");
    assert.deepEqual(pixel(variant, 61, 100), [255, 255, 255], "the touching dash boundary is separated");
    assert.deepEqual(pixel(variant, 45, 50), [0, 0, 0], "the first glyph remains tall");
    assert.deepEqual(pixel(variant, 116, 150), [0, 0, 0], "the second glyph remains tall");
  }
  assert.deepEqual(input.data, original, "the normal color crop must remain unchanged");
});

test("no alternative crop is generated for missing dashes, short glyph strokes, or a dash without tall text", () => {
  const { separatedDashVariants } = harness().functions(["separatedDashVariants"], {}, "src/lib/alinflow/device-label-regions.ts");
  for (const options of [{ connected: false }, { shortStroke: true }, { glyphs: false }]) {
    assert.equal(separatedDashVariants(dashRaster(options)).length, 0);
  }
});

test("cancelling the Image fallback revokes its object URL and detaches event handlers", async () => {
  const controller = new AbortController();
  let image;
  const revoked = [];
  class FakeImage {
    constructor() { image = this; }
    set src(value) { this.currentSource = value; if (value) controller.abort(); }
  }
  const api = harness({ createImageBitmap: async () => { throw Error("unsupported"); }, Image: FakeImage,
    URL: { createObjectURL: () => "blob:synthetic-label", revokeObjectURL: (url) => revoked.push(url) },
  }).load("src/lib/alinflow/device-label-regions.ts");
  await assert.rejects(api.prepareDeviceLabelRegions(photo(), controller.signal), /megszakadt/);
  assert.deepEqual(revoked, ["blob:synthetic-label"]);
  assert.equal(image.currentSource, "");
  assert.equal(image.onload, null);
  assert.equal(image.onerror, null);
});

test("a bitmap that finishes decoding after cancellation is closed before drawing", async () => {
  const controller = new AbortController();
  let finishDecode, closed = 0;
  const api = harness({ createImageBitmap: () => new Promise((resolve) => { finishDecode = () => resolve({ width: 100, height: 100, close() { closed++; } }); }),
    document: { createElement() { assert.fail("cancelled work must not allocate a canvas"); } },
  }).load("src/lib/alinflow/device-label-regions.ts");
  const pending = api.prepareDeviceLabelRegions(photo(), controller.signal);
  controller.abort(); finishDecode();
  await assert.rejects(pending, /megszakadt/);
  assert.equal(closed, 1);
});
