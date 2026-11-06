const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness, noop } = require("./helpers.cjs");
const h = harness({}, { react: React, "react/jsx-runtime": require("react/jsx-runtime") });
const phone = h.load("src/lib/alinflow/phone-calls.ts");
const { PhoneCallNotes } = h.load("src/components/alinflow/PhoneCallNotes.tsx");
const plain = value => JSON.parse(JSON.stringify(value));
const record = (id = "call", extra = {}) => ({ id, kind: "initiated", occurredAt: "2026-01-02T08:30:00Z",
  recordedAt: "2026-01-02T08:30:01Z", actorName: "Synthetic installer", installationId: null, ...extra });

test("manual local timestamps resolve Budapest summer and winter offsets without depending on device timezone", () => {
  const now = new Date("2027-01-01T00:00:00Z");
  assert.equal(phone.budapestPhoneCallTimeToIso("2026-01-02T09:30", now), "2026-01-02T08:30:00.000Z");
  assert.equal(phone.budapestPhoneCallTimeToIso("2026-07-02T09:30", now), "2026-07-02T07:30:00.000Z");
  assert.equal(phone.formatPhoneCallTime("2026-07-02T07:30:00Z"), "2026.07.02. 09:30");
  assert.equal(phone.budapestPhoneCallInputValue("2026-01-02T08:30:00Z"), "2026-01-02T09:30");
});

test("missing, impossible, future and ambiguous daylight-saving times never silently become another time", () => {
  const now = new Date("2027-01-01T00:00:00Z");
  for (const value of ["", "bad", "2026-02-30T10:00", "2026-12-10T25:00", "2028-01-01T00:00"]) {
    assert.throws(() => phone.budapestPhoneCallTimeToIso(value, now));
  }
  assert.throws(() => phone.budapestPhoneCallTimeToIso("2026-03-29T02:30", now), /nem létezett/);
  assert.throws(() => phone.budapestPhoneCallTimeToIso("2026-10-25T02:30", now), /nem egyértelmű/);
  assert.equal(phone.budapestPhoneCallTimeToIso("2026-03-29T03:30", now), "2026-03-29T01:30:00.000Z");
  assert.equal(phone.budapestPhoneCallTimeToIso("2026-10-25T03:30", now), "2026-10-25T02:30:00.000Z");
});

test("activity validation and merging preserve separate events and do not duplicate retry receipts", () => {
  assert.equal(phone.isPhoneCallRecord(record()), true);
  for (const value of [null, {}, record("call", { kind: "answered" }), record("call", { occurredAt: "bad" }), record("call", { actorName: null })]) {
    assert.equal(phone.isPhoneCallRecord(value), false);
  }
  const old = record("old"), newer = record("new", { occurredAt: "2026-02-01T08:00:00Z" });
  const groups = [[old], [newer, old]], before = JSON.stringify(groups);
  assert.deepEqual(plain(phone.mergePhoneCallRecords(...groups)), [newer, old]);
  assert.equal(JSON.stringify(groups), before);
  assert.equal(phone.phoneCallScopeKey({ type: "own", workspaceId: "w", customerId: "c", appointmentId: "a" }), "w:customer:c");
  assert.equal(phone.phoneCallScopeKey({ type: "shared", workspaceId: "w", grantId: "g", installationId: "i" }), "w:shared:g:i");
});

const accepted = (extra = {}) => ({ grantId: "grant", installationId: "source-installation",
  targetCustomerId: "customer", targetInstallationId: "mirror-installation", ...extra });
const sourceScope = { type: "shared", workspaceId: "workspace", grantId: "grant", installationId: "source-installation" };
test("accepted maintenance calls resolve their selected parent source rather than the maintenance appointment ID", () => {
  const work = { id: "customer", activeAppointmentId: "maintenance", appointmentType: "maintenance", maintenanceInstallationIds: ["mirror-installation"] };
  assert.deepEqual(plain(phone.resolveCustomerPhoneCallScope("workspace", work, [accepted()])), sourceScope);
  const sibling = accepted({ grantId: "other-grant", installationId: "other-source", targetInstallationId: "other-mirror" });
  assert.deepEqual(plain(phone.resolveCustomerPhoneCallScope("workspace", work, [accepted(), sibling])), sourceScope);
  assert.deepEqual(plain(phone.resolveCustomerPhoneCallScope("workspace", { ...work, activeAppointmentId: "mirror-installation", maintenanceInstallationIds: ["other-mirror"] }, [accepted(), sibling])), sourceScope);
});

