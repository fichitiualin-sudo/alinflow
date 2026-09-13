const assert = require("node:assert/strict");
const { File } = require("node:buffer");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const test = require("node:test");
const ts = require("typescript");

// Load the real TypeScript helpers without touching credentials or the real Supabase singleton.
// This loader is local to this test file; it does not replace Node's global module hooks.
function loadTypeScript(filename, cache = new Map()) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const loaded = { exports: {} };
  cache.set(filename, loaded);
  const nativeRequire = createRequire(filename);
  const localRequire = (specifier) => {
    if (specifier === "@/lib/supabase") return { supabase: { storage: { from: () => ({}) } } };
    if (specifier.startsWith(".")) {
      const candidate = path.resolve(path.dirname(filename), `${specifier}.ts`);
      if (fs.existsSync(candidate)) return loadTypeScript(candidate, cache);
    }
    return nativeRequire(specifier);
  };
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  new Function("require", "module", "exports", outputText)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

const { createWorkPhotoStore, workPhotoContext } = loadTypeScript(path.resolve(__dirname, "../src/lib/alinflow/work-photos.ts"));
const CUSTOMER_A = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_B = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_A = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_B = "44444444-4444-4444-8444-444444444444";
const APPOINTMENT_A = "55555555-5555-4555-8555-555555555555";
const APPOINTMENT_B = "66666666-6666-4666-8666-666666666666";
const APPOINTMENT_C = "77777777-7777-4777-8777-777777777777";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const context = (overrides = {}) => ({
  workspaceId: WORKSPACE_A, customerId: CUSTOMER_A, appointmentId: APPOINTMENT_A,
  appointmentType: "installation", workDate: "2026-09-13", workTime: "08:00", ...overrides,
});
const jpeg = (content = "compressed JPEG fixture") => new Blob([content], { type: "image/jpeg" });
const file = () => new File(["source image fixture"], "work.jpg", { type: "image/jpeg" });
const compress = async () => ({ blob: jpeg(), width: 1600, height: 1200 });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function rowFor(prepared) {
  const photo = prepared.photo;
  return {
    id: photo.id, workspace_id: photo.workspaceId, customer_id: photo.customerId, appointment_id: photo.appointmentId,
    appointment_type: photo.appointmentType,
    work_date: photo.workDate, work_time: photo.workTime, storage_path: photo.storagePath,
    size_bytes: photo.sizeBytes, width: photo.width, height: photo.height,
    created_by: prepared.createdBy, created_at: photo.createdAt,
  };
}

function createBackend() {
  const backend = {
    rows: new Map(), objects: new Map(), userId: USER_A, authError: null,
    lookupPlans: [], uploadPlans: [], insertPlans: [], signPlans: [], removePlans: [],
    calls: { lookups: [], uploads: [], inserts: [], downloads: [], removes: [], ranges: [], signs: [] },
  };
  const storage = {
    async upload(objectPath, blob, options) {
      backend.calls.uploads.push({ path: objectPath, blob, options });
      const plan = backend.uploadPlans.shift();
      if (!plan && backend.objects.has(objectPath)) return { error: { statusCode: "409", message: "The resource already exists" } };
      if (!plan?.error || plan.commit) backend.objects.set(objectPath, blob);
      return { data: plan?.error ? null : { path: objectPath }, error: plan?.error || null };
    },
    async download(objectPath) {
      backend.calls.downloads.push(objectPath);
      const blob = backend.objects.get(objectPath);
      return { data: blob || null, error: blob ? null : { message: "Object not found" } };
    },
    async remove(paths) {
      backend.calls.removes.push([...paths]);
      const plan = backend.removePlans.shift();
      if (plan?.error) return { error: plan.error };
      paths.forEach((objectPath) => backend.objects.delete(objectPath));
      return { data: paths, error: null };
    },
    async createSignedUrls(paths, lifetime) {
      backend.calls.signs.push({ paths: [...paths], lifetime });
      const plan = backend.signPlans.shift();
      return plan || { data: paths.map((objectPath) => ({ path: objectPath, signedUrl: `https://photos.invalid/${objectPath}?signed=1` })), error: null };
    },
  };
  backend.client = {
    auth: { getUser: async () => ({ data: { user: backend.userId ? { id: backend.userId } : null }, error: backend.authError }) },
    storage: { from(bucket) { assert.equal(bucket, "work-photos"); return storage; } },
    from(table) {
      assert.equal(table, "work_photos");
      const filters = [];
      const ordering = [];
      const builder = {
        select() { return builder; },
        eq(column, value) { filters.push([column, value]); return builder; },
        order(column, options) { ordering.push([column, options]); return builder; },
        async maybeSingle() {
          backend.calls.lookups.push([...filters]);
          const plan = backend.lookupPlans.shift();
          if (plan) return plan;
          const data = [...backend.rows.values()].find((row) => filters.every(([column, value]) => row[column] === value));
          return { data: data ? { ...data } : null, error: null };
        },
        async insert(row) {
          backend.calls.inserts.push({ ...row });
          const plan = backend.insertPlans.shift();
          if (!plan && backend.rows.has(row.id)) return { error: { code: "23505", message: "Duplicate id" } };
          if (!plan?.error || plan.commit) backend.rows.set(row.id, { ...row, created_at: "2026-09-13T10:00:00.000Z" });
          return { data: null, error: plan?.error || null };
        },
        async range(start, end) {
          backend.calls.ranges.push({ filters: [...filters], start, end });
          const rows = [...backend.rows.values()].filter((row) => filters.every(([column, value]) => row[column] === value));
          rows.sort((a, b) => {
            for (const [column, options] of ordering) {
              const compared = String(a[column]).localeCompare(String(b[column]));
              if (compared) return options.ascending ? compared : -compared;
            }
            return 0;
          });
          return { data: rows.slice(start, end + 1).map((row) => ({ ...row })), error: null };
        },
      };
      return builder;
    },
  };
  return backend;
}

