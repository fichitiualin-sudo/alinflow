const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, noop } = require("./helpers.cjs");
const h = harness();
const appointments = h.load("src/lib/alinflow/appointments.ts");
const products = h.load("src/lib/alinflow/products.ts");
const origin = h.load("src/lib/alinflow/maintenance-origin.ts");
const records = h.load("src/lib/alinflow/appointment-records.ts");
const item = { customName: "Test AC", isManual: true, quantity: 1 };
const external = {
  id: "customer", activeAppointmentId: "old-installation", appointmentType: "installation",
  name: "Test Customer", phone: "", email: "", city: "Test City", address: "Test Address",
  source: "Test", status: "Lezárva", need: "", date: "2025-01-01", time: "08:00",
  quoteItems: [item], maintenanceOrigin: "external", maintenanceSourceName: "Test Partner",
};

test("opening and continuing a stale draft preserve edits but use the current appointment classification", () => {
  const draft = {
    customer: { ...external, maintenanceOrigin: "own", maintenanceSourceName: undefined, notes: "Unsaved note" },
    quoteItems: [{ ...item, quantity: 4 }], scheduleDate: "2027-02-01", scheduleTime: "10:00",
    scheduleAppointmentType: "installation", view: "work", editCustomer: true, allowWorkResourceEdit: true,
  };
  const state = {};
  const funcs = h.functions(["restoreCustomerMaintenanceOrigin", "openCustomer", "continueCustomerDraft", "workScopedCustomer"], {
    ...appointments,
    workHistoryByCustomer: { customer: [external] },
    currentReturnTarget: () => null,
    draftForCustomer: () => draft, readCustomerDraft: () => draft,
    setSelected: value => { state.selected = value; }, setQuoteItems: value => { state.items = value; },
    setScheduleDate: value => { state.date = value; }, setScheduleTime: noop, setScheduleAppointmentType: noop,
    setWorkReport: noop, emptyWorkReport: () => ({}), setWorkChecklist: noop, effectiveChecklistFor: () => ({}),
    setEditCustomer: noop, setAllowWorkResourceEdit: noop, loadCustomerDetailData: async () => {}, navigateToView: noop,
  });
  for (const open of [() => funcs.openCustomer(external, "work"), () => funcs.continueCustomerDraft()]) {
    open();
    assert.equal(state.selected.maintenanceOrigin, "external");
    assert.equal(state.selected.maintenanceSourceName, "Test Partner");
    assert.equal(state.selected.notes, "Unsaved note");
    assert.equal(state.items[0].quantity, 4);
    assert.equal(state.date, "2027-02-01");
  }
  assert.equal(draft.customer.maintenanceOrigin, "own", "restoring never mutates the snapshot");
});

test("classification restoration is appointment-scoped and unsaved new works always start own", () => {
  const { restoreCustomerMaintenanceOrigin } = h.functions(["restoreCustomerMaintenanceOrigin"]);
  const edited = { ...external, notes: "Keep me" };
  const other = { ...external, activeAppointmentId: "different", maintenanceOrigin: "own" };
  assert.equal(restoreCustomerMaintenanceOrigin(edited, other).maintenanceOrigin, "external");
  const currentOwn = { ...external, maintenanceOrigin: "own", maintenanceSourceName: undefined };
  const restored = restoreCustomerMaintenanceOrigin(edited, currentOwn);
  assert.equal(restored.maintenanceOrigin, "own");
  assert.equal(restored.maintenanceSourceName, undefined);
  assert.equal(restored.notes, "Keep me");
  const fresh = restoreCustomerMaintenanceOrigin({ ...edited, activeAppointmentId: undefined });
  assert.equal(fresh.maintenanceOrigin, "own");
  assert.equal(fresh.maintenanceSourceName, undefined);
});

test("reload restores the draft appointment's origin instead of the customer's different primary work", async () => {
  const draft = { customer: { ...external, maintenanceOrigin: "own", notes: "Unsaved note" },
    quoteItems: [{ ...item, quantity: 5 }], scheduleDate: "2027-02-01", scheduleTime: "10:00", scheduleAppointmentType: "installation" };
  const rows = [
    { id: "primary", customer_id: "customer", appointment_type: "installation", status: "Időpont foglalva", scheduled_date: "2027-01-01", maintenance_origin: "own" },
    { id: "old-installation", customer_id: "customer", appointment_type: "installation", status: "Lezárva", scheduled_date: "2025-01-01", maintenance_origin: "external", maintenance_source_name: "Test Partner" },
  ];
  const state = {};
  const funcs = h.functions(["loadCustomersFromDb", "quoteReceiptScopeFromRows", "restoreCustomerMaintenanceOrigin"], {
    ...appointments, ...products, ...origin, ...records,
    loadCustomersPromiseRef: { current: null }, loadCustomersWorkspaceIdRef: { current: null },
    lastCustomerLoadRef: { current: null }, initialDataReadyRef: { current: false },
    currentWorkspaceId: () => "workspace", selected: external, products: [], documentsByCustomer: {}, EMPTY_QUOTE_ITEMS: [], LIST_PAGE_SIZE: 10,
    setDataLoading: noop, setMessage: noop, loadProductsFromDb: async () => [], loadSellerCompaniesFromDb: async () => [], loadInventoryFromDb: async () => {},
    readWorkspaceRows: async table => ({ error: null, data: table === "customers" ? [{ id: "customer", name: "Test Customer" }] : table === "appointments" ? rows : [] }),
    normalizeStatus: value => value, postalCodeFromCustomerData: () => "", numericDbValue: () => undefined,
    stockDeductedFromWorkStatus: () => false, sortCustomersByCreatedAtDesc: value => value,
    setCustomers: value => { state.customers = value; }, setWorkHistoryByCustomer: value => { state.history = value; },
    readReturnContext: () => null, readCustomerDraft: () => draft, setDraftNotice: noop,
    setSelected: value => { state.selected = value; }, setQuoteItems: noop, setWorkChecklist: noop, effectiveChecklistFor: () => ({}),
    setInitialDataReady: noop, loadCustomerDetailData: async () => {}, setScheduleDate: noop, setScheduleTime: noop,
    setScheduleAppointmentType: noop, setEditCustomer: noop, setAllowWorkResourceEdit: noop,
  });
  await funcs.loadCustomersFromDb({ background: true });
  assert.equal(state.customers[0].activeAppointmentId, "primary");
  assert.equal(state.selected.activeAppointmentId, "old-installation");
  assert.equal(state.selected.maintenanceOrigin, "external");
  assert.equal(state.selected.maintenanceSourceName, "Test Partner");
  assert.equal(state.selected.notes, "Unsaved note");
  assert.equal(state.selected.quoteItems[0].quantity, 5);
});

