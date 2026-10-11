const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, noop } = require("./helpers.cjs");
const h = harness();
const original = { id: "customer-a", name: "Synthetic Customer", address: "Old street", workAddress: "Old street",
  city: "Synthetic City", postalCode: "1234", quoteItems: [], activeAppointmentId: "appointment-a",
  appointmentType: "installation", appointmentUpdatedAt: "2026-10-11T10:00:00Z",
  mapLatitude: 47, mapLongitude: 19, mapGeocodedAt: "2026-10-11T09:00:00Z", mapGeocodeStatus: "ok" };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(patch = {}, overrides = {}) {
  const scope = { workspace: "workspace-a", generation: { current: 1 } };
  const selected = { ...original, ...patch };
  const state = { selected, messages: [], promoted: [], ended: [], reloads: [], cleared: [], editing: true };
  const context = { selected, authLoadGenerationRef: scope.generation, currentWorkspaceId: () => scope.workspace,
    beginAction: () => true, endAction: (key) => state.ended.push(key), customerEditSnapshotRef: { current: original },
    lastCustomerLoadRef: { current: { customers: [original] } },
    loadCustomersPromiseRef: { current: null },
    setMessage: (message, tone) => state.messages.push({ message, tone }),
    persistCustomerToDb: async () => ({ appointmentId: original.activeAppointmentId }),
    setSelected: (value) => { state.selected = value; }, promoteCustomerWork: (value) => state.promoted.push(value),
    setEditCustomer: (value) => { state.editing = value; }, clearCustomerDraft: (id) => state.cleared.push(id),
    readCustomerDraft: () => null, setDraftNotice: noop,
    loadCustomersFromDb: async (options) => {
      state.reloads.push(options);
      context.lastCustomerLoadRef.current = { customers: [{ ...selected, mapLatitude: undefined, mapLongitude: undefined,
        mapGeocodeStatus: "pending", appointmentUpdatedAt: "2026-10-12T10:00:00Z" }] };
    }, ...overrides };
  return { ...h.functions(["saveCustomerData"], context), context, scope, state };
}

test("customer address changes clear cached coordinates and reload fresh map data without resetting the editor; other edits keep coordinates", async () => {
  for (const patch of [{ address: "New street" }, { city: "New City" }, { postalCode: "4321" }, { name: "New name" }]) {
    const run = fixture(patch); await run.saveCustomerData();
    const addressChanged = !patch.name;
    assert.equal(run.state.selected.mapLatitude, addressChanged ? undefined : 47);
    assert.equal(run.state.selected.mapLongitude, addressChanged ? undefined : 19);
    assert.equal(run.state.selected.mapGeocodedAt, addressChanged ? undefined : original.mapGeocodedAt);
    assert.equal(run.state.selected.mapGeocodeStatus, addressChanged ? undefined : "ok");
    assert.equal(run.state.promoted[0], run.state.selected);
    assert.equal(run.state.reloads.length, addressChanged ? 1 : 0);
    if (addressChanged) {
      assert.equal(run.state.reloads[0].background, true);
      assert.equal(run.state.reloads[0].preserveEditing, true);
      assert.equal(run.context.lastCustomerLoadRef.current.customers[0].appointmentUpdatedAt, "2026-10-12T10:00:00Z");
    }
    assert.equal(run.context.customerEditSnapshotRef.current, null);
    assert.equal(run.state.editing, false);
    assert.deepEqual(run.state.cleared, [original.id]);
    assert.match(run.state.messages.at(-1).message, /mentve ✅/);
  }
  const failedRefresh = fixture({ address: "New street" }, { loadCustomersFromDb: async () => {} });
  await failedRefresh.saveCustomerData();
  assert.equal(failedRefresh.state.selected.mapLatitude, undefined);
  assert.equal(failedRefresh.state.messages.at(-1).tone, "warning");
  assert.match(failedRefresh.state.messages.at(-1).message, /mentve.*nem sikerült frissíteni/);
});