function setup(compressor = compress) {
  const backend = createBackend();
  return { backend, store: createWorkPhotoStore(backend.client, compressor) };
}

test("work contexts require workspace, customer and saved appointment ids plus a real date", () => {
  const customer = { id: CUSTOMER_A, activeAppointmentId: APPOINTMENT_A, date: "2026-09-13", appointmentType: "karbantartás" };
  assert.deepEqual(workPhotoContext(customer, WORKSPACE_A), context({ appointmentType: "maintenance", workTime: "" }));
  assert.equal(workPhotoContext({ ...customer, id: "not-a-uuid" }, WORKSPACE_A), null);
  assert.equal(workPhotoContext({ ...customer, date: undefined }, WORKSPACE_A), null);
  assert.equal(workPhotoContext({ ...customer, date: "2026-02-30" }, WORKSPACE_A), null);
  assert.equal(workPhotoContext(customer, undefined), null);
  assert.equal(workPhotoContext(customer, "legacy-workspace"), null);
  assert.equal(workPhotoContext({ ...customer, activeAppointmentId: undefined, activeWorkReportId: APPOINTMENT_A }, WORKSPACE_A), null);
  assert.equal(workPhotoContext({ ...customer, activeAppointmentId: `jobs:${APPOINTMENT_A}` }, WORKSPACE_A), null);
});

test("missing or legacy work scope cannot prepare photos or issue a gallery query", async (t) => {
  for (const invalidScope of [
    context({ workspaceId: undefined }), context({ workspaceId: "old-company" }),
    context({ customerId: "local-customer" }), context({ appointmentId: undefined }),
    context({ appointmentId: `jobs:${APPOINTMENT_A}` }),
  ]) {
    await t.test(JSON.stringify(invalidScope), async () => {
      let compressionCalls = 0;
      const { backend, store } = setup(async () => { compressionCalls += 1; return compress(); });
      await assert.rejects(store.prepareWorkPhoto(file(), invalidScope), /mentsd el az időpontot/);
      assert.deepEqual(await store.listWorkPhotos(invalidScope, 0), { photos: [], hasMore: false });
      assert.equal(compressionCalls, 0);
      assert.equal(backend.calls.ranges.length, 0);
      assert.equal(backend.calls.signs.length, 0);
    });
  }
});

