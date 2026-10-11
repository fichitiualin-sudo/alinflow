const assert = require("node:assert/strict");
const test = require("node:test");
const { harness, database } = require("./helpers.cjs");
const h = harness();
const origin = h.load("src/lib/alinflow/maintenance-origin.ts");
const appointments = h.load("src/lib/alinflow/appointments.ts");
const records = h.load("src/lib/alinflow/appointment-records.ts");
const plain = value => JSON.parse(JSON.stringify(value));

test("legacy mapping stays own, source is trimmed and not retained on own", () => {
  assert.equal(origin.maintenanceOriginFromRow(undefined).maintenanceOrigin, "own");
  assert.equal(origin.maintenanceOriginFromRow({ maintenance_origin: "own", maintenance_source_name: "Other" }).maintenanceSourceName, undefined);
  assert.equal(origin.maintenanceOriginFromRow({ maintenance_origin: "external", maintenance_source_name: " Partner " }).maintenanceSourceName, "Partner");
  assert.deepEqual(plain(origin.maintenanceOriginPayload("own", "Partner")), { maintenance_origin: "own", maintenance_source_name: null });
  assert.throws(() => origin.maintenanceOriginPayload("invalid", ""));
  assert.throws(() => origin.maintenanceOriginPayload("external", "x".repeat(161)));
  assert.throws(() => origin.maintenanceOriginPayload("external", "A\nB"));
});

test("legacy job compatibility preserves the appointment's classification", () => {
  const rows = records.compatibleAppointmentRows([
    { id: "installation", legacy_source_key: "jobs:old-job", maintenance_origin: "external", maintenance_source_name: "Partner", updated_at: "2026-01-01" },
  ], [{ id: "old-job", scheduled_date: "2026-02-01", updated_at: "2026-02-01" }]);
  assert.equal(rows[0].maintenance_origin, "external");
  assert.equal(rows[0].maintenance_source_name, "Partner");
});

function fixture(options = {}) {
  const point = { appointmentId: "installation", customerId: "customer", customer: { appointmentType: "installation" } };
  const state = { workspace: "workspace", patches: [], messages: [], writes: [], pending: new Set(), draft: options.draft, draftWrites: [] };
  const loadRef = { current: options.loadGate || null };
  const db = database(async op => {
    state.writes.push(op);
    if (options.gate) await options.gate;
    if (options.reject) throw new Error("offline");
    if (options.error) return { data: null, error: options.error };
    return { error: null, data: options.noRow ? null : { id: point.appointmentId, customer_id: point.customerId, ...op.value } };
  });
  const f = h.functions(["saveMaintenanceOrigin"], {
    ...origin, ...appointments, currentWorkspaceId: () => state.workspace,
    beginAction: key => { if (state.pending.has(key)) return false; state.pending.add(key); return true; },
    endAction: key => state.pending.delete(key),
    setMessage: (message, tone) => state.messages.push({ message, tone }),
    loadCustomersPromiseRef: loadRef,
    readCustomerDraft: () => state.draft,
    writeCustomerDraft: draft => { state.draft = draft; state.draftWrites.push(draft); },
    setDraftNotice: () => {},
    patchAppointmentMapData: (id, patch) => state.patches.push({ id, patch }),
    supabase: { from: table => {
      const q = db.from(table);
      q.or = expression => { assert.equal(expression, "appointment_type.is.null,appointment_type.eq.installation"); return q; };
      return q;
    } },
  });
  return { state, point, loadRef, save: (kind = "external", source = " Partner ", expected = "workspace") => f.saveMaintenanceOrigin(point, kind, source, expected) };
}

test("classification save scopes workspace/customer/installation and patches only after confirmed row", async () => {
  const run = fixture();
  assert.equal(await run.save(), true);
  const op = run.state.writes[0];
  assert.equal(op.table, "appointments");
  assert.deepEqual(op.filters, { workspace_id: "workspace", customer_id: "customer", id: "installation" });
  assert.deepEqual(plain(op.value), { maintenance_origin: "external", maintenance_source_name: "Partner" });
  assert.deepEqual(plain(run.state.patches), [{ id: "installation", patch: { maintenanceOrigin: "external", maintenanceSourceName: "Partner" } }]);
  assert.equal(run.state.pending.size, 0);
});

