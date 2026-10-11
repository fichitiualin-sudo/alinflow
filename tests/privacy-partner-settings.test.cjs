const assert = require("node:assert/strict");
const test = require("node:test");
const { harness, database } = require("./helpers.cjs");

const h = harness();
const privacy = h.load("src/lib/alinflow/privacy-notice.ts");
const settings = h.load("src/lib/alinflow/workspace-settings.ts");
const SOURCE_WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PARTNER_USER = "22222222-2222-4222-8222-222222222222";
const PARTNER_WORKSPACE = "33333333-3333-4333-8333-333333333333";
const NEXT_WORKSPACE = "44444444-4444-4444-8444-444444444444";
const clone = (value) => JSON.parse(JSON.stringify(value));
const party = (legalName) => ({ legalName, address: "1234 Tesztváros, Minta utca 1.", email: "partner@example.test", phone: "", taxNumber: "" });
const config = () => ({
  enabled: true,
  serviceProvider: party("Szintetikus szerelő"),
  deviceSeller: party("Szintetikus értékesítő"),
  partner: party("Szintetikus partner"),
  partnerUserId: PARTNER_USER,
  partnerWorkspaceId: PARTNER_WORKSPACE,
  retentionText: "Szintetikus megőrzési szabály.",
  recipientsText: "Szintetikus szolgáltató.",
  internationalTransfersText: "Szintetikus adattovábbítási feltételek.",
});
const snapshotInput = (privacyConfig) => ({
  config: privacyConfig,
  customer: { name: "Szintetikus ügyfél", address: "1234 Tesztváros, Minta utca 2.", phone: "", email: "" },
  signerName: "Szintetikus ügyfél", signatureDataUrl: "data:image/png;base64,dGVzdA==",
  signedAt: "2026-10-11T12:00:00.000Z", consentGranted: true,
});

test("linked partner selection and company details survive normalization and workspace row round-trip", () => {
  const original = config();
  const saved = settings.normalizeWorkspaceSettings({ documentSettings: { privacyNotice: original } });
  const row = settings.workspaceSettingsToRow(saved, SOURCE_WORKSPACE);
  const restored = settings.workspaceSettingsFromRow(row, settings.defaultWorkspaceSettings());
  assert.equal(row.workspace_id, SOURCE_WORKSPACE);
  assert.equal(restored.documentSettings.privacyNotice.partnerUserId, PARTNER_USER);
  assert.equal(restored.documentSettings.privacyNotice.partnerWorkspaceId, PARTNER_WORKSPACE);
  assert.deepEqual(clone(restored.documentSettings.privacyNotice.partner), original.partner);
  assert.equal(restored.documentSettings.privacyNotice.retentionText, original.retentionText);
  assert.equal(restored.documentSettings.privacyNotice.serviceProvider.legalName, original.serviceProvider.legalName);
});

test("legacy manually entered partners remain intact without acquiring a linked user or workspace", () => {
  const manual = config();
  delete manual.partnerUserId;
  delete manual.partnerWorkspaceId;
  const row = settings.workspaceSettingsToRow(settings.normalizeWorkspaceSettings({ documentSettings: { privacyNotice: manual } }), SOURCE_WORKSPACE);
  const restored = settings.workspaceSettingsFromRow(row, settings.defaultWorkspaceSettings()).documentSettings.privacyNotice;
  assert.deepEqual(clone(restored.partner), manual.partner);
  assert.equal(restored.partnerUserId, undefined);
  assert.equal(restored.partnerWorkspaceId, undefined);
  assert.equal(privacy.privacyNoticeConfigValidation(restored).length, 0);
});

test("clearing an optional linked partner cannot resurrect its IDs from saved company details", () => {
  const cleared = { ...config(), partner: privacy.normalizePrivacyParty(undefined), partnerUserId: undefined, partnerWorkspaceId: undefined };
  const row = settings.workspaceSettingsToRow(settings.normalizeWorkspaceSettings({ documentSettings: { privacyNotice: cleared } }), SOURCE_WORKSPACE);
  const restored = settings.workspaceSettingsFromRow(row, settings.defaultWorkspaceSettings()).documentSettings.privacyNotice;
  assert.equal(restored.partner.legalName, "");
  assert.equal(restored.partnerUserId, undefined);
  assert.equal(restored.partnerWorkspaceId, undefined);
  assert.equal(privacy.privacyNoticeConfigValidation(restored).length, 0);
});