test("preparation snapshots the work before awaiting authentication and compression", async () => {
  const compressionStarted = deferred();
  const compressionDone = deferred();
  const { backend, store } = setup(async () => { compressionStarted.resolve(); return compressionDone.promise; });
  const selected = context();
  const pending = store.prepareWorkPhoto(file(), selected);
  Object.assign(selected, context({ workspaceId: WORKSPACE_B, customerId: CUSTOMER_B, appointmentId: APPOINTMENT_B, workDate: "2026-10-01", workTime: "12:00", appointmentType: "maintenance" }));
  await compressionStarted.promise;
  compressionDone.resolve(await compress());
  const prepared = await pending;
  await store.uploadWorkPhoto(prepared);
  const saved = backend.rows.get(prepared.photo.id);
  assert.equal(saved.workspace_id, WORKSPACE_A);
  assert.equal(saved.customer_id, CUSTOMER_A);
  assert.equal(saved.appointment_id, APPOINTMENT_A);
  assert.equal(saved.storage_path, `${WORKSPACE_A}/${CUSTOMER_A}/${APPOINTMENT_A}/${prepared.photo.id}.jpg`);
  assert.equal(saved.work_date, "2026-09-13");
  assert.equal(saved.work_time, "08:00");
  assert.equal(saved.appointment_type, "installation");
  assert.equal(prepared.createdBy, USER_A);
});

test("workspaces, customers and repeated maintenance appointments retain separate photos", async () => {
  const { backend, store } = setup();
  const contexts = [
    context(), context({ appointmentId: APPOINTMENT_B, appointmentType: "maintenance", workDate: "2026-10-01" }),
    context({ appointmentId: APPOINTMENT_C, appointmentType: "maintenance", workDate: "2027-10-01" }),
    context({ customerId: CUSTOMER_B }), context({ workspaceId: WORKSPACE_B }),
  ];
  const prepared = [];
  for (const work of contexts) {
    const photo = await store.prepareWorkPhoto(file(), work);
    prepared.push(photo);
    await store.uploadWorkPhoto(photo);
  }
  assert.equal(backend.rows.size, 5);
  assert.equal(backend.objects.size, 5);
  assert.equal(new Set(prepared.map((item) => item.photo.id)).size, 5);
  for (const [index, item] of prepared.entries()) {
    const saved = backend.rows.get(item.photo.id);
    assert.equal(saved.workspace_id, contexts[index].workspaceId);
    assert.equal(saved.customer_id, contexts[index].customerId);
    assert.equal(saved.appointment_id, contexts[index].appointmentId);
    assert.equal(saved.work_date, contexts[index].workDate);
    assert.equal(saved.appointment_type, contexts[index].appointmentType);
    assert.strictEqual(backend.objects.get(saved.storage_path), item.blob);
    const gallery = await store.listWorkPhotos(contexts[index], 0);
    assert.deepEqual(gallery.photos.map((photo) => photo.id), [item.photo.id]);
  }
});

test("rescheduling a saved appointment keeps its earlier photos with their original date snapshot", async () => {
  const { store } = setup();
  const original = await store.prepareWorkPhoto(file(), context());
  await store.uploadWorkPhoto(original);
  const rescheduled = context({ workDate: "2026-09-20", workTime: "16:00" });
  const another = await store.prepareWorkPhoto(file(), rescheduled);
  await store.uploadWorkPhoto(another);
  const gallery = await store.listWorkPhotos(rescheduled, 0);
  assert.equal(gallery.photos.length, 2);
  const byId = new Map(gallery.photos.map((photo) => [photo.id, photo]));
  assert.equal(byId.get(original.photo.id).workDate, "2026-09-13");
  assert.equal(byId.get(original.photo.id).workTime, "08:00");
  assert.equal(byId.get(another.photo.id).workDate, "2026-09-20");
  assert.ok(gallery.photos.every((photo) => photo.appointmentId === APPOINTMENT_A));
});

test("retrying existing matching metadata does not upload or insert a duplicate", async () => {
  const { backend, store } = setup();
  const prepared = await store.prepareWorkPhoto(file(), context());
  backend.rows.set(prepared.photo.id, rowFor(prepared));
  backend.objects.set(prepared.photo.storagePath, prepared.blob);
  await store.uploadWorkPhoto(prepared);
  await store.uploadWorkPhoto(prepared);
  assert.equal(backend.rows.size, 1);
  assert.equal(backend.calls.uploads.length, 0);
  assert.equal(backend.calls.inserts.length, 0);
});

