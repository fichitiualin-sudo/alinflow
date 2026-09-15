const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");
const jsx = { "react/jsx-runtime": require("react/jsx-runtime") };
const tick = () => new Promise(setImmediate);
const plain = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function hooks() {
  const slots = [];
  let cursor = 0, dirty = false, unmounted = false, lateWrites = 0;
  let pending = [];
  return {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
        return [slots[index].value, (next) => {
          if (unmounted) { lateWrites++; return; }
          slots[index].value = typeof next === "function" ? next(slots[index].value) : next;
          dirty = true;
        }];
      },
      useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
      useEffect(effect, dependencies) {
        const index = cursor++;
        const previous = slots[index];
        if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
          slots[index] = { dependencies, cleanup: previous?.cleanup };
          pending.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
        }
      },
    },
    render(callback) {
      for (let count = 0; count < 20; count++) {
        cursor = 0; dirty = false;
        const result = callback();
        const effects = pending; pending = []; effects.forEach((effect) => effect());
        if (!dirty) return result;
      }
      throw new Error("Device editor did not settle");
    },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); unmounted = true; },
    get lateWrites() { return lateWrites; },
  };
}

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree === null || tree === undefined || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}

function setup(overrides = {}) {
  const runtime = hooks();
  const calls = { downloads: [], recognition: [], saves: [], saved: [], errors: [] };
  const scope = { workspaceId: "workspace-a", customerId: "customer-a", appointmentId: "appointment-a" };
  const slot = { productKey: "manual:szintetikus klíma", productName: "Szintetikus klíma", unitNumber: 1 };
  const props = { slot, context: scope, customer: { id: scope.customerId }, retained: false,
    device: { ...scope, ...slot, id: "device-a", updatedAt: "2026-09-15T10:00:00Z",
      data: { indoorSerial: "ORIGINAL-IN001", outdoorSerial: "ORIGINAL-OUT002", manufacturer: "TESZT", scop: "4.6" } },
    onSaved: (device) => { calls.saved.push(device); props.device = device; },
  };
  const { DeviceEditor } = harness({ AbortController }, jsx).functions(["DeviceEditor"], {
    ...runtime.react,
    button: "test-button",
    WorkPhotosPanel: "test-device-photos",
    async downloadWorkPhoto(photo) { calls.downloads.push(photo); return overrides.download ? overrides.download(photo) : new Blob(["synthetic"], { type: "image/jpeg" }); },
    async recognizeSerialNumber(blob, progress, signal) {
      calls.recognition.push({ blob, progress, signal });
      return overrides.recognize ? overrides.recognize(blob, progress, signal) : { candidates: ["NEW-SERIAL003"], text: "S/N: NEW-SERIAL003" };
    },
    serialRecognitionErrorMessage(error) { calls.errors.push(error); return overrides.safeMessage || "A felismerő nem indult el vagy megszakadt. Ellenőrizd az internetkapcsolatot, majd próbáld újra."; },
    async saveAppointmentDevice(context, targetSlot, data, existing) {
      calls.saves.push({ context, slot: targetSlot, data: plain(data), existing });
      return { ...existing, data: plain(data), updatedAt: "2026-09-15T11:00:00Z" };
    },
  }, "src/components/alinflow/AppointmentDevicesPanel.tsx");
  const run = {
    runtime, calls, props,
    render() { run.tree = runtime.render(() => DeviceEditor(props)); return run.tree; },
    button(label) { const result = nodes(run.tree, (node) => node.type === "button" && text(node).startsWith(label)); assert.equal(result.length, 1, label); return result[0]; },
    field(label) {
      const result = nodes(run.tree, (node) => node.type === "label" && text(node).startsWith(label));
      assert.equal(result.length, 1, label);
      return nodes(result[0], (node) => node.type === "input")[0];
    },
    open(side = "indoor") { run.button(`${side === "indoor" ? "Beltéri" : "Kültéri"} adattábla-fotók`).props.onClick(); run.render(); },
    recognize(photo = {}) {
      const gallery = nodes(run.tree, (node) => node.type === "test-device-photos");
      assert.equal(gallery.length, 1);
      gallery[0].props.onRecognizeSerial({ id: "photo-a", deviceId: "device-a", deviceSide: "indoor", ...photo });
    },
  };
  run.render();
  return run;
}

test("recognition only proposes a draft for the photographed side; explicit save preserves the opposite serial and technical data", async () => {
  for (const side of ["indoor", "outdoor"]) {
    const run = setup();
    const targetLabel = side === "indoor" ? "Beltéri sorozatszám" : "Kültéri sorozatszám";
    const oppositeLabel = side === "indoor" ? "Kültéri sorozatszám" : "Beltéri sorozatszám";
    const original = plain(run.props.device.data);
    run.open(side);
    run.recognize({ deviceSide: side });
    await tick(); run.render();
    assert.equal(run.field(targetLabel).props.value, original[`${side}Serial`]);
    assert.equal(run.calls.saves.length, 0, "Running recognition must not save a serial");
    run.open(side === "indoor" ? "outdoor" : "indoor");
    run.button("NEW-SERIAL003").props.onClick(); run.render();
    assert.equal(run.field(targetLabel).props.value, "NEW-SERIAL003", "Use the photographed side even after switching galleries");
    assert.equal(run.field(oppositeLabel).props.value, original[side === "indoor" ? "outdoorSerial" : "indoorSerial"]);
    assert.equal(run.calls.saves.length, 0, "Choosing a suggestion only edits the draft");
    assert.deepEqual(run.props.device.data, original, "Existing saved data stays unchanged until explicit save");
    run.button("Készülékadatok mentése").props.onClick();
    await tick(); run.render();
    assert.equal(run.calls.saves.length, 1);
    assert.deepEqual(run.calls.saves[0].data, { ...original, [`${side}Serial`]: "NEW-SERIAL003" });
    assert.strictEqual(run.calls.saves[0].context, run.props.context);
    assert.equal(run.calls.saved.length, 1);
  }
});