test("ambiguous or contradictory maintenance sources remain local and never choose a different installer", () => {
  const work = { id: "customer", activeAppointmentId: "maintenance", appointmentType: "maintenance", maintenanceInstallationIds: ["mirror-installation", "other-mirror"] };
  const candidates = [accepted(), accepted({ grantId: "other-grant", installationId: "other-source", targetInstallationId: "other-mirror" })];
  const local = { type: "own", workspaceId: "workspace", customerId: "customer", appointmentId: "maintenance" };
  assert.deepEqual(plain(phone.resolveCustomerPhoneCallScope("workspace", work, candidates)), local);
  assert.deepEqual(plain(phone.resolveCustomerPhoneCallScope("workspace", { ...work, maintenanceInstallationIds: [] }, candidates)), local);
  assert.deepEqual(plain(phone.resolveCustomerPhoneCallScope("workspace", { ...work, maintenanceInstallationIds: ["unrelated-installation"] }, [accepted()])), local);
});

test("customer fallback is explicit, rejects contradictory installations and cannot route another customer's call", () => {
  assert.deepEqual(plain(phone.resolveCustomerPhoneCallScope("workspace", { id: "customer" }, [accepted()])), sourceScope);
  const work = { id: "customer", activeAppointmentId: "own-installation", appointmentType: "installation" };
  assert.equal(phone.resolveCustomerPhoneCallScope("workspace", work, [accepted()]).type, "own");
  assert.equal(phone.resolveCustomerPhoneCallScope("workspace", { ...work, id: "unrelated", activeAppointmentId: "mirror-installation" }, [accepted()]).type, "own");
  assert.equal(phone.resolveCustomerPhoneCallScope("workspace", { id: "shared:grant:source" }, [accepted()]), undefined);
  assert.equal(phone.resolveCustomerPhoneCallScope("", work, [accepted()]), undefined);
});

test("phone notes keep editable text intact and distinguish dialer initiation from an explicitly recorded call", () => {
  const html = renderToStaticMarkup(React.createElement(PhoneCallNotes, {
    records: [record(), record("manual", { kind: "recorded", occurredAt: "2026-01-01T08:00:00Z" })],
    legacyLastCalledAt: "2025-12-01T09:00:00Z", onRecord: noop,
  }, React.createElement("textarea", { defaultValue: "Original internal note" })));
  assert.match(html, /Original internal note/);
  assert.match(html, /Hívás indítva/); assert.match(html, /Hívás rögzítve/);
  assert.match(html, /2026\.01\.02\. 09:30/); assert.match(html, /Korábbi hívásrögzítés/);
  assert.match(html, /Korábbi hívás rögzítése/); assert.match(html, /datetime-local/);
  assert.doesNotMatch(html, /Sikeresen felhívva|tel:/);
});

test("busy and loading disable manual submission; errors remain visible and legacy duplicates disappear", () => {
  const html = renderToStaticMarkup(React.createElement(PhoneCallNotes, { records: [record()],
    legacyLastCalledAt: record().occurredAt, busy: true, error: "Synthetic failure", onRecord: noop }));
  assert.doesNotMatch(html, /Korábbi hívásrögzítés:/); assert.match(html, /disabled/); assert.match(html, /Synthetic failure/);
  const many = Array.from({ length: 7 }, (_, index) => record(String(index)));
  const compact = renderToStaticMarkup(React.createElement(PhoneCallNotes, { records: many }));
  assert.equal((compact.match(/<li/g) || []).length, 5); assert.match(compact, /Korábbi hívások \(2\)/);
});