test("existing metadata for a different work is rejected without overwriting or deleting", async () => {
  const { backend, store } = setup();
  const prepared = await store.prepareWorkPhoto(file(), context());
  const conflicting = { ...rowFor(prepared), work_date: "2026-09-14" };
  backend.rows.set(prepared.photo.id, conflicting);
  await assert.rejects(store.uploadWorkPhoto(prepared), /más feltöltéshez/);
  assert.deepEqual(backend.rows.get(prepared.photo.id), conflicting);
  assert.equal(backend.calls.uploads.length, 0);
  assert.equal(backend.calls.removes.length, 0);
});

test("a lost upload response is recovered by checking the already stored blob", async () => {
  const { backend, store } = setup();
  const prepared = await store.prepareWorkPhoto(file(), context());
  backend.uploadPlans.push({ commit: true, error: { message: "Network timeout" } });
  await store.uploadWorkPhoto(prepared);
  assert.equal(backend.rows.size, 1);
  assert.deepEqual(backend.calls.downloads, [prepared.photo.storagePath]);
  assert.deepEqual(await backend.objects.get(prepared.photo.storagePath).arrayBuffer(), await prepared.blob.arrayBuffer());
  assert.equal(backend.calls.uploads[0].options.upsert, false);
  assert.equal(backend.calls.removes.length, 0);
});

test("a same-size conflicting blob cannot be treated as a successful upload", async () => {
  const { backend, store } = setup();
  const prepared = await store.prepareWorkPhoto(file(), context());
  const otherBlob = jpeg("x".repeat(prepared.blob.size));
  backend.objects.set(prepared.photo.storagePath, otherBlob);
  await assert.rejects(store.uploadWorkPhoto(prepared));
  assert.equal(backend.rows.size, 0);
  assert.strictEqual(backend.objects.get(prepared.photo.storagePath), otherBlob);
  assert.equal(backend.calls.removes.length, 0);
});

test("a definite insert rejection removes only its unreferenced object and retry reuses the id", async () => {
  const { backend, store } = setup();
  const prepared = await store.prepareWorkPhoto(file(), context());
  const unrelated = `${WORKSPACE_B}/${CUSTOMER_B}/${APPOINTMENT_B}/unrelated.jpg`;
  backend.objects.set(unrelated, jpeg("leave this existing photo alone"));
  backend.insertPlans.push({ error: { code: "42501", message: "Permission denied" } });
  await assert.rejects(store.uploadWorkPhoto(prepared));
  assert.equal(backend.rows.size, 0);
  assert.equal(backend.objects.has(prepared.photo.storagePath), false);
  assert.equal(backend.objects.has(unrelated), true);
  assert.deepEqual(backend.calls.removes, [[prepared.photo.storagePath]]);
  await store.uploadWorkPhoto(prepared);
  assert.equal(backend.rows.size, 1);
  assert.equal(backend.calls.inserts[0].id, backend.calls.inserts[1].id);
  assert.equal(backend.calls.uploads[0].path, backend.calls.uploads[1].path);
});

test("a lost metadata response that already committed succeeds without deleting the photo", async () => {
  const { backend, store } = setup();
  const prepared = await store.prepareWorkPhoto(file(), context());
  backend.insertPlans.push({ commit: true, error: { message: "Network timeout" } });
  await store.uploadWorkPhoto(prepared);
  assert.equal(backend.rows.size, 1);
  assert.equal(backend.objects.has(prepared.photo.storagePath), true);
  assert.equal(backend.calls.removes.length, 0);
  await store.uploadWorkPhoto(prepared);
  assert.equal(backend.calls.uploads.length, 1);
  assert.equal(backend.calls.inserts.length, 1);
});

test("failed verification after an insert never removes a possibly referenced photo", async () => {
  const { backend, store } = setup();
  const prepared = await store.prepareWorkPhoto(file(), context());
  backend.lookupPlans.push({ data: null, error: null }, { data: null, error: { message: "Network timeout" } });
  backend.insertPlans.push({ commit: true, error: { code: "08006", message: "Connection lost" } });
  await assert.rejects(store.uploadWorkPhoto(prepared), /nem sikerült ellenőrizni/);
  assert.equal(backend.rows.size, 1);
  assert.equal(backend.objects.has(prepared.photo.storagePath), true);
  assert.equal(backend.calls.removes.length, 0);
  await store.uploadWorkPhoto(prepared);
  assert.equal(backend.calls.uploads.length, 1);
});