test("rapid duplicate recognition clicks start one download and one OCR request", async () => {
  const download = deferred();
  const run = setup({ download: () => download.promise });
  run.open();
  run.recognize(); run.recognize();
  assert.equal(run.calls.downloads.length, 1, "A state render is not needed to lock the request");
  download.resolve(new Blob(["synthetic"], { type: "image/jpeg" }));
  await tick(); run.render();
  assert.equal(run.calls.recognition.length, 1);
  run.recognize(); await tick(); run.render();
  assert.equal(run.calls.recognition.length, 2, "The lock is released when recognition finishes");
});

test("barcode results require checking the identifier against the S/N on the photo and explicit selection", async () => {
  const run = setup({ recognize: async () => ({ candidates: ["BARCODE006"], text: "BARCODE006", source: "barcode" }) });
  run.open(); run.recognize(); await tick(); run.render();
  assert.match(text(run.tree), /Vonalkódból beolvasott azonosító\. Ellenőrizd a képen, hogy az S\/N-hez tartozik/);
  assert.equal(run.field("Beltéri sorozatszám").props.value, "ORIGINAL-IN001");
  assert.equal(run.calls.saves.length, 0);
  run.button("BARCODE006").props.onClick(); run.render();
  assert.equal(run.field("Beltéri sorozatszám").props.value, "BARCODE006");
  assert.equal(run.calls.saves.length, 0, "Even a decoded barcode remains a draft until explicitly saved");
});

test("download failures are distinguished from safe OCR runtime and timeout messages", async () => {
  const privateError = new Error("Synthetic provider error with private diagnostic details");
  const run = setup({ download: async () => { throw privateError; } });
  run.open(); run.recognize(); await tick(); run.render();
  assert.match(text(run.tree), /Az adattábla-fotó nem tölthető be\. Próbáld újra\./);
  assert.doesNotMatch(text(run.tree), /private diagnostic|éles fotó|élesebb/);
  assert.equal(run.calls.recognition.length, 0);
  assert.equal(run.calls.errors.length, 0);

  for (const safeMessage of [
    "A felismerés túl sokáig tartott. Próbáld újra.",
    "A felismerő nem indult el vagy megszakadt. Ellenőrizd az internetkapcsolatot, majd próbáld újra.",
  ]) {
    const failed = setup({ recognize: async () => { throw privateError; }, safeMessage });
    failed.open(); failed.recognize(); await tick(); failed.render();
    assert.ok(text(failed.tree).includes(safeMessage));
    assert.doesNotMatch(text(failed.tree), /private diagnostic|éles fotó|nem tölthető be/);
    assert.strictEqual(failed.calls.errors[0], privateError);
    assert.equal(failed.calls.saves.length, 0);
  }
});

test("unmount during photo download prevents recognition and late state writes", async () => {
  for (const reject of [false, true]) {
    const download = deferred();
    const run = setup({ download: () => download.promise });
    run.open(); run.recognize(); run.runtime.unmount();
    if (reject) download.reject(new Error("Synthetic late download failure"));
    else download.resolve(new Blob(["synthetic"], { type: "image/jpeg" }));
    await tick();
    assert.equal(run.calls.recognition.length, 0);
    assert.equal(run.runtime.lateWrites, 0);
    assert.equal(run.calls.errors.length, 0);
  }
});

test("unmount aborts OCR and ignores late progress, results, and failure messages", async () => {
  for (const reject of [false, true]) {
    const recognition = deferred();
    const run = setup({ recognize: () => recognition.promise });
    run.open(); run.recognize(); await tick();
    assert.equal(run.calls.recognition.length, 1);
    const job = run.calls.recognition[0];
    run.runtime.unmount();
    assert.equal(job.signal.aborted, true);
    job.progress(99);
    if (reject) recognition.reject(new Error("Synthetic late OCR failure"));
    else recognition.resolve({ candidates: ["LATE004"], text: "S/N: LATE004" });
    await tick();
    assert.equal(run.runtime.lateWrites, 0);
    assert.equal(run.calls.errors.length, 0);
    assert.equal(run.calls.saves.length, 0);
  }
});

test("empty results preserve manual serials, and unrelated photos never start recognition", async () => {
  const run = setup({ recognize: async () => ({ candidates: [], text: "MODEL: TEST123" }) });
  run.open();
  run.recognize({ deviceId: "another-device" });
  run.recognize({ deviceSide: undefined });
  assert.equal(run.calls.downloads.length, 0);
  run.field("Beltéri sorozatszám").props.onChange({ target: { value: "MANUAL005" } });
  run.render(); run.recognize(); await tick(); run.render();
  assert.match(text(run.tree), /Nem találtam egyértelmű S\/N jelölést/);
  assert.equal(run.field("Beltéri sorozatszám").props.value, "MANUAL005");
  assert.equal(run.calls.saves.length, 0);
});