test("signed partner snapshots contain company facts only and remain immutable after account/settings changes", () => {
  const input = config();
  input.partner.partnerUserId = PARTNER_USER;
  input.partner.partnerWorkspaceId = PARTNER_WORKSPACE;
  const snapshot = privacy.buildPrivacyNoticeSnapshot(snapshotInput(input));
  const saved = JSON.stringify(snapshot);
  assert.doesNotMatch(saved, /partnerUserId|partnerWorkspaceId/);
  assert.ok(!saved.includes(PARTNER_USER) && !saved.includes(PARTNER_WORKSPACE));
  assert.deepEqual(Object.keys(snapshot.partner).sort(), ["address", "email", "legalName", "phone", "taxNumber"]);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.partner) && Object.isFrozen(snapshot.controllers[0].party));
  assert.equal(Reflect.set(snapshot.partner, "legalName", "Tiltott közvetlen átírás"), false);
  input.partner.legalName = "Másik partner";
  input.partnerUserId = "55555555-5555-4555-8555-555555555555";
  input.partnerWorkspaceId = NEXT_WORKSPACE;
  assert.equal(JSON.stringify(snapshot), saved);
  const reread = privacy.parsePrivacyNoticeSnapshot(JSON.parse(saved));
  assert.equal(JSON.stringify(reread), saved, "Reading an old signature must never consult current partner account settings");
  assert.equal(reread.partner.legalName, "Szintetikus partner");
  assert.match(reread.consentText, /Szintetikus partner/);
  assert.doesNotMatch(reread.consentText, /Másik partner/);
});

