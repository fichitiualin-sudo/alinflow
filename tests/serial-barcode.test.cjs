const assert = require("node:assert/strict");
const test = require("node:test");
const zxing = require("@zxing/library");
const { harness } = require("./helpers.cjs");

// Synthetic Code 128-B raster: no customer photos or serial numbers are stored.
function codePixels(text, corruptChecksum = false) {
  const codes = [104, ...[...text].map((char) => char.charCodeAt(0) - 32)];
  let checksum = codes[0];
  for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
  codes.push((checksum + Number(corruptChecksum)) % 103, 106);
  const pixels = [];
  for (const code of codes) zxing.Code128Reader.CODE_PATTERNS[code].forEach((length, index) => {
    for (let i = 0; i < length * 2; i++) pixels.push(index % 2 === 0);
  });
  return pixels;
}

function setup({ width = 800, height = 100, codes = [], decoder = zxing, timer = setTimeout, imageBitmap, contextFailure = false } = {}) {
  const calls = { decoded: 0, closed: 0, draws: [] };
  const canvas = { width: 0, height: 0, getContext() {
    if (contextFailure) return null;
    return {
      fillRect() {}, drawImage() { calls.draws.push([canvas.width, canvas.height]); },
      getImageData() {
        const data = new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255);
        for (const code of codes) {
          const pattern = codePixels(code.text, code.corruptChecksum);
          if (code.reverse) pattern.reverse();
          const scale = canvas.width / width;
          for (let y = Math.round(code.y * scale); y < Math.round((code.y + (code.height || 2)) * scale); y++) {
            for (let x = 0; x < Math.round(pattern.length * scale); x++) {
              const point = (y * canvas.width + Math.round((code.x || 30) * scale) + x) * 4;
              const shade = pattern[Math.floor(x / scale)] ? (code.dark ?? 0) : (code.light ?? 255);
              data[point] = data[point + 1] = data[point + 2] = shade;
            }
          }
        }
        return { data };
      },
    };
  } };
  const bitmap = { width, height, close() { calls.closed++; } };
  const api = harness({ setTimeout: timer, document: { createElement(name) { assert.equal(name, "canvas"); return canvas; } },
    createImageBitmap: async () => { calls.decoded++; return imageBitmap ? imageBitmap(bitmap) : bitmap; },
  }, { "@zxing/library": decoder }).load("src/lib/alinflow/serial-barcode.ts");
  return { api, calls, canvas };
}
const photo = () => new Blob(["synthetic saved photo"], { type: "image/jpeg" });
const plain = (value) => JSON.parse(JSON.stringify(value));

test("dense scanning finds a Code 128 in a two-pixel band on a tall photo", async () => {
  const { api, calls, canvas } = setup({ height: 1920, codes: [{ text: "TEST123456", y: 1284 }] });
  assert.deepEqual(plain(await api.recognizeSerialBarcode(photo())), ["TEST123456"]);
  assert.deepEqual(calls.draws, [[800, 1920]], "successful original must not be enlarged");
  assert.equal(calls.closed, 1);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
});

test("identifiers are deduplicated, upside-down rows are read, and suggestions are bounded", async () => {
  const codes = Array.from({ length: 7 }, (_, i) => ({ text: "SYNTH" + (1000 + i), y: i * 10 + 2, reverse: i % 2 === 1 }));
  codes.splice(1, 0, { text: "SYNTH1000", y: 6 });
  const { api, calls } = setup({ codes });
  assert.deepEqual(plain(await api.recognizeSerialBarcode(photo())), ["SYNTH1000", "SYNTH1001", "SYNTH1002", "SYNTH1003", "SYNTH1004"]);
  assert.equal(calls.closed, 1);
});

test("fixed brightness fallback reads a barcode even when the full-row histogram cannot", async () => {
  class UnusableHistogram extends zxing.BinaryBitmap { getBlackRow() { throw new zxing.NotFoundException(); } }
  const { api } = setup({ codes: [{ text: "DARK1234", y: 24, dark: 90, light: 180 }], decoder: { ...zxing, BinaryBitmap: UnusableHistogram } });
  assert.deepEqual(plain(await api.recognizeSerialBarcode(photo())), ["DARK1234"]);
});

test("invalid checksums and non-identifier payloads never become serial suggestions", async () => {
  const { api, calls, canvas } = setup({ codes: [{ text: "BAD1234", y: 12, corruptChecksum: true }, { text: "WIFI:PASS1234", y: 30 }, { text: "NODIGITS", y: 50 }] });
  assert.deepEqual(plain(await api.recognizeSerialBarcode(photo())), []);
  assert.deepEqual(calls.draws, [[800, 100], [1600, 200]]);
  assert.equal(calls.closed, 1);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
});

test("blank input returns no candidates and both passes stay within the pixel limit", async () => {
  const { api, calls } = setup({ width: 4000, height: 1 });
  assert.deepEqual(plain(await api.recognizeSerialBarcode(photo())), []);
  assert.deepEqual(calls.draws, [[1920, 1], [3840, 1]]);
});

test("invalid files and a cancelled request do not start image decoding", async () => {
  const { api, calls } = setup();
  await assert.rejects(api.recognizeSerialBarcode(new Blob(["not an image"])), /mentett adattábla/);
  await assert.rejects(api.recognizeSerialBarcode(new Blob([new Uint8Array(500001)], { type: "image/jpeg" })), /mentett adattábla/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.recognizeSerialBarcode(photo(), controller.signal), /megszakadt/);
  assert.equal(calls.decoded, 0);
});

test("cancellation between scan chunks releases image and canvas", async () => {
  const controller = new AbortController();
  const { api, calls, canvas } = setup({ timer(callback) { controller.abort(); callback(); return 0; } });
  await assert.rejects(api.recognizeSerialBarcode(photo(), controller.signal), /megszakadt/);
  assert.equal(calls.closed, 1);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
});

test("an image that finishes decoding after cancellation is released without drawing", async () => {
  let finish;
  const controller = new AbortController();
  const { api, calls } = setup({ imageBitmap: (bitmap) => new Promise((resolve) => { finish = () => resolve(bitmap); }) });
  const task = api.recognizeSerialBarcode(photo(), controller.signal);
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  controller.abort(); finish();
  await assert.rejects(task, /megszakadt/);
  assert.equal(calls.closed, 1);
  assert.deepEqual(calls.draws, []);
});

test("unexpected decoder errors remain distinguishable for the OCR fallback", async () => {
  class BrokenReader { decodeRow() { throw new Error("synthetic decoder failure"); } }
  const { api, calls, canvas } = setup({ decoder: { ...zxing, Code128Reader: BrokenReader } });
  await assert.rejects(api.recognizeSerialBarcode(photo()), /synthetic decoder failure/);
  assert.equal(calls.closed, 1);
  assert.deepEqual([canvas.width, canvas.height], [0, 0]);
});

test("missing canvas support releases the decoded image", async () => {
  const { api, calls } = setup({ contextFailure: true });
  await assert.rejects(api.recognizeSerialBarcode(photo()), /böngészőben nem érhető el/);
  assert.equal(calls.closed, 1);
});