test("an uncertain uncommitted metadata result keeps the blob and retry completes the same photo", async () => {
  const { backend, store } = setup();
  const prepared = await store.prepareWorkPhoto(file(), context());
  backend.insertPlans.push({ error: { message: "Failed to fetch" } });
  await assert.rejects(store.uploadWorkPhoto(prepared));
  assert.equal(backend.rows.size, 0);
  assert.equal(backend.objects.has(prepared.photo.storagePath), true);
  assert.equal(backend.calls.removes.length, 0);
  await store.uploadWorkPhoto(prepared);
  assert.equal(backend.rows.size, 1);
  assert.equal(backend.objects.size, 1);
  assert.equal(backend.calls.inserts[0].id, backend.calls.inserts[1].id);
  assert.deepEqual(backend.calls.downloads, [prepared.photo.storagePath]);
});

test("failed initial verification does not attempt an upload or cleanup", async () => {
  const { backend, store } = setup();
  const prepared = await store.prepareWorkPhoto(file(), context());
  backend.lookupPlans.push({ data: null, error: { message: "Failed to fetch" } });
  await assert.rejects(store.uploadWorkPhoto(prepared));
  assert.equal(backend.calls.uploads.length, 0);
  assert.equal(backend.calls.inserts.length, 0);
  assert.equal(backend.calls.removes.length, 0);
});

test("logout and a different authenticated user cannot upload a prepared photo", async (t) => {
  for (const userId of [null, USER_B]) {
    await t.test(userId ? "another user" : "logged out", async () => {
      const { backend, store } = setup();
      const prepared = await store.prepareWorkPhoto(file(), context());
      backend.userId = userId;
      await assert.rejects(store.uploadWorkPhoto(prepared), /bejelentkezés megváltozott|jelentkezz be újra/);
      assert.equal(backend.calls.lookups.length, 0);
      assert.equal(backend.calls.uploads.length, 0);
      assert.equal(backend.calls.inserts.length, 0);
    });
  }
});

test("oversized and invalid prepared photos are rejected before accessing storage", async (t) => {
  const mutations = {
    "over 500 kB": (item) => { item.blob = jpeg(new Uint8Array(500_001)); item.photo.sizeBytes = item.blob.size; },
    "empty blob": (item) => { item.blob = jpeg(""); item.photo.sizeBytes = 0; },
    "non-JPEG blob": (item) => { item.blob = new Blob(["PNG"], { type: "image/png" }); item.photo.sizeBytes = item.blob.size; },
    "incorrect stored size": (item) => { item.photo.sizeBytes += 1; },
    "zero width": (item) => { item.photo.width = 0; },
    "over 1920 pixels": (item) => { item.photo.height = 1921; },
    "legacy storage path": (item) => { item.photo.storagePath = `${CUSTOMER_A}/${item.photo.id}.jpg`; },
    "wrong workspace storage path": (item) => { item.photo.storagePath = `${WORKSPACE_B}/${CUSTOMER_A}/${APPOINTMENT_A}/${item.photo.id}.jpg`; },
    "wrong customer storage path": (item) => { item.photo.storagePath = `${WORKSPACE_A}/${CUSTOMER_B}/${APPOINTMENT_A}/${item.photo.id}.jpg`; },
    "wrong appointment storage path": (item) => { item.photo.storagePath = `${WORKSPACE_A}/${CUSTOMER_A}/${APPOINTMENT_B}/${item.photo.id}.jpg`; },
    "missing workspace": (item) => { item.photo.workspaceId = undefined; },
    "legacy appointment id": (item) => { item.photo.appointmentId = `jobs:${APPOINTMENT_A}`; },
    "invalid photo id": (item) => { item.photo.id = "local-photo"; },
    "NaN width": (item) => { item.photo.width = NaN; },
    "fractional height": (item) => { item.photo.height = 1.5; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async () => {
      const { backend, store } = setup();
      const prepared = await store.prepareWorkPhoto(file(), context());
      mutate(prepared);
      await assert.rejects(store.uploadWorkPhoto(prepared), /tömörítése nem megfelelő/);
      assert.equal(backend.calls.lookups.length, 0);
      assert.equal(backend.calls.uploads.length, 0);
      assert.equal(backend.calls.inserts.length, 0);
    });
  }
});

