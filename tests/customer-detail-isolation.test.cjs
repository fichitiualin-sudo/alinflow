const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const h = harness({ console: { warn() {} } });

function fixture(outcome = "success", deferredState = false) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const scope = { workspace: "workspace-a", user: { current: "user-a" }, generation: { current: 1 } };
  const state = { reports: {}, maintenance: {}, documents: {}, declarations: {}, checklists: {},
    customers: [{ id: "customer-a" }], selected: { id: "customer-a" }, loaded: {}, loading: {}, messages: [] };
  const loaded = { current: {} }, loading = { current: {} };
  const queued = [];
  const setter = (key) => (update) => {
    const apply = () => { state[key] = typeof update === "function" ? update(state[key]) : update; };
    if (deferredState) queued.push(apply); else apply();
  };
  const context = {
    user: { id: "user-a" }, authUserIdRef: scope.user, authLoadGenerationRef: scope.generation,
    currentWorkspaceId: () => scope.workspace,
    detailDataLoadedRef: loaded, detailDataLoadingRef: loading,
    setDetailDataLoadingByCustomer: setter("loading"), setDetailDataLoadedByCustomer: setter("loaded"),
    setWorkReportsByCustomer: setter("reports"), setMaintenanceReportsByCustomer: setter("maintenance"),
    setDocumentsByCustomer: setter("documents"), setPurchaseDeclarationsByCustomer: setter("declarations"),
    setWorkChecklistsByCustomer: setter("checklists"), setCustomers: setter("customers"), setSelected: setter("selected"),
    setMessage: (message) => state.messages.push(message),
    readWorkspaceRows: async (table) => {
      await gate;
      if (outcome === "rejected") throw Error("OLD REQUEST FAILURE");
      if (outcome === "returned-error") return { data: null, error: { message: "OLD REQUEST FAILURE" } };
      return { data: [{ id: `${table}-old`, customer_id: "customer-a", customerId: "customer-a", appointment_id: "installation-a", appointmentType: "installation" }], error: null };
    },
    workReportFromRow: (row) => row, normalizeAppointmentType: (value) => value,
    workReportKeyFromReport: (report) => report.id, compareWorkReportsDesc: () => 0,
    documentFromRow: (row) => row, declarationFromRow: (row) => row, workChecklistFromRow: (row) => row,
    customerWithDetailDocuments: (customer, documents) => ({ ...customer, documents }),
  };
  const action = h.functions(["loadCustomerDetailData", "replaceLoadedDetailIds"], context).loadCustomerDetailData;
  return { action, release, scope, state, loaded, loading, queued };
}

for (const identity of ["workspace", "user", "generation"]) {
  for (const outcome of ["success", "returned-error", "rejected"]) {
    test(`late customer detail ${outcome} cannot alter caches, loading flags or feedback after ${identity} changes`, async () => {
      const run = fixture(outcome);
      const pending = run.action(["customer-a"]);
      assert.equal(run.loading.current["customer-a"], true);
      if (identity === "workspace") run.scope.workspace = "workspace-b";
      if (identity === "user") run.scope.user.current = "user-b";
      if (identity === "generation") run.scope.generation.current++;
      // Account initialization replaces state before an old request can return.
      for (const key of ["reports", "maintenance", "documents", "declarations", "checklists", "loaded"]) run.state[key] = { "next-customer": "NEXT WORKSPACE" };
      run.state.loading = { "customer-a": true, "next-customer": true };
      run.loaded.current = { "next-customer": true };
      run.loading.current = { "customer-a": true, "next-customer": true };
      const expected = JSON.stringify([run.state, run.loaded.current, run.loading.current]);
      run.release(); await pending;
      assert.equal(JSON.stringify([run.state, run.loaded.current, run.loading.current]), expected);
    });
  }
}

test("current customer detail success still populates every document cache and finishes its loading flags", async () => {
  const run = fixture(); const pending = run.action(["customer-a"]); run.release(); await pending;
  assert.equal(run.state.reports["work_reports-old"].customerId, "customer-a");
  assert.equal(run.state.documents["customer-a"][0].id, "documents-old");
  assert.equal(run.state.declarations["customer-a"][0].id, "purchase_declarations-old");
  assert.equal(run.state.checklists["customer-a:installation-a"].id, "work_checklists-old");
  assert.equal(run.state.selected.documents[0].id, "documents-old");
  assert.equal(run.loaded.current["customer-a"], true);
  assert.equal(run.loading.current["customer-a"], false);
  assert.equal(run.state.messages.length, 0);
});

test("a stale authenticated closure cannot start customer detail requests or set loading state", async () => {
  const run = fixture(); run.scope.user.current = "user-b";
  const pending = run.action(["customer-a"]); run.release(); await pending;
  assert.deepEqual(run.loading.current, {});
  assert.deepEqual(run.state.reports, {});
});

test("React state updates queued before an account switch cannot apply old detail data afterward", async () => {
  const run = fixture("success", true);
  const pending = run.action(["customer-a"]); run.release(); await pending;
  assert.ok(run.queued.length > 5);
  run.scope.user.current = "user-b";
  const expected = JSON.stringify(run.state);
  run.queued.forEach((apply) => apply());
  assert.equal(JSON.stringify(run.state), expected);
});

for (const outcome of ["returned-error", "rejected"]) {
  test(`current detail ${outcome} keeps existing cache, reports the error and allows retry`, async () => {
    const run = fixture(outcome); run.state.reports = { previous: "KEEP" };
    const pending = run.action(["customer-a"]); run.release(); await pending;
    assert.deepEqual(run.state.reports, { previous: "KEEP" });
    assert.equal(run.state.messages.length, 1);
    assert.equal(run.loading.current["customer-a"], false);
    assert.equal(run.loaded.current["customer-a"], undefined);
  });
}
