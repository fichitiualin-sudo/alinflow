const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");

function setup({ width = 1440, height = 1920, bitmapResult, contextMissing = false, drawFailure = false, encode } = {}) {
  const calls = { decoded: 0, closed: 0, draws: [], fills: [], encodes: [] };
  const output = new Blob(["temporary OCR-only JPEG"], { type: "image/jpeg" });
  const bitmap = { width, height, close() { calls.closed++; } };
  const canvas = { width: 0, height: 0, getContext() {
    if (contextMissing) return null;
    return {
      fillRect(...args) { calls.fills.push(args); },
      drawImage(...args) { if (drawFailure) throw new Error("synthetic canvas failure"); calls.draws.push(args); },
    };
  }, toBlob(callback, mime, quality) {
    calls.encodes.push({ mime, quality });
    if (encode) encode(callback, output); else callback(output);
  } };
  const api = harness({ createImageBitmap: async (blob, options) => {
    calls.decoded++; calls.input = blob; calls.orientation = options.imageOrientation;
    return bitmapResult ? bitmapResult(bitmap) : bitmap;
  }, document: { createElement(name) { assert.equal(name, "canvas"); return canvas; } } }).load("src/lib/alinflow/device-label-image.ts");
  return { api, calls, canvas, bitmap, output };
}
const original = () => new Blob(["original saved work photo"], { type: "image/jpeg" });

test("OCR receives a separate 2x JPEG while the saved photo stays unchanged", async () => {
  const { api, calls, canvas, bitmap, output } = setup();
  const input = original(); const bytesBefore = await input.text();
  assert.equal(await api.prepareDeviceLabelImage(input), output);
  assert.equal(await input.text(), bytesBefore);
  assert.equal(calls.input, input);
  assert.equal(calls.orientation, "from-image");
  assert.deepEqual(calls.draws, [[bitmap, 0, 0, 2880, 3840]]);
  assert.deepEqual(calls.fills, [[0, 0, 2880, 3840]]);
  assert.deepEqual(calls.encodes, [{ mime: "image/jpeg", quality: 0.95 }]);
  assert.equal(calls.closed, 1);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
});

test("large and small images keep their aspect ratio within the edge cap", async () => {
  for (const [width, height, expected] of [[6000, 3000, [3840, 1920]], [1920, 1080, [3840, 2160]], [200, 100, [400, 200]]]) {
    const { api, calls } = setup({ width, height });
    await api.prepareDeviceLabelImage(original());
    assert.deepEqual(calls.draws[0].slice(3), expected);
    assert.equal(calls.closed, 1);
  }
});

test("browsers without ImageBitmap or document use the unchanged original", async () => {
  for (const globals of [{}, { createImageBitmap: async () => { throw new Error("must not decode without document"); } }, { document: {} }]) {
    const api = harness(globals).load("src/lib/alinflow/device-label-image.ts");
    const input = original();
    assert.equal(await api.prepareDeviceLabelImage(input), input);
  }
});

test("unsupported decoding, drawing and encoding fall back without leaking resources", async () => {
  for (const options of [
    { bitmapResult: async () => { throw new Error("unsupported JPEG decoding"); } },
    { contextMissing: true }, { drawFailure: true }, { encode(callback) { callback(null); } },
    { encode(callback) { callback(new Blob([] , { type: "image/jpeg" })); } },
    { encode(callback) { callback(new Blob(["wrong MIME"], { type: "image/png" })); } },
    { encode() { throw new Error("unsupported encoding"); } }, { width: 0 },
  ]) {
    const { api, calls, canvas } = setup(options); const input = original();
    assert.equal(await api.prepareDeviceLabelImage(input), input);
    assert.equal(calls.closed, options.bitmapResult ? 0 : 1);
    assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  }
});

test("pre-cancelled preparation neither decodes nor silently falls back", async () => {
  const { api, calls } = setup(); const controller = new AbortController(); controller.abort();
  await assert.rejects(api.prepareDeviceLabelImage(original(), controller.signal), /megszakadt/);
  assert.equal(calls.decoded, 0);
});

test("cancellation during JPEG encoding settles promptly and ignores a late callback", async () => {
  let complete; const controller = new AbortController();
  const { api, calls, canvas } = setup({ encode(callback, output) { complete = () => callback(output); } });
  const task = api.prepareDeviceLabelImage(original(), controller.signal);
  while (!complete) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(task, /megszakadt/);
  assert.equal(calls.closed, 1);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  complete();
  assert.equal(calls.closed, 1);
});

test("a bitmap that arrives after cancellation is closed without drawing", async () => {
  let complete; const controller = new AbortController();
  const { api, calls } = setup({ bitmapResult: (bitmap) => new Promise((resolve) => { complete = () => resolve(bitmap); }) });
  const task = api.prepareDeviceLabelImage(original(), controller.signal);
  controller.abort(); complete();
  await assert.rejects(task, /megszakadt/);
  assert.equal(calls.closed, 1);
  assert.deepEqual(calls.draws, []);
});
