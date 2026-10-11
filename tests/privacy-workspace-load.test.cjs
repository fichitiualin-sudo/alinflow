const assert = require("node:assert/strict");
const test = require("node:test");
const { harness, database } = require("./helpers.cjs");

const h = harness();
const settings = h.load("src/lib/alinflow/workspace-settings.ts");
const reports = h.load("src/lib/alinflow/work-report.ts");
const appointments = h.load("src/lib/alinflow/appointments.ts");
const scopes = h.load("src/lib/alinflow/report-scope.ts");
const privacy = h.load("src/lib/alinflow/privacy-notice.ts");
const declarations = h.load("src/lib/alinflow/purchase-declarations.ts");

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function workspace(id) { return { id, name: `Workspace ${id}`, slug: id }; }
function settingsRow(id) {
  const party = { legalName: `Controller ${id}`, address: "1234 Test, Example 1.", email: `${id}@example.test`, phone: "", taxNumber: "" };
  return {
    workspace_id: id, company_profile: { displayName: `Brand ${id}` },
    document_settings: { privacyNotice: { ...privacy.defaultPrivacyNoticeConfig(), serviceProvider: party } },
  };
}

for (const resultKind of ["success", "schema-error", "other-error", "rejected-promise"]) {
  test(`a stale settings ${resultKind} cannot replace the new workspace's controller or availability`, async () => {
    const activeWorkspaceIdRef = { current: "old" };
    const replies = { old: deferred(), next: deferred() };
    const started = { old: deferred(), next: deferred() };
    const calls = [];
    const state = { settings: null, available: null, message: "" };
    const f = h.functions(["currentWorkspaceId", "loadWorkspaceSettingsFromDb"], {
      ...settings, activeWorkspaceIdRef,
      setWorkspaceSettings: (value) => { calls.push("settings"); state.settings = value; },
      setWorkspaceSettingsMessage: (value) => { calls.push("message"); state.message = value; },
      setWorkspaceSettingsSchemaAvailable: (value) => { calls.push("available"); state.available = value; },
      isMissingWorkspaceSettingsSchemaError: (error) => error.code === "42P01",
      supabase: database((op) => {
        assert.equal(op.table, "workspace_settings");
        assert.equal(op.method, "select");
        started[op.filters.workspace_id].resolve();
        return replies[op.filters.workspace_id].promise;
      }),
    });
    const oldLoad = f.loadWorkspaceSettingsFromDb(workspace("old"));
    await started.old.promise;
    activeWorkspaceIdRef.current = "next";
    const nextLoad = f.loadWorkspaceSettingsFromDb(workspace("next"));
    await started.next.promise;
    replies.next.resolve({ data: settingsRow("next"), error: null });
    await nextLoad;
    const settledCalls = calls.length;
    if (resultKind === "rejected-promise") replies.old.reject(new Error("Old workspace request rejected"));
    else replies.old.resolve(resultKind === "success" ? { data: settingsRow("old"), error: null }
      : { data: null, error: { code: resultKind === "schema-error" ? "42P01" : "offline", message: "Old workspace failed" } });
    await oldLoad;
    assert.equal(calls.length, settledCalls, "A stale response must not even write fallback/settings error state");
    assert.equal(state.settings.companyProfile.displayName, "Brand next");
    assert.equal(state.settings.documentSettings.privacyNotice.serviceProvider.legalName, "Controller next");
    assert.equal(state.available, true);
    assert.equal(state.message, "");
  });
}

test("a current settings failure still propagates instead of pretending the privacy config loaded", async () => {
  const activeWorkspaceIdRef = { current: "current" };
  let availableWrites = 0;
  const f = h.functions(["currentWorkspaceId", "loadWorkspaceSettingsFromDb"], {
    ...settings, activeWorkspaceIdRef, setWorkspaceSettings: () => {}, setWorkspaceSettingsMessage: () => {},
    setWorkspaceSettingsSchemaAvailable: () => { availableWrites++; },
    isMissingWorkspaceSettingsSchemaError: () => false,
    supabase: database(() => ({ data: null, error: { message: "Current read failed" } })),
  });
  await assert.rejects(f.loadWorkspaceSettingsFromDb(workspace("current")), { message: "Current read failed" });
  assert.equal(availableWrites, 0);
});

