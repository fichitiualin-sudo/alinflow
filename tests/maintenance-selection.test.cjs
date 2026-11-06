const assert = require("node:assert/strict");
const test = require("node:test");
const { harness, noop } = require("./helpers.cjs");
const h = harness();
const selection = h.load("src/lib/alinflow/maintenance-selection.ts");
const devices = h.load("src/lib/alinflow/maintenance-devices.ts");
const appointments = h.load("src/lib/alinflow/appointments.ts");
const products = h.load("src/lib/alinflow/products.ts");
const constants = h.load("src/lib/alinflow/constants.ts");
const plain = value => JSON.parse(JSON.stringify(value));
const item = { isManual: true, customName: "Synthetic AC", quantity: 1, customPrice: 100000 };
const installation = { id: "customer", name: "Synthetic Customer", appointmentType: "installation",
  activeAppointmentId: "installation", date: "2025-10-14", time: "08:00", address: "Synthetic street",
  status: "Lezárva", quoteItems: [item], email: "test@example.invalid" };
const aliasMap = new Map([["job", "installation"]]);

test("draft aliases collapse to one canonical selection and prefer the real installation summary", () => {
  const real = { appointmentId: "installation", date: "2025-10-14", quoteItems: [item] };
  const alias = { appointmentId: "job", date: "2025-10-13", quoteItems: [{ ...item, quantity: 5 }] };
  for (const summaries of [[real, alias], [alias, real]]) {
    const draft = { ...installation, activeAppointmentId: "job", notes: "Unsaved note",
      maintenanceInstallationIds: ["installation", "job", "installation"], maintenanceInstallations: summaries };
    const before = plain(draft);
    const normalized = selection.canonicalCustomerAppointments(draft, aliasMap);
    assert.equal(normalized.activeAppointmentId, "installation");
    assert.deepEqual(plain(normalized.maintenanceInstallationIds), ["installation"]);
    assert.deepEqual(plain(normalized.maintenanceInstallations), [real]);
    assert.equal(normalized.notes, "Unsaved note");
    assert.deepEqual(plain(draft), before, "normalizing does not mutate the stored draft");
  }
});

test("normalization preserves unrelated real installations and unknown IDs for explicit validation", () => {
  assert.deepEqual(plain(selection.canonicalAppointmentIds(["job", "second", "unknown", "installation", ""], aliasMap)),
    ["installation", "second", "unknown"]);
  const normalized = selection.canonicalCustomerAppointments({ ...installation, activeAppointmentId: undefined }, aliasMap);
  assert.equal(normalized.activeAppointmentId, undefined);
  assert.equal(normalized.maintenanceInstallationIds, undefined);
});

function scheduleFixture(options = {}) {
  const state = { workspace: "workspace", selected: { ...installation, appointmentType: "maintenance",
    activeAppointmentId: undefined, date: undefined, quoteItems: [item, item],
    maintenanceInstallationIds: ["installation", "job"], ...options.selected },
    persisted: [], rpc: [], messages: [], navigation: [], failures: options.failures || 0 };
  const aliasesRef = { current: { workspaceId: "workspace", ids: aliasMap } };
  const context = { ...selection, ...devices, ...appointments, ...products, ...constants,
    appointmentAliasesRef: aliasesRef, currentWorkspaceId: () => state.workspace,
    workHistoryByCustomer: { customer: options.installations || [installation] }, normalizedScheduleAppointmentType: "maintenance",
    scheduleDate: "2026-10-15", scheduleTime: "08:00", allWorkCustomers: [],
    EMPTY_QUOTE_ITEMS: [], pendingActionsRef: { current: new Set() }, maintenanceReturnRef: { current: null },
    appointmentTimeAvailable: ({ items }) => options.slotCapacity == null
      || items.reduce((sum, item) => sum + item.quantity, 0) <= options.slotCapacity,
    beginAction: () => true, endAction: noop,
    setMessage: (message, tone) => state.messages.push({ message, tone }), sendAppointmentNotice: false,
    persistCustomerToDb: async customer => { state.persisted.push(plain(customer)); return {
      appointmentId: customer.activeAppointmentId || "maintenance", quoteId: "maintenance-quote" }; },
    promoteCustomerWork: noop, setSelected: value => { state.selected = value; },
    clearCustomerDraft: noop, readCustomerDraft: () => null, setDraftNotice: noop,
    replaceView: value => state.navigation.push(value),
    supabase: {
      from: () => { throw Error("Direct table writes must never replace maintenance links"); },
      rpc: async (name, args) => {
        state.rpc.push({ name, args: plain(args) });
        if (state.failures-- > 0) return { error: { message: "Synthetic atomic validation failure" } };
        return { error: null, data: null };
      },
    },
  };
  const functions = () => h.functions(["currentAppointmentAliases", "canonicalMaintenanceIds", "customerInstallationWorks",
    "maintenanceSelectionIsAvailable", "maintenanceQuoteItemsForInstallationIds", "maintenanceInstallationSummariesForIds",
    "saveMaintenanceAppointmentLinks", "saveSchedule"], { ...context, selected: state.selected, quoteItems: state.selected.quoteItems });
  return { state, aliasesRef, functions, save: () => functions().saveSchedule() };
}