function creationFixture(patch = {}) {
  const state = { selected: { ...external, ...patch }, saved: null, promoted: null, messages: [] };
  const context = {
    ...appointments, ...products,
    selected: state.selected, quoteItems: [item], allWorkCustomers: [], EMPTY_QUOTE_ITEMS: [],
    quickAppointment: { appointmentType: "installation", customerMode: "existing", date: "2027-01-01", time: "10:00", notes: "", productId: "new-ac", sendQuoteEmail: false, sendAppointmentEmail: false },
    quickAppointmentSavingRef: { current: false }, quickAppointmentDeliveryRef: { current: null },
    quickAppointmentSelectedCustomer: () => state.selected, quickAppointmentQuoteItems: () => [item],
    appointmentTimeAvailable: () => true, currentWorkspaceId: () => "workspace",
    pendingActionsRef: { current: new Set() }, normalizedScheduleAppointmentType: "installation",
    scheduleDate: "2027-01-01", scheduleTime: "10:00", maintenanceReturnRef: { current: null },
    beginAction: () => true, endAction: noop, sendAppointmentNotice: false,
    persistCustomerToDb: async value => { state.saved = value; return { appointmentId: value.activeAppointmentId || "new-installation" }; },
    promoteCustomerWork: value => { state.promoted = value; },
    setSelected: value => { state.selected = typeof value === "function" ? value(state.selected) : value; },
    setMessage: value => state.messages.push(value), setQuickAppointmentSaving: noop, setQuickAppointment: noop,
    setQuoteItems: noop, setScheduleDate: noop, setScheduleTime: noop, setScheduleAppointmentType: noop,
    logDocument: async () => {}, appointmentBookedDocumentType: () => "installation_booked",
    createCalendarEmailDelivery: () => null, quotePayload: () => ({}), setQuickAppointmentEmailPrompt: noop,
    setQuickAppointmentSaveWarning: noop, loadCustomerDetailData: async () => {},
    clearCustomerDraft: noop, readCustomerDraft: () => null, setDraftNotice: noop, replaceView: noop,
    navigateToView: noop, todayIso: () => "2027-01-01", setAllowWorkResourceEdit: noop, setSendAppointmentNotice: noop,
    customerInstallationWorks: () => [external], materials: [], materialOverrides: {},
  };
  return { state, ...h.functions(["saveQuickAppointment", "saveSchedule", "startInstallationScheduleFromQuote", "startMaintenanceForCustomer"], context) };
}

test("new calendar installation does not inherit an existing customer's external origin", async () => {
  const run = creationFixture();
  await run.saveQuickAppointment();
  assert.equal(run.state.saved.maintenanceOrigin, "own");
  assert.equal(run.state.saved.maintenanceSourceName, undefined);
  assert.equal(run.state.promoted.activeAppointmentId, "new-installation");
  assert.equal(run.state.promoted.maintenanceOrigin, "own");
  assert.equal(external.maintenanceOrigin, "external");
});

test("schedule creation resets inherited classification while editing an existing installation preserves it", async () => {
  for (const [patch, expected] of [
    [{}, "external"],
    [{ activeAppointmentId: undefined }, "own"],
    [{ appointmentType: "maintenance" }, "own"],
  ]) {
    const run = creationFixture(patch);
    await run.saveSchedule();
    assert.ok(run.state.saved, run.state.messages.join("; "));
    assert.equal(run.state.saved.maintenanceOrigin, expected);
    assert.equal(run.state.saved.maintenanceSourceName, expected === "external" ? "Test Partner" : undefined);
  }
});

test("new installation and maintenance drafts reset classification without changing the source installation", () => {
  const installation = creationFixture({ appointmentType: "maintenance" });
  installation.startInstallationScheduleFromQuote();
  assert.equal(installation.state.selected.activeAppointmentId, undefined);
  assert.equal(installation.state.selected.maintenanceOrigin, "own");
  assert.equal(installation.state.selected.maintenanceSourceName, undefined);
  const maintenance = creationFixture();
  maintenance.startMaintenanceForCustomer(external);
  assert.equal(maintenance.state.selected.activeAppointmentId, undefined);
  assert.equal(maintenance.state.selected.maintenanceOrigin, "own");
  assert.equal(maintenance.state.selected.maintenanceSourceName, undefined);
  assert.deepEqual(Array.from(maintenance.state.selected.maintenanceInstallationIds), ["old-installation"]);
  assert.equal(external.maintenanceOrigin, "external");
});
