const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");
function setup(overrides = {}, globals = {}, start, barcode = async () => [], regions = async () => []) {
  const calls = { created: 0, terminated: 0, parameters: null, image: null, barcode: 0 };
  const worker = { async setParameters(value) { calls.parameters = value; }, async recognize(blob) { calls.image = blob; return { data: { text: "S/N: ABC123456\nMODEL: TEST999" } }; }, async terminate() { calls.terminated++; }, ...overrides };
  const api = harness({ setTimeout, clearTimeout, AbortController, ...globals }, { "./device-label-regions": { prepareDeviceLabelRegions: regions }, "./serial-barcode": { recognizeSerialBarcode(...args) { calls.barcode++; return barcode(...args); } }, "tesseract.js": { PSM: { SPARSE_TEXT: 11, SINGLE_LINE: 7 }, async createWorker(language, mode, options) { calls.created++; calls.language = language; options.logger({ progress: 0.42 }); return start ? start(worker) : worker; } } }).load("src/lib/alinflow/serial-recognition.ts");
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

test("full label recognition reads model and manufacturer even when the serial barcode succeeds", async () => {
  const { api, calls } = setup({ async recognize() { return { data: { text: "Manufacturer: Midea\nOutdoor model: TEST-35-O\nS/N: OCR999999" } }; } }, {}, undefined, async () => ["BARCODE123456"]);
  const photo = new Blob(["synthetic"], { type: "image/jpeg" });
  const progress = [];
  const result = await api.recognizeDeviceLabel(photo, "outdoor", value => progress.push(value));
  assert.equal(calls.created, 1, "A barcode must not short-circuit model/manufacturer OCR");
  assert.equal(calls.terminated, 1);
  assert.deepEqual(plain(result.candidates), ["BARCODE123456"], "Keep checksummed serial ahead of potentially misread OCR");
  assert.deepEqual(plain(result.models), ["TEST-35-O"]);
  assert.deepEqual(plain(result.manufacturers), ["Midea"]);
  assert.equal(result.source, "barcode");
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.every(value => value >= 0 && value <= 100));
});

test("full label recognition retains text serial fallback and rejects the opposite-side model", async () => {
  const { api } = setup({ async recognize() { return { data: { text: "Midea\nOutdoor model: TEST-35-O\nIndoor model: TEST-35-I\nS/N: TEXT123456" } }; } });
  const result = await api.recognizeDeviceLabel(new Blob(["synthetic"], { type: "image/jpeg" }), "indoor", () => {});
  assert.deepEqual(plain(result.models), ["TEST-35-I"]);
  assert.deepEqual(plain(result.candidates), ["TEXT123456"]);
  assert.equal(result.source, "text");
});

test("text engine failure preserves a barcode as a clearly partial result without exposing engine internals", async () => {
  const { api, calls } = setup({ async recognize() { throw Error("failed at secret signed image URL"); } }, {}, undefined, async () => ["BARCODE123456"]);
  const result = await api.recognizeDeviceLabel(new Blob(["synthetic"], { type: "image/jpeg" }), "indoor", () => {});
  assert.deepEqual(plain(result.candidates), ["BARCODE123456"]);
  assert.deepEqual(plain(result.models), []);
  assert.deepEqual(plain(result.manufacturers), []);
  assert.match(result.warning, /szövegfelismerés nem sikerült/);
  assert.doesNotMatch(result.warning, /secret|URL/);
  assert.equal(calls.terminated, 1);
  const failed = setup({ async recognize() { throw Error("no usable results"); } });
  await assert.rejects(failed.api.recognizeDeviceLabel(new Blob(["synthetic"], { type: "image/jpeg" }), "indoor", () => {}), /no usable/);
});

test("aborted full recognition never returns a previously read barcode for the abandoned editor", { timeout: 2000 }, async () => {
  let entered; const started = new Promise(resolve => { entered = resolve; });
  const { api, calls } = setup({ recognize() { entered(); return new Promise(() => {}); } }, {}, undefined, async () => ["BARCODE123456"]);
  const controller = new AbortController();
  const task = api.recognizeDeviceLabel(new Blob(["synthetic"], { type: "image/jpeg" }), "outdoor", () => {}, controller.signal);
  const rejected = assert.rejects(task, /megszakadt/);
  await started; controller.abort(); await rejected;
  assert.equal(calls.terminated, 1);
});