function workReportRace(type) {
  const activeWorkspaceIdRef = { current: "old" };
  const response = deferred();
  const started = deferred();
  const state = { report: undefined, blocked: false, reports: {}, maintenance: {}, declarations: {}, messages: [], writes: [] };
  const oldCustomer = { id: "old-customer", name: "Old Customer", date: "2026-10-11", time: "08:00", appointmentType: type, activeAppointmentId: "old-appointment" };
  const oldRow = { id: "old-report", workspace_id: "old", customer_id: oldCustomer.id, appointment_id: oldCustomer.activeAppointmentId,
    appointment_type: type, work_date: oldCustomer.date, work_time: oldCustomer.time,
    work_description: "Old work", signature_data_url: "old-signature", signed_at: "2026-10-11T08:30:00Z", signer_name: oldCustomer.name };
  const set = (key, value) => { state.writes.push(key); state[key] = typeof value === "function" ? value(state[key]) : value; };
  const f = h.functions(["currentWorkspaceId", "workspaceQuery", "loadWorkReportFor"], {
    ...reports, ...appointments, ...scopes, ...declarations, activeWorkspaceIdRef, workReportLoadSequence: { current: 0 },
    sellerCompanies: [], setWorkReportDeclaration: (value) => set("declaration", value),
    setWorkReportDeclarationItems: (value) => set("declarationItems", value), setPurchaseDeclarationItemKeys: (value) => set("keys", value),
    setSelectedSellerId: (value) => set("sellerId", value), setPurchaseDeclarationsByCustomer: (value) => set("declarations", value),
    scheduleDate: oldCustomer.date, scheduleTime: oldCustomer.time, shownTime: oldCustomer.time,
    setWorkReport: (value) => set("report", value), setWorkReportLoadBlocked: (value) => set("blocked", value),
    setWorkReportsByCustomer: (value) => set("reports", value), setMaintenanceReportsByCustomer: (value) => set("maintenance", value),
    compareWorkReportsDesc: () => 0,
    setMessage: (value) => { state.writes.push("message"); state.messages.push(value); },
    supabase: database((op) => {
      if (op.table === "purchase_declarations") return { data: [], error: null };
      assert.equal(op.table, "work_reports"); assert.equal(op.method, "select");
      assert.equal(op.filters.workspace_id, "old"); assert.equal(op.filters.customer_id, oldCustomer.id);
      assert.equal(op.filters.appointment_id, oldCustomer.activeAppointmentId);
      started.resolve(); return response.promise;
    }),
  });
  return { f, state, activeWorkspaceIdRef, response, started, oldCustomer, oldRow };
}

for (const type of ["installation", "maintenance"]) {
  for (const resultKind of ["success", "returned-error", "rejected-error"]) {
    test(`a stale ${type} report ${resultKind} cannot write report, consent, cache or error state in another workspace`, async () => {
      const race = workReportRace(type);
      const pending = race.f.loadWorkReportFor(race.oldCustomer);
      await race.started.promise;
      // Switch workspaces without starting another report request: a sequence guard alone cannot protect this case.
      race.activeWorkspaceIdRef.current = "next";
      const currentReport = { id: "new-report", privacyNotice: { controllers: "new-controller" } };
      race.state.report = currentReport;
      race.state.blocked = false;
      race.state.reports = { "new-report": currentReport };
      race.state.maintenance = { "new-customer": [currentReport] };
      const settledWrites = race.state.writes.length;
      if (resultKind === "success") race.response.resolve({ data: [race.oldRow], error: null });
      else if (resultKind === "returned-error") race.response.resolve({ data: null, error: { message: "Old report failed" } });
      else race.response.reject(new Error("Old request rejected"));
      await pending;
      assert.equal(race.state.writes.length, settledWrites);
      assert.equal(race.state.report, currentReport);
      assert.equal(race.state.blocked, false);
      assert.deepEqual(Object.keys(race.state.reports), ["new-report"]);
      assert.deepEqual(Object.keys(race.state.maintenance), ["new-customer"]);
      assert.equal(race.state.messages.length, 0);
    });
  }
}

test("a current report response still populates the selected work and cache", async () => {
  const race = workReportRace("installation");
  const pending = race.f.loadWorkReportFor(race.oldCustomer);
  await race.started.promise;
  race.response.resolve({ data: [race.oldRow], error: null });
  await pending;
  assert.equal(race.state.report.id, "old-report");
  assert.equal(race.state.blocked, false);
  assert.equal(Object.values(race.state.reports)[0].appointmentId, "old-appointment");
  assert.equal(race.state.messages.length, 0);
});