test("scheduling selected real and mirror IDs saves one climate and links the canonical installation", async () => {
  const f = scheduleFixture();
  await f.save();
  assert.equal(f.state.persisted.length, 1);
  assert.deepEqual(f.state.persisted[0].maintenanceInstallationIds, ["installation"]);
  assert.equal(f.state.persisted[0].quoteItems.reduce((sum, item) => sum + item.quantity, 0), 1);
  assert.equal(f.state.persisted[0].maintenanceInstallations.length, 1);
  assert.deepEqual(f.state.rpc, [{ name: "replace_maintenance_appointment_links", args: {
    p_workspace_id: "workspace", p_maintenance_appointment_id: "maintenance", p_customer_id: "customer",
    p_installation_appointment_ids: ["installation"],
  } }]);
  assert.deepEqual(f.state.navigation, ["dashboard"]);
});

test("stale doubled draft items do not reject an available single-climate maintenance slot", async () => {
  const f = scheduleFixture({ slotCapacity: 1 });
  await f.save();
  assert.equal(f.state.persisted.length, 1, f.state.messages.map(item => item.message).join("; "));
  assert.equal(f.state.persisted[0].quoteItems.length, 1);
});

for (const ids of [["unknown"], ["installation", "unknown"], []]) {
  test(`invalid maintenance selection ${JSON.stringify(ids)} stops before persistence`, async () => {
    const f = scheduleFixture({ selected: { maintenanceInstallationIds: ids } });
    await f.save();
    assert.equal(f.state.persisted.length, 0);
    assert.equal(f.state.rpc.length, 0);
    assert.equal(f.state.navigation.length, 0);
    assert.equal(f.state.messages.length, 1);
  });
}

test("aliases from another workspace cannot make a stale selection writable", async () => {
  const f = scheduleFixture({ selected: { maintenanceInstallationIds: ["job"] } });
  f.state.workspace = "different-workspace";
  await f.save();
  assert.equal(f.functions().currentAppointmentAliases().size, 0);
  assert.equal(f.state.persisted.length, 0);
  assert.equal(f.state.rpc.length, 0);
});

test("atomic link failure retains the saved maintenance identity and retries without a second appointment", async () => {
  const f = scheduleFixture({ failures: 1 });
  await f.save();
  assert.equal(f.state.selected.activeAppointmentId, "maintenance");
  assert.equal(f.state.selected.activeQuoteId, "maintenance-quote");
  assert.equal(f.state.messages.at(-1).tone, "warning");
  assert.equal(f.state.navigation.length, 0);
  await f.save();
  assert.equal(f.state.persisted.length, 2);
  assert.equal(f.state.persisted[0].activeAppointmentId, undefined);
  assert.equal(f.state.persisted[1].activeAppointmentId, "maintenance");
  assert.equal(f.state.rpc.length, 2);
  assert.equal(f.state.rpc[1].args.p_maintenance_appointment_id, "maintenance");
  assert.deepEqual(f.state.rpc[1].args.p_installation_appointment_ids, ["installation"]);
  assert.deepEqual(f.state.navigation, ["work"]);
});

test("link RPC errors propagate and missing saved identity never starts a request", async () => {
  const f = scheduleFixture({ failures: 1 });
  await assert.rejects(f.functions().saveMaintenanceAppointmentLinks({ ...installation, activeAppointmentId: "maintenance" }, ["job", "installation"]),
    error => error.message === "Synthetic atomic validation failure");
  assert.equal(f.state.rpc.length, 1);
  await assert.rejects(f.functions().saveMaintenanceAppointmentLinks({ ...installation, activeAppointmentId: undefined }, ["installation"]), /azonosítója/);
  assert.equal(f.state.rpc.length, 1);
});

