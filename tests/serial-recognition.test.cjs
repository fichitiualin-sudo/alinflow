const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");
function setup(overrides = {}, globals = {}, start, barcode = async () => []) {
  const calls = { created: 0, terminated: 0, parameters: null, image: null, barcode: 0 };
  const worker = { async setParameters(value) { calls.parameters = value; }, async recognize(blob) { calls.image = blob; return { data: { text: "S/N: ABC123456\nMODEL: TEST999" } }; }, async terminate() { calls.terminated++; }, ...overrides };
  const api = harness({ setTimeout, clearTimeout, ...globals }, { "./serial-barcode": { recognizeSerialBarcode(...args) { calls.barcode++; return barcode(...args); } }, "tesseract.js": { PSM: { SPARSE_TEXT: 11 }, async createWorker(language, mode, options) { calls.created++; calls.language = language; options.logger({ progress: 0.42 }); return start ? start(worker) : worker; } } }).load("src/lib/alinflow/serial-recognition.ts");
  return { api, calls };
}
const plain = (value) => JSON.parse(JSON.stringify(value));
test("serial candidates require an explicit label and deduplicate indoor/outdoor labels", () => {
  const { api } = setup();
  assert.deepEqual(plain(api.serialCandidates("S/N: ABC12345\nS.N DEF67890\nSerial Number: ABC12345\nGyári szám: HU123456\nSorozatszám:\nNEXT123456")), ["ABC12345", "DEF67890", "HU123456", "NEXT123456"]);
  assert.deepEqual(plain(api.serialCandidates("MODEL TEST123\n220V\n50HZ\n3.5kW\nS/N: 220V\nS/N: 50HZ")), []);
  assert.deepEqual(plain(api.serialCandidates("SN: 00001234\nSERIAL NO. : A1-B2/C3")), ["00001234", "A1-B2/C3"]);
});
test("OCR only receives a saved bounded image and returns candidates for user confirmation", async () => {
  const { api, calls } = setup(); const progress = [];
  const photo = new Blob(["synthetic image"], { type: "image/jpeg" });
  const result = await api.recognizeSerialNumber(photo, (value) => progress.push(value));
  assert.equal(calls.image, photo);
  assert.equal(calls.language, "eng");
  assert.equal(calls.parameters.tessedit_pageseg_mode, 11);
  assert.deepEqual(plain(result.candidates), ["ABC123456"]);
  assert.deepEqual(progress, [0, 42]);
  assert.equal(result.source, "text");
  assert.equal(calls.terminated, 1);
});

test("sparse OCR labels allow blank lines, bare SN and repeated labels without guessing unrelated numbers", () => {
  const { api } = setup();
  assert.deepEqual(plain(api.serialCandidates("SN ABC123456\nS/N:\n\nNEXT987654\nS/N (Serial Number): WRAP123456\nS/N: FIRST1234 S/N: SECOND5678")), ["ABC123456", "NEXT987654", "WRAP123456", "FIRST1234", "SECOND5678"]);
  assert.deepEqual(plain(api.serialCandidates("S/N:\n\nModel: WRONG123\nSNOW123456\nSN: 220-240V\nS/N: 50HZ\nWIFI: 999912345678")), []);
  assert.deepEqual(plain(api.serialCandidates("Ｓ／Ｎ：ＡＢＣ１２３４５６")), ["ABC123456"]);
});

test("barcode candidates bypass OCR startup and remain explicitly identified for confirmation", async () => {
  const photo = new Blob(["synthetic image"], { type: "image/jpeg" });
  const progress = [];
  const { api, calls } = setup({}, {}, undefined, async (blob) => { assert.equal(blob, photo); return ["BARCODE123456789"]; });
  const result = await api.recognizeSerialNumber(photo, value => progress.push(value));
  assert.deepEqual(plain(result), { candidates: ["BARCODE123456789"], text: "BARCODE123456789", source: "barcode" });
  assert.equal(calls.created, 0);
  assert.deepEqual(progress, [0, 100]);
});

