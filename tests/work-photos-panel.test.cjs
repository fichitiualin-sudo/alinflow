const assert = require("node:assert/strict");
const { File } = require("node:buffer");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const test = require("node:test");
const ts = require("typescript");

// Exercise the panel's real session worker without mounting React or contacting Supabase.
function loadQueueManager() {
  const filename = path.resolve(__dirname, "../src/components/alinflow/WorkPhotosPanel.tsx");
  const nativeRequire = createRequire(filename);
  const loaded = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === "@/lib/alinflow/work-photos") return {
      WORK_PHOTO_PAGE_SIZE: 10,
      workPhotoErrorMessage: (error) => error.message,
      prepareWorkPhoto: async () => { throw new Error("Tests must inject preparation"); },
      uploadWorkPhoto: async () => { throw new Error("Tests must inject uploading"); },
    };
    if (specifier.startsWith("@/")) return {};
    return nativeRequire(specifier);
  };
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  });
  new Function("require", "module", "exports", outputText)(localRequire, loaded, loaded.exports);
  return loaded.exports.createWorkPhotoQueueManager;
}

const createWorkPhotoQueueManager = loadQueueManager();
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_A = "22222222-2222-4222-8222-222222222222";
const APPOINTMENT_A = "33333333-3333-4333-8333-333333333333";
const APPOINTMENT_B = "44444444-4444-4444-8444-444444444444";
const context = (overrides = {}) => ({ workspaceId: WORKSPACE_A, customerId: CUSTOMER_A, appointmentId: APPOINTMENT_A, appointmentType: "installation", workDate: "2026-09-13", workTime: "08:00", ...overrides });
const photoFile = (name = "work.jpg") => new File([name], name, { type: "image/jpeg" });
const prepared = (work, owner = USER_A) => {
  const id = crypto.randomUUID();
  const blob = new Blob(["compressed photo"], { type: "image/jpeg" });
  return { photo: { ...work, id, storagePath: `${work.workspaceId}/${work.customerId}/${work.appointmentId}/${id}.jpg`, sizeBytes: blob.size, width: 1200, height: 900, createdAt: "2026-09-13T10:00:00Z" }, blob, createdBy: owner };
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function setup(operations = {}) {
  const preparations = [];
  const uploads = [];
  const manager = createWorkPhotoQueueManager({
    prepareWorkPhoto: async (file, work) => {
      preparations.push({ file, context: { ...work } });
      return operations.prepareWorkPhoto ? operations.prepareWorkPhoto(file, work) : prepared(work);
    },
    uploadWorkPhoto: async (item) => {
      uploads.push(item);
      if (operations.uploadWorkPhoto) await operations.uploadWorkPhoto(item);
    },
  });
  manager.setUser(USER_A);
  return { manager, preparations, uploads };
}

test("navigation preserves all pending files in their original work and cannot start a second worker", async () => {
  const firstCompression = deferred();
  let compressionCount = 0;
  const { manager, preparations, uploads } = setup({ prepareWorkPhoto: async (_file, work) => ++compressionCount === 1 ? firstCompression.promise : prepared(work) });
  const selected = context();
  const original = manager.getSession(selected);
  const unsubscribe = original.subscribe(() => {});
  const pending = original.addFiles([photoFile("first.jpg"), photoFile("second.jpg")], selected);
  assert.equal(original.getSnapshot().busy, true);
  unsubscribe();
  Object.assign(selected, context({ appointmentId: APPOINTMENT_B, workDate: "2026-10-01" }));
  const other = manager.getSession(selected);
  assert.equal(other.getSnapshot().queue.length, 0);
  const remounted = manager.getSession(context());
  assert.strictEqual(remounted, original);
  assert.equal(remounted.getSnapshot().queue.length, 2);
  void remounted.retryFailed();
  firstCompression.resolve(prepared(context()));
  await pending;
  assert.equal(preparations.length, 2);
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every((item) => item.photo.appointmentId === APPOINTMENT_A && item.photo.workDate === "2026-09-13"));
  assert.deepEqual(original.getSnapshot().queue.map((entry) => entry.status), ["done", "done"]);
  assert.ok(original.getSnapshot().queue.every((entry) => !entry.file && !entry.prepared));
  assert.equal(other.getSnapshot().queue.length, 0);
  assert.equal(manager.hasUnfinishedUploads(), false);
});

test("an uncertain upload failing offscreen resumes the exact prepared photo on return", async () => {
  const firstUpload = deferred();
  const uploadStarted = deferred();
  let uploadCount = 0;
  const { manager, preparations, uploads } = setup({ uploadWorkPhoto: async () => {
    if (++uploadCount === 1) { uploadStarted.resolve(); await firstUpload.promise; }
  } });
  const original = manager.getSession(context());
  const unsubscribe = original.subscribe(() => {});
  const pending = original.addFiles([photoFile()], context());
  await uploadStarted.promise;
  unsubscribe();
  manager.getSession(context({ appointmentId: APPOINTMENT_B }));
  firstUpload.reject(new Error("The metadata response could not be verified"));
  await pending;
  assert.equal(manager.hasUnfinishedUploads(), true);
  const remounted = manager.getSession(context());
  const failed = remounted.getSnapshot().queue[0];
  assert.equal(failed.status, "error");
  assert.equal(failed.file, undefined);
  assert.strictEqual(failed.prepared, uploads[0]);
  await remounted.retryFailed();
  assert.equal(preparations.length, 1);
  assert.equal(uploads.length, 2);
  assert.strictEqual(uploads[0], uploads[1]);
  assert.equal(remounted.getSnapshot().queue[0].status, "done");
  assert.equal(remounted.getSnapshot().queue[0].prepared, undefined);
  assert.equal(manager.hasUnfinishedUploads(), false);
});