test("linked partner metadata requires a complete valid pair even when the notice is disabled", () => {
  for (const invalid of [
    { partnerUserId: PARTNER_USER, partnerWorkspaceId: undefined },
    { partnerUserId: undefined, partnerWorkspaceId: PARTNER_WORKSPACE },
    { partnerUserId: "not-a-user", partnerWorkspaceId: PARTNER_WORKSPACE },
    { partnerUserId: PARTNER_USER, partnerWorkspaceId: "not-a-workspace" },
  ]) {
    for (const enabled of [true, false]) {
      assert.ok(privacy.privacyNoticeConfigValidation({ ...config(), ...invalid, enabled }).length > 0);
    }
  }
  const upper = "ABCDEF12-3456-4789-ABCD-ABCDEF123456";
  const normalized = privacy.normalizePrivacyNoticeConfig({ ...config(), partnerUserId: ` ${upper} `, partnerWorkspaceId: ` ${PARTNER_WORKSPACE} ` });
  assert.equal(normalized.partnerUserId, upper.toLowerCase());
  assert.equal(normalized.partnerWorkspaceId, PARTNER_WORKSPACE);
  assert.equal(privacy.privacyNoticeConfigValidation(normalized).length, 0);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function saveScenario(options = {}) {
  const activeWorkspaceIdRef = { current: SOURCE_WORKSPACE };
  const activeWorkspace = { id: SOURCE_WORKSPACE, name: "Szintetikus munkaterület", slug: "synthetic" };
  const pendingActions = new Set();
  const state = { settings: null, available: null, busy: false, messages: [], writes: [], resolutions: [] };
  const serverParty = party("Szerveren visszaellenőrzött partner");
  const candidate = { userId: PARTNER_USER, workspaceId: PARTNER_WORKSPACE, workspaceName: "Partner munkaterülete", party: serverParty, issues: [] };
  const f = h.functions(["currentWorkspaceId", "saveWorkspaceSettings"], {
    ...settings, activeWorkspace, activeWorkspaceIdRef, user: { id: "55555555-5555-4555-8555-555555555555" },
    beginAction: key => { if (pendingActions.has(key)) return false; pendingActions.add(key); return true; },
    endAction: key => pendingActions.delete(key),
    setWorkspaceSettingsBusy: value => { state.busy = value; },
    setWorkspaceSettingsMessage: () => {},
    setWorkspaceSettings: value => { state.settings = value; },
    setWorkspaceSettingsSchemaAvailable: value => { state.available = value; },
    setMessage: (...args) => state.messages.push(args),
    isMissingWorkspaceSettingsSchemaError: () => false,
    resolvePrivacyPartner: async (...args) => {
      state.resolutions.push(args);
      return options.resolve ? options.resolve(...args) : candidate;
    },
    supabase: database(op => {
      assert.equal(op.table, "workspace_settings", "Partner selection must never write memberships, jobs or signed documents");
      assert.equal(op.method, "upsert");
      state.writes.push(op);
      return options.write ? options.write(op) : { data: op.value, error: null };
    }),
  });
  const next = settings.normalizeWorkspaceSettings({
    companyProfile: { displayName: "Eredeti márka" },
    documentSettings: { privacyNotice: config(), workReportFooterText: "Eredeti lábléc" },
  }, settings.defaultWorkspaceSettings(activeWorkspace));
  return { f, state, next, activeWorkspaceIdRef, candidate, pendingActions };
}

test("saving a linked partner verifies the selected pair before any write and uses only the refreshed party", async () => {
  const gate = deferred();
  const run = saveScenario({ resolve: () => gate.promise });
  const original = clone(run.next);
  const pending = run.f.saveWorkspaceSettings(run.next);
  assert.deepEqual(run.state.resolutions, [[SOURCE_WORKSPACE, PARTNER_USER, PARTNER_WORKSPACE]]);
  assert.equal(run.state.writes.length, 0, "The selected account must be rechecked before settings persistence");
  assert.equal(run.state.busy, true);
  gate.resolve(run.candidate);
  await pending;
  assert.equal(run.state.writes.length, 1);
  const payload = run.state.writes[0].value;
  const expected = settings.workspaceSettingsToRow(original, SOURCE_WORKSPACE, "55555555-5555-4555-8555-555555555555");
  expected.document_settings.privacyNotice.partner = run.candidate.party;
  assert.ok(Number.isFinite(Date.parse(payload.updated_at)));
  expected.updated_at = payload.updated_at;
  assert.deepEqual(clone(payload), clone(expected), "Refreshing the partner must preserve all unrelated settings and optional IDs");
  assert.deepEqual(clone(run.next), original, "Verification must not mutate the caller's draft");
  assert.equal(run.state.settings.documentSettings.privacyNotice.partner.legalName, run.candidate.party.legalName);
  assert.equal(run.state.busy, false);
});

test("rapid duplicate settings saves do not duplicate partner verification or persistence", async () => {
  const gate = deferred();
  const run = saveScenario({ resolve: () => gate.promise });
  const first = run.f.saveWorkspaceSettings(run.next);
  const second = run.f.saveWorkspaceSettings(run.next);
  assert.equal(run.state.resolutions.length, 1);
  gate.resolve(run.candidate);
  await Promise.all([first, second]);
  assert.equal(run.state.writes.length, 1);
  assert.equal(run.pendingActions.size, 0);
});

test("a removed or invalid selected account rejects the save without overwriting the old settings", async () => {
  const run = saveScenario({ resolve: async () => { throw new Error("A partner már nem aktív."); } });
  await run.f.saveWorkspaceSettings(run.next);
  assert.equal(run.state.writes.length, 0);
  assert.equal(run.state.settings, null);
  assert.equal(run.state.available, null);
  assert.match(run.state.messages.at(-1)[0], /partner már nem aktív/);
  assert.equal(run.state.messages.at(-1)[1], "error");
  assert.equal(run.state.busy, false);
  assert.equal(run.pendingActions.size, 0);
});

for (const outcome of ["success", "failure"]) {
  test(`a ${outcome} received after switching workspaces during partner verification cannot save or change the new workspace`, async () => {
    const gate = deferred();
    const run = saveScenario({ resolve: () => gate.promise });
    const pending = run.f.saveWorkspaceSettings(run.next);
    run.activeWorkspaceIdRef.current = NEXT_WORKSPACE;
    const currentSettings = { workspace: "next", controller: "Másik adatkezelő" };
    run.state.settings = currentSettings;
    run.state.available = true;
    const messagesBefore = run.state.messages.length;
    if (outcome === "failure") gate.reject(new Error("Régi munkaterület partnerhibája"));
    else gate.resolve(run.candidate);
    await pending;
    assert.equal(run.state.writes.length, 0);
    assert.strictEqual(run.state.settings, currentSettings);
    assert.equal(run.state.available, true);
    assert.equal(run.state.messages.length, messagesBefore);
    assert.equal(run.pendingActions.size, 0);
  });

  test(`a stale settings write ${outcome} after partner validation cannot replace the next workspace's state`, async () => {
    const started = deferred();
    const response = deferred();
    const run = saveScenario({ write: op => { started.resolve(op); return response.promise; } });
    const pending = run.f.saveWorkspaceSettings(run.next);
    const operation = await started.promise;
    assert.equal(operation.value.workspace_id, SOURCE_WORKSPACE);
    run.activeWorkspaceIdRef.current = NEXT_WORKSPACE;
    const currentSettings = { workspace: "next", controller: "Másik adatkezelő" };
    run.state.settings = currentSettings;
    run.state.available = false;
    const messagesBefore = run.state.messages.length;
    response.resolve(outcome === "success" ? { data: operation.value, error: null }
      : { data: null, error: { message: "Régi munkaterület mentési hibája" } });
    await pending;
    assert.equal(run.state.writes.length, 1);
    assert.strictEqual(run.state.settings, currentSettings);
    assert.equal(run.state.available, false);
    assert.equal(run.state.messages.length, messagesBefore);
    assert.equal(run.pendingActions.size, 0);
  });
}

test("a legacy manual partner saves without lookup, while a half-selected account cannot be saved", async () => {
  const legacy = saveScenario();
  delete legacy.next.documentSettings.privacyNotice.partnerUserId;
  delete legacy.next.documentSettings.privacyNotice.partnerWorkspaceId;
  await legacy.f.saveWorkspaceSettings(legacy.next);
  assert.equal(legacy.state.resolutions.length, 0);
  assert.equal(legacy.state.writes.length, 1);
  assert.equal(legacy.state.writes[0].value.document_settings.privacyNotice.partner.legalName, "Szintetikus partner");
  for (const missing of ["partnerUserId", "partnerWorkspaceId"]) {
    const partial = saveScenario();
    delete partial.next.documentSettings.privacyNotice[missing];
    await partial.f.saveWorkspaceSettings(partial.next);
    assert.equal(partial.state.resolutions.length, 0);
    assert.equal(partial.state.writes.length, 0);
    assert.equal(partial.state.messages.at(-1)[1], "error");
  }
});