test("manual submission rejects a missing date before the callback and forwards a validated Budapest instant", async () => {
  function fixture(manualTime, fail = false) {
    const state = { errors: [], saving: [], calls: [], values: [] };
    const f = h.functions(["saveManualCall"], { Error, disabled: false, manualTime,
      budapestPhoneCallTimeToIso: phone.budapestPhoneCallTimeToIso,
      onRecord: async value => { state.calls.push(value); if (fail) throw Error("Synthetic save failure"); },
      setManualError: value => state.errors.push(value), setSaving: value => state.saving.push(value), setManualTime: value => state.values.push(value),
    }, "src/components/alinflow/PhoneCallNotes.tsx");
    return { ...f, state };
  }
  const missing = fixture(""); await missing.saveManualCall(); assert.equal(missing.state.calls.length, 0); assert.ok(missing.state.errors.at(-1));
  const valid = fixture("2020-07-02T09:30"); await valid.saveManualCall(); assert.deepEqual(valid.state.calls, ["2020-07-02T07:30:00.000Z"]); assert.deepEqual(valid.state.values, [""]);
  const failure = fixture("2020-07-02T09:30", true); await failure.saveManualCall(); assert.equal(failure.state.values.length, 0); assert.match(failure.state.errors.at(-1), /Synthetic save failure/);
});

function clientFixture(reply) {
  const calls = [];
  const clientHarness = harness({}, { "@/lib/supabase": { supabase: { rpc: async (name, args) => {
    calls.push({ name, args: plain(args) }); return typeof reply === "function" ? reply(name, args) : reply;
  } } } });
  return { ...clientHarness.load("src/lib/alinflow/phone-calls-client.ts"), calls };
}
const own = { type: "own", workspaceId: "workspace", customerId: "customer", appointmentId: "appointment" };
const shared = { type: "shared", workspaceId: "workspace", grantId: "grant", installationId: "installation" };

test("client own and shared requests use separate scoped RPCs and preserve a request ID for safe retries", async () => {
  for (const scope of [own, shared]) {
    const expected = record("request", { installationId: scope.type === "shared" ? scope.installationId : null });
    const f = clientFixture({ data: expected });
    await f.recordPhoneCall(scope, "initiated", undefined, "request"); await f.recordPhoneCall(scope, "initiated", undefined, "request");
    assert.deepEqual(f.calls[0], f.calls[1]);
    assert.equal(f.calls[0].name, scope.type === "own" ? "record_customer_phone_call" : "record_shared_maintenance_phone_call");
    assert.equal(f.calls[0].args.p_request_id, "request"); assert.equal(f.calls[0].args.p_occurred_at, null);
    assert.equal(f.calls[0].args.p_appointment_id, scope.type === "own" ? "appointment" : undefined);
    assert.equal(f.calls[0].args.p_grant_id, scope.type === "shared" ? "grant" : undefined);
  }
});

test("client rejects missing or synthetic identities and malformed/mismatched receipts", async () => {
  const invalid = clientFixture({ data: record() });
  await assert.rejects(() => invalid.recordPhoneCall({ ...own, customerId: "shared:grant:source" }, "initiated"), /azonosítható/);
  await assert.rejects(() => invalid.recordPhoneCall(own, "recorded"), /időpont/); assert.equal(invalid.calls.length, 0);
  await assert.rejects(() => invalid.recordPhoneCall(own, "initiated", undefined, "request"), /nem igazolható/);
  const foreign = clientFixture({ data: record("request", { installationId: "other-installation" }) });
  await assert.rejects(() => foreign.recordPhoneCall(shared, "initiated", undefined, "request"), /nem igazolható/);
});

test("lists validate receipts and scoped errors do not turn into successful empty history", async () => {
  const f = clientFixture({ data: [record()] }); assert.equal((await f.listPhoneCalls(shared)).length, 1);
  assert.equal(f.calls[0].name, "list_shared_maintenance_phone_calls");
  for (const reply of [{ data: {} }, { data: [record("call", { occurredAt: "bad" })] }, { error: { code: "42501" } }, { error: { code: "PGRST202" } }]) {
    await assert.rejects(() => clientFixture(reply).listPhoneCalls(own));
  }
});