test("pagination stays within the exact workspace/customer/appointment and signs only ten returned photos", async () => {
  const { backend, store } = setup();
  for (let index = 0; index < 25; index += 1) {
    const prepared = await store.prepareWorkPhoto(file(), context({ workDate: index < 12 ? "2026-09-13" : "2026-10-01" }));
    backend.rows.set(prepared.photo.id, { ...rowFor(prepared), created_at: new Date(Date.UTC(2026, 8, 13, 10, index)).toISOString() });
  }
  for (const otherContext of [context({ customerId: CUSTOMER_B }), context({ workspaceId: WORKSPACE_B }), context({ appointmentId: APPOINTMENT_B })]) {
    const other = await store.prepareWorkPhoto(file(), otherContext);
    backend.rows.set(other.photo.id, { ...rowFor(other), created_at: "2027-01-01T00:00:00Z" });
  }
  const first = await store.listWorkPhotos(context(), 0);
  const second = await store.listWorkPhotos(context(), 1);
  const third = await store.listWorkPhotos(context(), 2);
  assert.deepEqual([first.photos.length, second.photos.length, third.photos.length], [10, 10, 5]);
  assert.deepEqual([first.hasMore, second.hasMore, third.hasMore], [true, true, false]);
  const allPhotos = [...first.photos, ...second.photos, ...third.photos];
  assert.equal(new Set(allPhotos.map((photo) => photo.id)).size, 25);
  assert.ok(allPhotos.every((photo) => photo.workspaceId === WORKSPACE_A && photo.customerId === CUSTOMER_A && photo.appointmentId === APPOINTMENT_A && photo.url && !photo.urlError));
  assert.ok(first.photos.every((photo) => photo.workDate === "2026-10-01" && photo.appointmentType === "installation"));
  assert.deepEqual(backend.calls.signs.map((call) => call.paths.length), [10, 10, 5]);
  assert.deepEqual(backend.calls.signs[0].paths, first.photos.map((photo) => photo.storagePath));
  assert.deepEqual(backend.calls.ranges.map(({ start, end }) => [start, end]), [[0, 10], [10, 20], [20, 30]]);
  assert.ok(backend.calls.ranges.every((call) => [
    ["workspace_id", WORKSPACE_A], ["customer_id", CUSTOMER_A], ["appointment_id", APPOINTMENT_A],
  ].every(([column, value]) => call.filters.some(([actualColumn, actualValue]) => actualColumn === column && actualValue === value))));
});

test("a signed-URL failure retains metadata with a retryable preview error", async () => {
  const { backend, store } = setup();
  const prepared = await store.prepareWorkPhoto(file(), context());
  backend.rows.set(prepared.photo.id, rowFor(prepared));
  backend.signPlans.push({ data: null, error: { message: "Network timeout" } });
  const result = await store.listWorkPhotos(context(), 0);
  assert.equal(result.photos.length, 1);
  assert.equal(result.photos[0].id, prepared.photo.id);
  assert.equal(result.photos[0].url, undefined);
  assert.match(result.photos[0].urlError, /előnézete nem tölthető be/);
  assert.equal(backend.rows.size, 1);
  assert.equal(backend.calls.removes.length, 0);
});

test("individual missing or failed signed URLs do not hide the other photos", async () => {
  const { backend, store } = setup();
  const prepared = [];
  for (let index = 0; index < 3; index += 1) {
    const item = await store.prepareWorkPhoto(file(), context());
    prepared.push(item);
    backend.rows.set(item.photo.id, rowFor(item));
  }
  backend.signPlans.push({ data: [
    { path: prepared[0].photo.storagePath, signedUrl: "https://photos.invalid/available.jpg" },
    { path: prepared[1].photo.storagePath, signedUrl: "", error: "Object unavailable" },
  ], error: null });
  const { photos } = await store.listWorkPhotos(context(), 0);
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  assert.equal(photos.length, 3);
  assert.equal(byId.get(prepared[0].photo.id).url, "https://photos.invalid/available.jpg");
  assert.equal(byId.get(prepared[0].photo.id).urlError, undefined);
  assert.ok(byId.get(prepared[1].photo.id).urlError);
  assert.ok(byId.get(prepared[2].photo.id).urlError);
});