test("missing model is read from an actual paired image cell and its matching caption", async () => {
  const photo = new Blob(["full photo"], { type: "image/jpeg" });
  const code = new Blob(["model cell"]), label = new Blob(["caption cell"]);
  const seen = [];
  const { api, calls } = setup({ async recognize(image) {
    seen.push(image);
    return { data: { text: image === code ? "TEST - 35A / I\n" : image === label ? "Beltéri egység\n" : "Manufacturer: Midea\nS/N: TEXT12345" } };
  } }, {}, undefined, async () => ["BARCODE12345"], async image => {
    assert.strictEqual(image, photo, "Detect regions in the actual original photo");
    return [{ image: code, labelImage: label }];
  });
  const result = await api.recognizeDeviceLabel(photo, "indoor", () => {});
  assert.deepEqual(plain(result.models), ["TEST-35A/I"]);
  assert.deepEqual(plain(result.candidates), ["BARCODE12345"]);
  assert.deepEqual(plain(result.manufacturers), ["Midea"]);
  assert.deepEqual(seen, [photo, code, label]);
  assert.equal(calls.created, 1, "Reuse the existing OCR worker");
  assert.equal(calls.terminated, 1);
});

test("region codes require a model caption for the correct side and reject electrical cells", async () => {
  const texts = ["220-240V", "TEST-35/O", "Kültéri egység típusa", "OTHER1234", "Compressor model", "TEST-35/I", "Indoor model"];
  const cells = texts.map(text => new Blob([text]));
  const pairs = [
    { image: cells[0], labelImage: cells[2] }, { image: cells[1], labelImage: cells[2] },
    { image: cells[3], labelImage: cells[4] }, { image: cells[5], labelImage: cells[6] },
  ];
  const { api } = setup({ async recognize(image) { return { data: { text: cells.includes(image) ? texts[cells.indexOf(image)] : "Midea" } }; } }, {}, undefined, async () => [], async () => pairs);
  const result = await api.recognizeDeviceLabel(new Blob(["photo"], { type: "image/jpeg" }), "indoor", () => {});
  assert.deepEqual(plain(result.models), ["TEST-35/I"]);
  assert.doesNotMatch(result.text, /OTHER1234|TEST-35\/O|220-240V/);
});

test("region failure retains original OCR; a model already read needs no additional image passes", async () => {
  const failed = setup({ async recognize() { return { data: { text: "Midea\nS/N: TEXT12345" } }; } }, {}, undefined, async () => [], async () => { throw Error("canvas unsupported"); });
  const photo = new Blob(["photo"], { type: "image/jpeg" });
  const result = await failed.api.recognizeDeviceLabel(photo, "indoor", () => {});
  assert.deepEqual(plain(result.candidates), ["TEXT12345"]);
  assert.deepEqual(plain(result.manufacturers), ["Midea"]);
  assert.equal(failed.calls.terminated, 1);
  let regionsCalled = 0;
  const complete = setup({}, {}, undefined, async () => [], async () => { regionsCalled++; return []; });
  assert.deepEqual(plain((await complete.api.recognizeDeviceLabel(photo, "indoor", () => {})).models), ["TEST999"]);
  assert.equal(regionsCalled, 0);
});

test("cancellation during cell detection stops fallback and never releases a model to the abandoned editor", { timeout: 2000 }, async () => {
  let entered; const detecting = new Promise(resolve => { entered = resolve; });
  const { api, calls } = setup({ async recognize() { return { data: { text: "Midea" } }; } }, {}, undefined, async () => ["BARCODE12345"], async () => { entered(); return new Promise(() => {}); });
  const controller = new AbortController();
  const task = api.recognizeDeviceLabel(new Blob(["photo"], { type: "image/jpeg" }), "outdoor", () => {}, controller.signal);
  const rejected = assert.rejects(task, /megszakadt/);
  await detecting; controller.abort(); await rejected;
  assert.equal(calls.terminated, 1);
});