for (const { type, partial } of [{ type: "installation" }, { type: "maintenance" }, { type: "maintenance", partial: true }]) test(`customer reload canonicalizes stale ${type}${partial ? " partial-device" : ""} draft and phone-return context`, async () => {
  const records = h.load("src/lib/alinflow/appointment-records.ts");
  const origin = h.load("src/lib/alinflow/maintenance-origin.ts");
  const savedId = type === "maintenance" ? "maintenance" : "job";
  const draft = { customer: { ...installation, appointmentType: type, activeAppointmentId: savedId, notes: "Keep this edit",
    ...(partial ? { maintenanceDeviceSelections: { job: [{ productName: "Synthetic AC", unitNumber: 3 }] } } : {}),
    maintenanceInstallationIds: ["installation", "job"], maintenanceInstallations: [
      { appointmentId: "job", quoteItems: [item] }, { appointmentId: "installation", quoteItems: [item] }] },
    quoteItems: [item, item], scheduleDate: "2026-10-15", scheduleTime: "08:00", scheduleAppointmentType: type };
  const state = {};
  const aliases = { current: null };
  const context = { ...selection, ...devices, ...appointments, ...products, ...constants, ...records, ...origin,
    appointmentAliasesRef: aliases, loadCustomersPromiseRef: { current: null }, loadCustomersWorkspaceIdRef: { current: null },
    lastCustomerLoadRef: { current: null }, initialDataReadyRef: { current: false }, currentWorkspaceId: () => "workspace",
    selected: {}, products: [], documentsByCustomer: {}, EMPTY_QUOTE_ITEMS: [], LIST_PAGE_SIZE: 10,
    setDataLoading: noop, setMessage: noop, loadProductsFromDb: async () => [], loadSellerCompaniesFromDb: async () => [], loadInventoryFromDb: async () => {},
    readWorkspaceRows: async table => ({ error: null, data: table === "customers" ? [{ id: "customer", name: "Synthetic Customer" }]
      : table === "appointments" ? [{ id: "installation", workspace_id: "workspace", customer_id: "customer", appointment_type: "installation",
        quote_id: "installation-quote", scheduled_date: "2025-10-14", status: "Lezárva", legacy_source_key: "legacy-klima-xlsx:installation:synthetic", updated_at: "2026-10-15T09:00:00Z" },
        { id: "maintenance", workspace_id: "workspace", customer_id: "customer", appointment_type: "maintenance", scheduled_date: "2026-10-15", status: "Időpont foglalva" }]
      : table === "jobs" ? [{ id: "job", workspace_id: "workspace", customer_id: "customer", legacy_source_key: "appointments:installation" }]
      : table === "quotes" ? [{ id: "installation-quote", customer_id: "customer", appointment_id: "installation" }]
      : table === "quote_items" ? [{ quote_id: "installation-quote", product_name: "Synthetic AC", quantity: partial ? 4 : 1, unit_price: 100000 }] : [] }),
    customerLocationFromData: h.load("src/lib/alinflow/customers.ts").customerLocationFromData, postalCodeFromCustomerData: () => "", numericDbValue: () => undefined, stockDeductedFromWorkStatus: () => false,
    sortCustomersByCreatedAtDesc: value => value, setCustomers: noop, setWorkHistoryByCustomer: value => { state.history = value; },
    readReturnContext: () => ({ customerId: "customer", appointmentId: savedId, view: "work" }),
    readCustomerDraft: () => draft, setDraftNotice: noop, setSelected: value => { state.selected = value; },
    setQuoteItems: value => { state.items = value; }, setWorkChecklist: noop, effectiveChecklistFor: () => ({}), setInitialDataReady: noop,
    loadCustomerDetailData: async () => {}, setScheduleDate: noop, setScheduleTime: noop, setScheduleAppointmentType: noop,
    setEditCustomer: noop, setAllowWorkResourceEdit: noop, replaceView: value => { state.view = value; }, clearReturnContext: noop,
  };
  await h.functions(["loadCustomersFromDb", "quoteReceiptScopeFromRows", "restoreCustomerMaintenanceOrigin"], context).loadCustomersFromDb();
  assert.equal(aliases.current.ids.get("job"), "installation");
  assert.equal(state.history.customer.length, 2);
  assert.equal(state.history.customer.filter(work => work.appointmentType === "installation").length, 1);
  assert.equal(state.selected.activeAppointmentId, type === "maintenance" ? "maintenance" : "installation");
  assert.deepEqual(plain(state.selected.maintenanceInstallationIds), ["installation"]);
  assert.equal(state.selected.maintenanceInstallations.length, 1);
  assert.equal(state.selected.notes, "Keep this edit");
  assert.equal(state.view, "work");
  assert.equal(state.items.reduce((sum, item) => sum + item.quantity, 0), type === "maintenance" ? 1 : 2);
  assert.deepEqual(state.selected.quoteItems, state.items);
  assert.equal(draft.customer.activeAppointmentId, savedId, "stored snapshot was not mutated");
  assert.equal(draft.quoteItems.length, 2, "original quote snapshot was not mutated");
  if (partial) assert.deepEqual(plain(state.selected.maintenanceDeviceSelections), { installation: [{ productName: "Synthetic AC", unitNumber: 3 }] });
});

