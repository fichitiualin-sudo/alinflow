const assert = require("node:assert/strict");
const test = require("node:test");
const { harness, database } = require("./helpers.cjs");
const { ids, privacyNotice, signature } = require("./document-pdf-fixtures.cjs");
const h = harness();
const reports = h.load("src/lib/alinflow/work-report.ts");
const privacy = h.load("src/lib/alinflow/privacy-notice.ts");
const appointments = h.load("src/lib/alinflow/appointments.ts");
const scope = h.load("src/lib/alinflow/report-scope.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const noop = () => {};

function fixture(options = {}) {
  const selected = { id: ids.customer, activeAppointmentId: ids.appointment,
    name: "Mesterséges tesztügyfél", address: "1111 Tesztváros, Teszt út 1.", phone: "teszt", email: "synthetic@example.invalid",
    appointmentType: "maintenance", date: "2026-10-11", time: "08:00", quoteItems: [] };
  const notice = options.notice;
  const state = { report: { ...reports.emptyWorkReport(selected), id: options.existing ? ids.report : undefined,
    signatureDataUrl: notice?.signatureDataUrl || signature(), signedAt: notice?.signedAt || "2026-10-11T09:00:00Z",
    signerName: notice?.signerName || selected.name, privacyNotice: notice, privacyConsentRevokedAt: options.localRevokedAt },
    workspaceId: ids.workspace, maintenance: {}, busy: false, view: "workReport" };
  const calls = { writes: [], messages: [], sends: 0 };
  const pendingActionsRef = { current: new Set() };
  const row = (value) => ({ ...value, id: ids.report, legacy_source_key: "test-saved-report", privacy_consent_revoked_at: options.persistedRevokedAt || null });
  const db = database(async (op) => {
    calls.writes.push(op);
    if (op.value?.work_description) {
      if (options.saveGate) await options.saveGate;
      return options.saveError ? { error: options.saveError } : { data: row(op.value), error: null };
    }
    if (op.value?.privacy_consent_revoked_at) {
      if (options.revokeError) return { error: { message: "synthetic withdrawal failure" } };
      return { data: row({ customer_id: selected.id, appointment_id: selected.activeAppointmentId,
        appointment_type: selected.appointmentType, work_date: selected.date, work_time: selected.time,
        work_description: state.report.workDescription, signature_data_url: state.report.signatureDataUrl,
        signed_at: state.report.signedAt, signer_name: state.report.signerName, privacy_notice: state.report.privacyNotice,
        privacy_consent_revoked_at: "2026-10-12T10:00:00Z" }), error: null };
    }
    throw new Error(`Unexpected synthetic operation: ${op.table}/${op.method}`);
  });
  const context = {
    ...reports, ...privacy, ...appointments, ...scope, selected, quoteItems: [], user: { id: ids.other },
    workReportLoadBlocked: false, pendingActionsRef, setPendingActions: noop,
    workReportReceiptsRef: { current: new Map() }, currentWorkspaceId: () => state.workspaceId,
    withWorkspace: (value) => ({ ...value, workspace_id: state.workspaceId }),
    workspaceQuery: (query) => query.eq("workspace_id", state.workspaceId), supabase: db,
    scheduleDate: selected.date, scheduleTime: selected.time, shownTime: selected.time,
    workspaceSettings: { documentSettings: { privacyNotice: { enabled: true } } },
    setWorkReport: (value) => { state.report = typeof value === "function" ? value(state.report) : value; },
    setWorkReportBusy: (value) => { state.busy = value; }, setWorkReportEmailBusy: noop,
    setMaintenanceReportsByCustomer: (value) => { state.maintenance = value(state.maintenance); },
    setWorkReportsByCustomer: noop, setPurchaseDeclarationsByCustomer: noop,
    setSelected: noop, updateWorkHistory: noop, compareWorkReportsDesc: () => 0,
    fullCustomerAddress: (value) => value.address, climateSummary: () => "Mesterséges tesztklíma",
    errorMentionsWorkReportType: () => false, errorMentionsWorkReportHistoryLink: () => false,
    setMessage: (message, tone) => calls.messages.push({ message, tone }),
    setWorkFocusTarget: noop, replaceView: (value) => { state.view = value; },
    authenticatedFetch: async () => { calls.sends++; throw new Error("No email is allowed in this test"); },
    savedReportFor: () => state.report.id ? state.report : undefined,
  };
  const actions = () => h.functions(["beginAction", "endAction", "saveWorkReport", "updateWorkReportField", "updateWorkReportSignature", "revokeWorkReportPrivacyConsent"], {
    ...context, workReport: state.report,
  });
  return { state, calls, pendingActionsRef, selected,
    save: () => actions().saveWorkReport(false), revoke: () => actions().revokeWorkReportPrivacyConsent(),
    edit: (field, value) => actions().updateWorkReportField(field, value),
    sign: (...args) => actions().updateWorkReportSignature(...args),
  };
}

test("fresh finalized snapshot persists and returns unchanged into report and maintenance state", async () => {
  const saved = privacyNotice({ consentGranted: true });
  const run = fixture();
  run.edit("signerName", saved.signerName);
  run.sign(saved.signatureDataUrl, saved.signedAt, saved);
  await run.save();
  assert.equal(run.calls.writes.length, 1);
  assert.deepEqual(plain(run.calls.writes[0].value.privacy_notice), saved);
  assert.equal(run.calls.writes[0].value.signed_at, saved.signedAt);
  assert.equal(run.calls.writes[0].value.signature_data_url, saved.signatureDataUrl);
  assert.equal(run.calls.writes[0].value.signer_name, saved.signerName);
  assert.deepEqual(plain(run.state.report.privacyNotice), saved);
  assert.deepEqual(plain(run.state.maintenance[run.selected.id][0].privacyNotice), saved);
  assert.equal(run.state.view, "work");
});

test("saving a loaded legacy signature never invents a notice even with privacy settings enabled", async () => {
  const run = fixture({ existing: true });
  const originalSignature = run.state.report.signatureDataUrl;
  await run.save();
  assert.equal(run.calls.writes[0].value.privacy_notice, null);
  assert.equal(run.calls.writes[0].value.signature_data_url, originalSignature);
  assert.equal(run.state.report.privacyNotice, undefined);
});

test("normal save never sends a stale withdrawal field and keeps the withdrawal returned by the database", async () => {
  const saved = privacyNotice({ consentGranted: true });
  const revokedAt = "2026-10-12T10:00:00Z";
  const run = fixture({ existing: true, notice: saved, persistedRevokedAt: revokedAt, localRevokedAt: undefined });
  await run.save();
  assert.equal(Object.hasOwn(run.calls.writes[0].value, "privacy_consent_revoked_at"), false);
  assert.equal(run.state.report.privacyConsentRevokedAt, revokedAt);
  assert.equal(run.state.maintenance[run.selected.id][0].privacyConsentRevokedAt, revokedAt);
  assert.deepEqual(plain(run.state.report.privacyNotice), saved);
});

test("editing signed fields invalidates signature and notice; an unchanged value preserves them", () => {
  for (const field of ["workDescription", "notes", "signerName"]) {
    const saved = privacyNotice({ consentGranted: true });
    const run = fixture({ existing: true, notice: saved, localRevokedAt: "2026-10-12T10:00:00Z" });
    run.edit(field, run.state.report[field]);
    assert.equal(run.state.report.privacyNotice, saved);
    run.edit(field, "Megváltozott szöveg");
    assert.equal(run.state.report.signatureDataUrl, "");
    assert.equal(run.state.report.signedAt, undefined);
    assert.equal(run.state.report.privacyNotice, undefined);
    assert.equal(run.state.report.privacyConsentRevokedAt, undefined);
  }
});

test("clearing for a new signature does not carry an old consent decision into the replacement", () => {
  const run = fixture({ existing: true, notice: privacyNotice({ consentGranted: true }) });
  run.sign("");
  assert.equal(run.state.report.privacyNotice, undefined);
  assert.equal(run.state.report.signedAt, undefined);
  const refusal = privacyNotice({ consentGranted: false, signedAt: "2026-10-13T12:00:00Z" });
  run.sign(refusal.signatureDataUrl, refusal.signedAt, refusal);
  assert.equal(run.state.report.privacyNotice.consentGranted, false);
  assert.equal(run.state.report.signedAt, refusal.signedAt);
});

test("failed withdrawal preserves the visible original consent and never reports success", async () => {
  const saved = privacyNotice({ consentGranted: true });
  const run = fixture({ existing: true, notice: saved, revokeError: true });
  await run.revoke();
  assert.equal(run.state.report.privacyNotice, saved);
  assert.equal(run.state.report.privacyConsentRevokedAt, undefined);
  assert.equal(run.calls.messages.some(({ tone }) => tone === "success"), false);
  assert.match(run.calls.messages.at(-1).message, /nem mentődött/);
  assert.equal(run.state.busy, false);
  assert.equal(run.pendingActionsRef.current.size, 0);
  const filters = run.calls.writes[0].filters;
  assert.equal(filters.workspace_id, ids.workspace);
  assert.equal(filters["privacy_notice->>signedAt"], saved.signedAt);
});

test("missing notice column fails once without stripping consent or retrying the write", async () => {
  const run = fixture({ notice: privacyNotice(), saveError: { code: "PGRST204", message: "Could not find privacy_notice column" } });
  await run.save();
  assert.equal(run.calls.writes.length, 1);
  assert.ok(run.calls.writes[0].value.privacy_notice);
  assert.equal(run.calls.sends, 0);
  assert.equal(run.calls.messages.some(({ tone }) => tone === "success"), false);
  assert.equal(run.state.view, "workReport");
});

test("a completed old-workspace save cannot replace the new workspace's report or show success", async () => {
  let release;
  const saveGate = new Promise((resolve) => { release = resolve; });
  const run = fixture({ notice: privacyNotice(), saveGate });
  const pending = run.save();
  await Promise.resolve();
  run.state.workspaceId = ids.other;
  const newWorkspaceReport = { id: "new-workspace-report", workDescription: "Other workspace" };
  run.state.report = newWorkspaceReport;
  release();
  await pending;
  assert.equal(run.calls.writes[0].value.workspace_id, ids.workspace);
  assert.equal(run.state.report, newWorkspaceReport);
  assert.equal(run.calls.messages.some(({ message }) => /mentve ✅/.test(message)), false);
  assert.equal(run.calls.sends, 0);
});