test("independent separated-pixel readings agree without guessed character substitutions", async () => {
  const photo = new Blob(["photo"], { type: "image/jpeg" });
  const base = new Blob(["base"]), caption = new Blob(["caption"]);
  const variants = [new Blob(["gap two"]), new Blob(["gap four"])];
  const { api } = setup({ async recognize(image) { return { data: { text:
    image === base ? "TEST-35A-A" : image === caption ? "Indoor model" : variants.includes(image) ? "TEST-35A-i" : "Midea",
  } }; } }, {}, undefined, async () => [], async () => [{ image: base, labelImage: caption, alternativeImages: variants }]);
  const result = await api.recognizeDeviceLabel(photo, "indoor", () => {});
  assert.deepEqual(plain(result.models), ["TEST-35A-I"]);
  assert.doesNotMatch(result.text, /35A-A/);
});

test("disagreeing image readings remain explicit alternatives, with I and 1 kept distinct", async () => {
  const photo = new Blob(["photo"], { type: "image/jpeg" });
  const base = new Blob(["base"]), caption = new Blob(["caption"]), alternative = new Blob(["alternative"]);
  const { api } = setup({ async recognize(image) { return { data: { text:
    image === base ? "TEST-351-I" : image === caption ? "Indoor model" : image === alternative ? "TEST-35I-I" : "Midea",
  } }; } }, {}, undefined, async () => [], async () => [{ image: base, labelImage: caption, alternativeImages: [alternative] }]);
  const result = await api.recognizeDeviceLabel(photo, "indoor", () => {});
  assert.deepEqual(plain(result.models), ["TEST-351-I", "TEST-35I-I"]);
});

test("verified region is independent of full-photo side headings and preserves late original fields", async () => {
  const photo = new Blob(["photo"], { type: "image/jpeg" });
  const base = new Blob(["base"]), caption = new Blob(["caption"]);
  const original = "Unrelated text\n".repeat(300) + "Manufacturer: Midea\nS/N: TEXT123456\nOUTDOOR UNIT\nPower 3500W";
  const { api } = setup({ async recognize(image) { return { data: { text:
    image === base ? "TEST-35A-I" : image === caption ? "MODEL" : original,
  } }; } }, {}, undefined, async () => [], async () => [{ image: base, labelImage: caption }]);
  const result = await api.recognizeDeviceLabel(photo, "indoor", () => {});
  assert.deepEqual(plain(result.models), ["TEST-35A-I"]);
  assert.deepEqual(plain(result.manufacturers), ["Midea"]);
  assert.deepEqual(plain(result.candidates), ["TEXT123456"]);
});

test("clear original code skips aggressive variants and ignores a trailing table delimiter", async () => {
  const base = new Blob(["base"]), caption = new Blob(["caption"]), alternative = new Blob(["alternative"]);
  const { api } = setup({ async recognize(image) {
    assert.notEqual(image, alternative, "Do not distort a clearly readable model");
    return { data: { text: image === base ? "TEST-35A-O |" : image === caption ? "Outdoor model" : "Midea", confidence: 85 } };
  } }, {}, undefined, async () => [], async () => [{ image: base, labelImage: caption, alternativeImages: [alternative] }]);
  const result = await api.recognizeDeviceLabel(new Blob(["photo"], { type: "image/jpeg" }), "outdoor", () => {});
  assert.deepEqual(plain(result.models), ["TEST-35A-O"]);
});

test("region timeout aborts image processing while preserving the original text and barcode", { timeout: 2000 }, async () => {
  let expire, processingSignal, entered;
  const detecting = new Promise(resolve => { entered = resolve; });
  const { api, calls } = setup({ async recognize() { return { data: { text: "Midea" } }; } }, {
    setTimeout(callback) { expire = callback; return 1; }, clearTimeout() {},
  }, undefined, async () => ["BARCODE123456"], async (_photo, signal) => {
    processingSignal = signal; entered(); return new Promise(() => {});
  });
  const pending = api.recognizeDeviceLabel(new Blob(["photo"], { type: "image/jpeg" }), "indoor", () => {});
  await detecting; expire();
  const result = await pending;
  assert.equal(processingSignal.aborted, true);
  assert.deepEqual(plain(result.manufacturers), ["Midea"]);
  assert.deepEqual(plain(result.candidates), ["BARCODE123456"]);
  assert.equal(calls.terminated, 1);
});