test("schedule persists only one of four devices and leaves the other installation intact", async () => {
  const source = { ...installation, quoteItems: [{ ...item, quantity: 4 }] };
  const second = { ...installation, activeAppointmentId: "second-installation", quoteItems: [{ ...item, customName: "Other model", quantity: 2 }] };
  const before = plain([source, second]);
  const selectedDevices = [{ productName: "Synthetic AC", unitNumber: 3 }];
  const f = scheduleFixture({ installations: [source, second], selected: { maintenanceInstallationIds: ["installation"],
    maintenanceDeviceSelections: { installation: selectedDevices }, quoteItems: source.quoteItems } });
  await f.save();
  assert.equal(f.state.persisted.length, 1, f.state.messages.map(item => item.message).join("; "));
  const saved = f.state.persisted[0];
  assert.equal(saved.quoteItems.reduce((sum, item) => sum + item.quantity, 0), 1);
  assert.equal(saved.maintenanceInstallations[0].quoteItems[0].quantity, 1);
  assert.deepEqual(saved.maintenanceInstallations[0].selectedDevices, selectedDevices);
  assert.deepEqual(f.state.rpc, [{ name: "replace_maintenance_device_links", args: { p_workspace_id: "workspace",
    p_maintenance_appointment_id: "maintenance", p_customer_id: "customer",
    p_installations: [{ installationId: "installation", selectedDevices }] } }]);
  assert.deepEqual([source, second], before);
});

test("partial-device link retry retains the saved appointment and exact unit selection", async () => {
  const source = { ...installation, quoteItems: [{ ...item, quantity: 4 }] };
  const selectedDevices = [{ productName: "Synthetic AC", unitNumber: 2 }];
  const f = scheduleFixture({ failures: 1, installations: [source], selected: { maintenanceInstallationIds: ["installation"],
    maintenanceDeviceSelections: { installation: selectedDevices } } });
  await f.save();
  assert.equal(f.state.selected.activeAppointmentId, "maintenance");
  assert.equal(f.state.messages.at(-1).tone, "warning");
  assert.deepEqual(f.state.navigation, []);
  await f.save();
  assert.equal(f.state.persisted.filter(work => !work.activeAppointmentId).length, 1, "one creation, then update the saved work");
  assert.equal(f.state.persisted[1].activeAppointmentId, "maintenance");
  assert.equal(f.state.persisted[1].quoteItems[0].quantity, 1);
  assert.deepEqual(f.state.rpc[0].args.p_installations, f.state.rpc[1].args.p_installations);
  assert.deepEqual(f.state.rpc[1].args.p_installations, [{ installationId: "installation", selectedDevices }]);
});

for (const selectedDevices of [[], [{ productName: "Synthetic AC", unitNumber: 5 }]]) test(`schedule rejects cleared or stale individual selection ${JSON.stringify(selectedDevices)}`, async () => {
  const f = scheduleFixture({ installations: [{ ...installation, quoteItems: [{ ...item, quantity: 4 }] }],
    selected: { maintenanceInstallationIds: ["installation"], maintenanceDeviceSelections: { installation: selectedDevices } } });
  await f.save();
  assert.equal(f.state.persisted.length, 0);
  assert.equal(f.state.rpc.length, 0);
  assert.equal(f.state.navigation.length, 0);
  assert.equal(f.state.messages.length, 1);
});