test("late customer save or map-refresh success/failure cannot alter the next workspace or auth generation", async () => {
  for (const stage of ["save", "reload"]) for (const identity of ["workspace", "generation"]) for (const outcome of ["success", "failure"]) {
    const gate = deferred(), entered = deferred();
    const run = fixture({ address: "New street" }, {
      ...(stage === "save" ? { persistCustomerToDb: () => { entered.resolve(); return gate.promise; } }
        : { loadCustomersFromDb: () => { entered.resolve(); return gate.promise; } }),
    });
    const pending = run.saveCustomerData(); await entered.promise;
    if (identity === "workspace") run.scope.workspace = "workspace-b"; else run.scope.generation.current++;
    const nextSelection = { id: "new-customer", address: "Other account street" };
    run.state.selected = nextSelection;
    const before = { messages: run.state.messages.length, promoted: run.state.promoted.length, cleared: run.state.cleared.length };
    if (outcome === "failure") gate.reject(Error("OLD REQUEST FAILURE")); else gate.resolve({ appointmentId: "old-appointment" });
    await pending;
    assert.equal(run.state.selected, nextSelection);
    assert.deepEqual({ messages: run.state.messages.length, promoted: run.state.promoted.length, cleared: run.state.cleared.length }, before);
    assert.deepEqual(run.state.ended, ["customer-save"]);
  }
});

test("an address save must refresh after an already running pre-save customer load, so old coordinates cannot return", async () => {
  const gate = deferred();
  const run = fixture({ address: "New street" });
  let committed = false;
  const appointments = h.load("src/lib/alinflow/appointments.ts"), products = h.load("src/lib/alinflow/products.ts");
  const context = { ...run.context, ...appointments, ...products,
    ...h.load("src/lib/alinflow/maintenance-origin.ts"), ...h.load("src/lib/alinflow/appointment-records.ts"),
    products: [], documentsByCustomer: {}, EMPTY_QUOTE_ITEMS: [],
    loadCustomersPromiseRef: { current: null }, loadCustomersWorkspaceIdRef: { current: null },
    setDataLoading: noop, loadProductsFromDb: async () => [], loadSellerCompaniesFromDb: async () => [], loadInventoryFromDb: async () => {},
    readWorkspaceRows: async (table) => {
      const afterSave = committed;
      if (!afterSave) await gate.promise;
      return { error: null, data: table === "customers" ? [{ id: original.id, name: original.name, address: afterSave ? "New street" : "Old street" }]
        : table === "appointments" ? [{ id: original.activeAppointmentId, customer_id: original.id, appointment_type: "installation", status: "Lezárva",
          address: afterSave ? "New street" : "Old street", updated_at: afterSave ? "2026-10-12T10:00:00Z" : original.appointmentUpdatedAt,
          latitude: afterSave ? null : 47, longitude: afterSave ? null : 19, geocode_status: afterSave ? "pending" : "ok" }] : [] };
    },
    persistCustomerToDb: async () => { committed = true; return { appointmentId: original.activeAppointmentId }; },
    normalizeStatus: (value) => value, postalCodeFromCustomerData: () => "", numericDbValue: (value) => value == null ? undefined : value,
    stockDeductedFromWorkStatus: () => false, sortCustomersByCreatedAtDesc: (value) => value,
    setCustomers: (value) => { run.state.customers = value; }, setWorkHistoryByCustomer: (value) => { run.state.history = value; },
  };
  const actions = h.functions(["saveCustomerData", "loadCustomersFromDb", "quoteReceiptScopeFromRows"], context);
  const oldLoad = actions.loadCustomersFromDb({ background: true, preserveEditing: true });
  const save = actions.saveCustomerData(); await Promise.resolve(); gate.resolve();
  await Promise.all([oldLoad, save]);
  assert.equal(run.state.customers[0].address, "New street");
  assert.equal(run.state.customers[0].mapLatitude, undefined);
  assert.equal(run.state.history[original.id][0].appointmentUpdatedAt, "2026-10-12T10:00:00Z");
  assert.match(run.state.messages.at(-1).message, /mentve ✅/);
});