test("one failed file does not stop later files, and retry skips completed uploads", async () => {
  let rejectFirstFile = true;
  const { manager, preparations, uploads } = setup({ prepareWorkPhoto: async (file, work) => {
    if (file.name === "first.jpg" && rejectFirstFile) throw new Error("Temporary decoder failure");
    return prepared(work);
  } });
  const session = manager.getSession(context());
  const firstFile = photoFile("first.jpg");
  await session.addFiles([firstFile, photoFile("second.jpg")], context());
  assert.deepEqual(session.getSnapshot().queue.map((entry) => entry.status), ["error", "done"]);
  assert.strictEqual(session.getSnapshot().queue[0].file, firstFile);
  assert.equal(uploads.length, 1);
  rejectFirstFile = false;
  await session.retryFailed();
  assert.equal(preparations.length, 3);
  assert.equal(uploads.length, 2);
  assert.equal(session.getSnapshot().savedVersion, 2);
  assert.ok(session.getSnapshot().queue.every((entry) => entry.status === "done" && !entry.file && !entry.prepared));
});

test("rescheduling does not move a failed file snapshot when it is retried later", async () => {
  let fail = true;
  const { manager, preparations } = setup({ prepareWorkPhoto: async (_file, work) => {
    if (fail) throw new Error("Temporary decoder failure");
    return prepared(work);
  } });
  const session = manager.getSession(context());
  await session.addFiles([photoFile()], context());
  const rescheduled = context({ workDate: "2026-09-20", workTime: "16:00" });
  const revisited = manager.getSession(rescheduled);
  assert.strictEqual(revisited, session);
  fail = false;
  await revisited.retryFailed();
  assert.equal(preparations[1].context.workDate, "2026-09-13");
  await revisited.addFiles([photoFile("new-photo.jpg")], rescheduled);
  assert.equal(preparations[2].context.workDate, "2026-09-20");
});

test("failed files count toward the ten-file bound and preserve the unload warning offscreen", async () => {
  const { manager } = setup({ prepareWorkPhoto: async () => { throw new Error("Unreadable image"); } });
  const session = manager.getSession(context());
  await session.addFiles(Array.from({ length: 10 }, (_, index) => photoFile(`${index}.jpg`)), context());
  assert.equal(session.getSnapshot().busy, false);
  assert.equal(session.getSnapshot().queue.length, 10);
  assert.equal(manager.hasUnfinishedUploads(), true);
  assert.throws(() => session.addFiles([photoFile("eleventh.jpg")], context()), /legfeljebb 10 kép/);
  assert.equal(session.getSnapshot().queue.length, 10);
  for (const entry of session.getSnapshot().queue) session.removeFailed(entry.id);
  assert.equal(session.getSnapshot().queue.length, 0);
  assert.equal(manager.hasUnfinishedUploads(), false);
});

test("logout clears private queue data and stops an old compression before upload", async () => {
  const compression = deferred();
  const { manager, uploads } = setup({ prepareWorkPhoto: async () => compression.promise });
  const oldSession = manager.getSession(context());
  const pending = oldSession.addFiles([photoFile("private.jpg"), photoFile("pending.jpg")], context());
  manager.setUser(USER_A);
  assert.strictEqual(manager.getSession(context()), oldSession);
  manager.setUser(null);
  assert.equal(oldSession.getSnapshot().queue.length, 0);
  assert.equal(manager.getSession(context()), null);
  assert.equal(manager.hasUnfinishedUploads(), false);
  manager.setUser(USER_B);
  const newSession = manager.getSession(context());
  assert.notStrictEqual(newSession, oldSession);
  assert.equal(newSession.getSnapshot().queue.length, 0);
  compression.resolve(prepared(context()));
  await pending;
  assert.equal(uploads.length, 0);
  assert.equal(oldSession.getSnapshot().queue.length, 0);
  assert.equal(newSession.getSnapshot().queue.length, 0);
  assert.throws(() => oldSession.addFiles([photoFile()], context()), /jelentkezz be újra/);
});

test("an old in-flight upload cannot repopulate private state after the authenticated user changes", async () => {
  const upload = deferred();
  const uploadStarted = deferred();
  const { manager, preparations } = setup({ uploadWorkPhoto: async () => { uploadStarted.resolve(); await upload.promise; } });
  const oldSession = manager.getSession(context());
  const pending = oldSession.addFiles([photoFile("private.jpg"), photoFile("pending.jpg")], context());
  await uploadStarted.promise;
  manager.setUser(USER_B);
  const newSession = manager.getSession(context());
  upload.reject(new Error("Unknown upload result"));
  await pending;
  assert.equal(preparations.length, 1);
  assert.equal(oldSession.getSnapshot().queue.length, 0);
  assert.equal(newSession.getSnapshot().queue.length, 0);
  assert.equal(manager.hasUnfinishedUploads(), false);
});

test("a preparation under another auth owner never uploads through the previous user's session", async () => {
  const { manager, uploads } = setup({ prepareWorkPhoto: async (_file, work) => prepared(work, USER_B) });
  const session = manager.getSession(context());
  await session.addFiles([photoFile()], context());
  assert.equal(uploads.length, 0);
  assert.equal(session.getSnapshot().queue[0].status, "error");
  assert.match(session.getSnapshot().queue[0].error, /bejelentkezés megváltozott/);
});