for (const selectionCase of ["partial", "legacy", "source-renamed"]) test(`database reload preserves ${selectionCase} maintenance quantities and the original installation`, async () => {
  const selectedDevices = selectionCase === "legacy" ? null : [{ productName: "Synthetic AC", unitNumber: 3 }];
  const rows = {
    customers: [{ id: "customer", workspace_id: "workspace", name: "Synthetic Customer" }],
    appointments: [
      { id: "installation", workspace_id: "workspace", customer_id: "customer", appointment_type: "installation", quote_id: "install-quote",
        scheduled_date: "2025-01-01", scheduled_time: "08:00", status: "Lezárva" },
      { id: "second-installation", workspace_id: "workspace", customer_id: "customer", appointment_type: "installation", quote_id: "second-quote",
        scheduled_date: "2025-01-02", scheduled_time: "08:00", status: "Lezárva" },
      { id: "maintenance", workspace_id: "workspace", customer_id: "customer", appointment_type: "maintenance", quote_id: "service-quote",
        scheduled_date: "2026-11-01", scheduled_time: "08:00", status: "Lezárva" },
    ],
    quotes: [{ id: "install-quote", customer_id: "customer", appointment_id: "installation" },
      { id: "second-quote", customer_id: "customer", appointment_id: "second-installation" },
      { id: "service-quote", customer_id: "customer", appointment_id: "maintenance" }],
    quote_items: [{ quote_id: "install-quote", product_name: selectionCase === "source-renamed" ? "Renamed AC" : "Synthetic AC", quantity: 4, unit_price: 100000 },
      { quote_id: "second-quote", product_name: "Other AC", quantity: 2, unit_price: 100000 },
      { quote_id: "service-quote", product_name: "Stale entire installation", quantity: 4, unit_price: 100000 }],
    maintenance_appointment_items: [{ maintenance_appointment_id: "maintenance", installation_appointment_id: "installation",
      customer_id: "customer", workspace_id: "workspace", selected_devices: selectedDevices }],
  };
  const before = plain(rows), state = { messages: [] };
  const context = { ...selection, ...devices, ...appointments, ...products, ...constants,
    ...h.load("src/lib/alinflow/appointment-records.ts"), ...h.load("src/lib/alinflow/maintenance-origin.ts"),
    ...h.load("src/lib/alinflow/customers.ts"), appointmentAliasesRef: { current: null },
    loadCustomersPromiseRef: { current: null }, loadCustomersWorkspaceIdRef: { current: null },
    lastCustomerLoadRef: { current: null }, initialDataReadyRef: { current: false }, currentWorkspaceId: () => "workspace",
    selected: {}, products: [], documentsByCustomer: {}, EMPTY_QUOTE_ITEMS: [], LIST_PAGE_SIZE: 10,
    setDataLoading: noop, setMessage: message => state.messages.push(message), loadProductsFromDb: async () => [],
    loadSellerCompaniesFromDb: async () => [], loadInventoryFromDb: async () => {},
    readWorkspaceRows: async table => ({ error: null, data: rows[table] || [] }),
    numericDbValue: () => undefined, stockDeductedFromWorkStatus: () => false,
    sortCustomersByCreatedAtDesc: value => value, setCustomers: noop, setWorkHistoryByCustomer: value => { state.history = value; },
  };
  await h.functions(["loadCustomersFromDb", "quoteReceiptScopeFromRows", "restoreCustomerMaintenanceOrigin"], context)
    .loadCustomersFromDb({ background: true, preserveEditing: true });
  assert.ok(state.history, state.messages.join("; "));
  const history = state.history.customer, maintenance = history.find(work => work.activeAppointmentId === "maintenance");
  assert.equal(history.find(work => work.activeAppointmentId === "installation").quoteItems[0].quantity, 4);
  assert.equal(history.find(work => work.activeAppointmentId === "second-installation").quoteItems[0].quantity, 2);
  assert.deepEqual(plain(maintenance.maintenanceInstallationIds), ["installation"]);
  assert.equal(maintenance.quoteItems.reduce((sum, item) => sum + item.quantity, 0), selectionCase === "legacy" ? 4 : 1);
  assert.deepEqual(plain(maintenance.maintenanceDeviceSelections || {}), selectedDevices ? { installation: selectedDevices } : {});
  assert.deepEqual(rows, before);
});