test("barcode unavailability falls back to OCR, cancellation does not", async () => {
  const photo = new Blob(["synthetic image"], { type: "image/jpeg" });
  const fallback = setup({}, {}, undefined, async () => { throw Error("canvas unavailable"); });
  assert.equal((await fallback.api.recognizeSerialNumber(photo, () => {})).source, "text");
  assert.equal(fallback.calls.created, 1);
  const controller = new AbortController();
  const cancelled = setup({}, {}, undefined, async () => { controller.abort(); return ["LATE123456789"]; });
  await assert.rejects(cancelled.api.recognizeSerialNumber(photo, () => {}, controller.signal), /megszakadt/);
  assert.equal(cancelled.calls.created, 0);
});

test("only controlled OCR messages are exposed; network and engine internals stay hidden", async () => {
  const { api } = setup();
  assert.match(api.serialRecognitionErrorMessage(new Error("engine failed at private URL")), /felismerő/);
  assert.doesNotMatch(api.serialRecognitionErrorMessage(new Error("engine failed at private URL")), /private URL/);
  try { await api.recognizeSerialNumber(new Blob(["invalid"]), () => {}); }
  catch (error) { assert.match(api.serialRecognitionErrorMessage(error), /mentett adattábla/); }
});
test("OCR rejects non-images, oversized images and pre-aborted work before worker creation", async () => {
  const { api, calls } = setup();
  await assert.rejects(api.recognizeSerialNumber(new Blob(["not image"]), () => {}), /mentett adattábla/);
  await assert.rejects(api.recognizeSerialNumber(new Blob([new Uint8Array(500001)], { type: "image/jpeg" }), () => {}), /mentett adattábla/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.recognizeSerialNumber(new Blob(["test"], { type: "image/jpeg" }), () => {}, controller.signal), /megszakadt/);
  assert.equal(calls.created, 0);
});
test("OCR worker is terminated on recognition failure and raw text is bounded", async () => {
  const failing = setup({ async recognize() { throw new Error("synthetic recognition failure"); } });
  await assert.rejects(failing.api.recognizeSerialNumber(new Blob(["test"], { type: "image/jpeg" }), () => {}), /synthetic/);
  assert.equal(failing.calls.terminated, 1);
  const long = setup({ async recognize() { return { data: { text: "S/N: LONG123456\n" + "x".repeat(6000) } }; } });
  const result = await long.api.recognizeSerialNumber(new Blob(["test"], { type: "image/jpeg" }), () => {});
  assert.equal(result.text.length, 5000);
  assert.equal(long.calls.terminated, 1);
});

test("aborting recognition settles even when worker termination does not reject its pending job", { timeout: 2000 }, async () => {
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  const { api, calls } = setup({ recognize() { entered(); return new Promise(() => {}); } });
  const controller = new AbortController();
  const task = api.recognizeSerialNumber(new Blob(["test"], { type: "image/jpeg" }), () => {}, controller.signal);
  const rejected = assert.rejects(task, /megszakadt/);
  await started; controller.abort(); await rejected;
  assert.equal(calls.terminated, 1);
});
test("recognition timeout settles its pending job and clears the timer", { timeout: 2000 }, async () => {
  let timeout, entered; let cleared = 0;
  const started = new Promise((resolve) => { entered = resolve; });
  const { api, calls } = setup({ recognize() { entered(); return new Promise(() => {}); } }, { setTimeout(callback, duration) { assert.equal(duration, 90000); timeout = callback; return 123; }, clearTimeout(id) { assert.equal(id, 123); cleared++; } });
  const task = api.recognizeSerialNumber(new Blob(["test"], { type: "image/jpeg" }), () => {});
  const rejected = assert.rejects(task, /túl sokáig/);
  await started; timeout(); await rejected;
  assert.equal(calls.terminated, 1); assert.equal(cleared, 1);
});
test("a worker that finishes loading after cancellation is terminated", { timeout: 2000 }, async () => {
  let entered, release; const started = new Promise((resolve) => { entered = resolve; });
  const { api, calls } = setup({}, {}, (worker) => new Promise((resolve) => { release = () => resolve(worker); entered(); }));
  const controller = new AbortController();
  const task = api.recognizeSerialNumber(new Blob(["test"], { type: "image/jpeg" }), () => {}, controller.signal);
  const rejected = assert.rejects(task, /megszakadt/);
  await started; controller.abort(); await rejected; release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.terminated, 1);
  assert.equal(calls.image, null);
});