for (const options of [{ noRow: true }, { error: { code: "PGRST204", message: "maintenance_origin schema cache" } }, { reject: true }]) {
  test(`failed save preserves local data (${JSON.stringify(options)})`, async () => {
    const run = fixture(options);
    assert.equal(await run.save(), false);
    assert.equal(run.state.patches.length, 0);
    assert.equal(run.state.messages.at(-1).tone, "error");
    assert.equal(run.state.pending.size, 0);
  });
}

test("stale editor cannot write another workspace and non-installation cannot be classified", async () => {
  const run = fixture();
  assert.equal(await run.save("external", "Partner", "old-workspace"), false);
  run.point.customer.appointmentType = "maintenance";
  assert.equal(await run.save(), false);
  assert.equal(run.state.writes.length, 0);
});

test("successful classification updates only the matching draft's origin and preserves unsaved edits", async () => {
  const draft = { customer: { id: "customer", activeAppointmentId: "installation", maintenanceOrigin: "own", notes: "Unsaved note" },
    quoteItems: [{ customName: "Unsaved AC", quantity: 3 }], scheduleDate: "2027-01-02", editCustomer: true };
  const run = fixture({ draft });
  assert.equal(await run.save(), true);
  assert.deepEqual(plain(run.state.draft), { ...draft, customer: { ...draft.customer, maintenanceOrigin: "external", maintenanceSourceName: "Partner" } });
  assert.equal(run.state.draftWrites.length, 1);
  assert.equal(draft.customer.maintenanceOrigin, "own", "original snapshot is not mutated");
});

test("classification save does not change another appointment's draft", async () => {
  const draft = { customer: { id: "customer", activeAppointmentId: "other-installation", maintenanceOrigin: "own" } };
  const run = fixture({ draft });
  assert.equal(await run.save(), true);
  assert.equal(run.state.draft, draft);
  assert.equal(run.state.draftWrites.length, 0);
});

test("classification patch lands after a background load that read the old origin", async () => {
  let release;
  const loadGate = new Promise(resolve => { release = resolve; });
  const run = fixture({ loadGate });
  const pending = run.save();
  await new Promise(done => setImmediate(done));
  assert.equal(run.state.writes.length, 1, "database save already succeeded");
  assert.equal(run.state.patches.length, 0, "old read has not finished yet");
  run.state.patches.push({ id: "installation", patch: { maintenanceOrigin: "own" }, source: "old read" });
  release();
  assert.equal(await pending, true);
  assert.equal(run.state.patches.at(-1).patch.maintenanceOrigin, "external");
});

test("workspace is rechecked after waiting for an old background load", async () => {
  let release;
  const run = fixture({ loadGate: new Promise(resolve => { release = resolve; }) });
  const pending = run.save();
  await new Promise(done => setImmediate(done));
  const messageCount = run.state.messages.length;
  run.state.workspace = "new-workspace";
  release();
  assert.equal(await pending, false);
  assert.equal(run.state.patches.length, 0);
  assert.equal(run.state.messages.length, messageCount);
});

for (const reject of [false, true]) {
  test(`workspace switch during ${reject ? "failed" : "successful"} save does not patch or notify new workspace`, async () => {
    let resolve;
    const gate = new Promise(done => { resolve = done; });
    const run = fixture({ gate, reject });
    const pending = run.save();
    await new Promise(done => setImmediate(done));
    const messagesBeforeSwitch = run.state.messages.length;
    assert.equal(await run.save(), false, "second pending save is ignored");
    run.state.workspace = "new-workspace";
    resolve();
    assert.equal(await pending, false);
    assert.equal(run.state.patches.length, 0);
    assert.equal(run.state.messages.length, messagesBeforeSwitch);
    assert.equal(run.state.pending.size, 0);
  });
}
