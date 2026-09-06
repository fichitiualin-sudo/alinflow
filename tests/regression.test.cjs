const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database, identity, noop, declarations, source } = require("./helpers.cjs");

const h = harness();
const products = h.load("src/lib/alinflow/products.ts");
const appointments = h.load("src/lib/alinflow/appointments.ts");
const reports = h.load("src/lib/alinflow/work-report.ts");
const scopes = h.load("src/lib/alinflow/report-scope.ts");
const materials = h.load("src/lib/alinflow/materials.ts");
const base = { ...products, ...appointments, ...reports, ...scopes,
  workspaceQuery: identity, withWorkspace: identity, workspaceOnConflict: identity,
  user: { id: "test-user" }, currentWorkspaceId: () => "test-workspace", normalizeStatus: identity };
const customer = { id: "test-customer", name: "Test Customer", email: "test@example.invalid",
  address: "Test 1", city: "Test", postalCode: "0000", date: "2026-09-06", time: "08:00",
  appointmentType: "installation", activeAppointmentId: "installation-B", quoteItems: [],
  status: "Időpont foglalva" };

test("A03: archived catalog items retain identity, name, quantity and historical price", () => {
  products.setActiveProducts([{ id: "ac", name: "Original AC", price: 300000, installPrice: 70000 }]);
  const item = products.quoteItemFromRow({ product_name: "Original AC", description: "ac|install_price=70000", quantity: 3, unit_price: 300000 });
  products.setActiveProducts([]);
  const cleaned = products.cleanQuoteItems([item]);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].productId, "ac");
  assert.equal(products.isCustomQuoteItem(cleaned[0]), false);
  assert.equal(products.itemName(cleaned[0]), "Original AC");
  assert.equal(products.total(cleaned), 900000);
  const reloaded = products.quoteItemFromRow(products.quoteItemToRow(cleaned[0], "quote"));
  assert.equal(reloaded.productId, "ac");
  assert.equal(products.total([reloaded]), 900000);
});

for (const panel of ["QuoteBuilderPanel", "SchedulePanel", "WorkPagePanel"]) {
  test("A03: " + panel + " renders the selected archived product instead of a blank input", () => {
    const react = require("react");
    const renderer = require("react-dom/server");
    const ui = harness({}, { "react/jsx-runtime": require("react/jsx-runtime") });
    const { ProductSelect } = ui.functions(["ProductSelect"], { sortProducts: products.sortProducts },
      "src/components/alinflow/" + panel + ".tsx");
    const html = renderer.renderToStaticMarkup(react.createElement(ProductSelect, {
      products: [], value: "archived-ac", snapshotName: "Historical AC", onChange: noop,
    }));
    assert.match(html, /<option value="archived-ac" selected="">Historical AC \(archivált\)<\/option>/);
  });
}

test("A11: zero-price historical rows are not replaced by catalog prices", () => {
  products.setActiveProducts([{ id: "ac", name: "AC", price: 300000, installPrice: 70000 }]);
  const item = products.quoteItemFromRow({ product_name: "AC", description: "ac|install_price=0", unit_price: 0, quantity: 3 });
  assert.equal(products.total([item]), 0);
  assert.equal(products.itemInstallTotal(item), 0);
});

test("A04: adding a product keeps it after the awaited database save", async () => {
  let state = [], resets = 0;
  const f = h.functions(["addClimateProduct", "saveClimateProduct"], {
    ...base, products: [], newProductName: "New AC", newProductPrice: "200000", newProductInstallPrice: "70000",
    DEFAULT_INSTALL_PRICE: 70000, setProducts: value => { state = typeof value === "function" ? value(state) : value; },
    setInventory: noop, ensureInventoryForProducts: identity, setProductBusy: noop, setProductMessage: noop,
    setNewProductName: () => resets++, setNewProductPrice: noop, setNewProductInstallPrice: noop,
    supabase: database(() => ({ error: null })),
  });
  await f.addClimateProduct();
  assert.equal(state.length, 1);
  assert.equal(state[0].price, 270000);
  assert.equal(resets, 1);
});

test("A04: failed product save leaves the entered form intact", async () => {
  let writes = 0, resets = 0;
  const f = h.functions(["addClimateProduct", "saveClimateProduct"], {
    ...base, products: [], newProductName: "New AC", newProductPrice: "200000", newProductInstallPrice: "70000",
    DEFAULT_INSTALL_PRICE: 70000, setProducts: () => writes++, setInventory: noop, setProductBusy: noop, setProductMessage: noop,
    setNewProductName: () => resets++, setNewProductPrice: noop, setNewProductInstallPrice: noop,
    supabase: database(() => ({ error: { message: "offline" } })),
  });
  await f.addClimateProduct();
  assert.equal(writes, 0);
  assert.equal(resets, 0);
});

test("A05: pending/future maintenance never makes an overdue installation current", () => {
  const mapping = h.load("src/lib/alinflow/maintenance-map.ts");
  const installation = { ...customer, date: "2020-01-01", status: "Lezárva" };
  const maintenance = { ...customer, activeAppointmentId: "maintenance-C", appointmentType: "maintenance",
    date: "2099-01-01", maintenanceInstallationIds: [customer.activeAppointmentId] };
  for (const status of ["Időpont foglalva", "Lemondva", "Lezárva"]) {
    const point = mapping.buildMaintenanceMapPoints([installation, { ...maintenance, status }])[0];
    assert.equal(point.maintenanceCount, 0);
    assert.equal(point.status, "overdue");
  }
  const done = mapping.buildMaintenanceMapPoints([installation, { ...maintenance, date: "2025-01-01", status: "Lezárva" }])[0];
  assert.equal(done.maintenanceCount, 1);
  assert.equal(done.lastMaintenanceDate, "2025-01-01");
});

test("A02: opening a new work never loads an old signed report", async () => {
  let current, queries = [];
  const f = h.functions(["loadWorkReportFor"], {
    ...base, scheduleDate: customer.date, scheduleTime: customer.time, shownTime: customer.time,
    workReportLoadSequence: { current: 0 }, setWorkReportLoadBlocked: noop, setMessage: noop,
    setWorkReport: value => { current = value; },
    supabase: database(op => { queries.push(op); return { data: [], error: null }; }),
  });
  await f.loadWorkReportFor(customer);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].filters.appointment_id, customer.activeAppointmentId);
  assert.equal(current.appointmentId, customer.activeAppointmentId);
  assert.equal(current.signatureDataUrl, "");
  assert.equal(current.id, undefined);
});

test("A02: lookup errors block editing, not silently create another report", async () => {
  let blocked = false, message = "";
  const f = h.functions(["loadWorkReportFor"], {
    ...base, scheduleDate: customer.date, scheduleTime: customer.time, shownTime: customer.time,
    workReportLoadSequence: { current: 0 }, setWorkReportLoadBlocked: v => blocked = v,
    setMessage: v => message = v, setWorkReport: noop,
    supabase: database(() => ({ data: null, error: { message: "offline" } })),
  });
  await f.loadWorkReportFor(customer);
  assert.equal(blocked, true);
  assert.match(message, /offline/);
});

test("A02: saving a report from another appointment never writes to the database", async () => {
  let writes = 0, message = "";
  const f = h.functions(["saveWorkReport"], {
    ...base, selected: customer, workReportBusy: false, workReportLoadBlocked: false,
    workReport: { ...reports.emptyWorkReport(customer), id: "old-report", appointmentId: "installation-A", signatureDataUrl: "signed" },
    setMessage: v => message = v, supabase: database(() => { writes++; return { error: null }; }),
  });
  await f.saveWorkReport();
  assert.equal(writes, 0);
  assert.match(message, /másik munkához/);
});

test("A02: cached maintenance of the same customer must also match appointment", () => {
  const f = h.functions(["savedReportFor"], { ...base, selected: customer, workReportsByCustomer: {},
    maintenanceReportsByCustomer: {}, workReport: { id: "maintenance-A", customerId: customer.id,
      appointmentId: "maintenance-A", appointmentType: "maintenance" } });
  assert.equal(f.savedReportFor({ ...customer, appointmentType: "maintenance" }), undefined);
});

test("A02: report navigation resolves the matching job's address and products", () => {
  const report = { id: "old", customerId: customer.id, appointmentId: "maintenance-old", appointmentType: "maintenance" };
  const f = h.functions(["customerForReport"], { workReportsByCustomer: {},
    maintenanceReportsByCustomer: { [customer.id]: [report] },
    allWorkCustomers: [{ ...customer, activeAppointmentId: report.appointmentId, appointmentType: "maintenance",
      address: "Other address", quoteItems: [{ customName: "Old AC", quantity: 3 }] }] });
  const scoped = f.customerForReport(customer, report.id);
  assert.equal(scoped.activeAppointmentId, report.appointmentId);
  assert.equal(scoped.address, "Other address");
  assert.equal(scoped.quoteItems[0].quantity, 3);
});

test("A06: failed atomic quote save never deletes rows through a separate request", async () => {
  const operations = [];
  const db = database(op => { operations.push(op); return { data: null, error: null }; });
  db.rpc = async (name, args) => { operations.push({ method: "rpc", name, args }); return { error: { message: "atomic insert failure" } }; };
  const f = h.functions(["persistCustomerToDb"], { ...base, isMissingPostalCodeColumnError: () => false, supabase: db });
  await assert.rejects(() => f.persistCustomerToDb({ ...customer, date: undefined, activeAppointmentId: undefined,
    activeQuoteId: "quote-A", quoteItems: [{ customName: "AC", quantity: 2, customPrice: 0 }] }),
    error => error.message === "atomic insert failure");
  assert.equal(operations.filter(op => op.method === "delete").length, 0);
  assert.equal(operations.at(-1).name, "save_quote_with_items");
  assert.equal(operations.at(-1).args.p_items[0].unit_price, 0);
});

test("A07/A12: stock completion uses one transactional RPC and no snapshot rollback", async () => {
  let selected, calls = [];
  const f = h.functions(["completeInstallation"], { ...base, selected: customer,
    quoteItems: [{ customName: "AC", quantity: 2, customPrice: 100 }],
    materials: [], materialOverrides: {}, stockMaterialQuantities: materials.stockMaterialQuantities,
    persistCustomerToDb: async () => ({ appointmentId: customer.activeAppointmentId, quoteId: "q" }),
    supabase: { rpc: async (name, args) => { calls.push([name, args]); return {
      data: [{ stock_deducted_at: "2026-09-06T00:00:00Z", status: "Lezárva" }], error: null }; } },
    setSelected: v => selected = v, promoteCustomerWork: noop, loadInventoryFromDb: noop, products: [] });
  await f.completeInstallation("Lezárva");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "complete_installation");
  assert.equal(selected.stockDeducted, true);
  assert.equal(declarations.has("restoreStockDeduction"), false);
  assert.equal(declarations.has("deductStockIfNeeded"), false);
});

test("A08: cancellation replaces the existing history entry immediately", async () => {
  let history = { [customer.id]: [customer] }, customers = [customer];
  const f = h.functions(["cancelAppointment", "promoteCustomerWork", "updateWorkHistory",
    "shouldPromoteWorkToCustomerList", "workCustomersForScheduling"], {
    ...base, selected: customer, setSelected: noop, setMessage: noop, returnToLastMenu: noop,
    persistCustomerToDb: async () => ({}), sortCustomersBySchedule: identity, sortCustomersByCreatedAtDesc: identity,
    setWorkHistoryByCustomer: fn => history = fn(history), setCustomers: fn => customers = fn(customers) });
  await f.cancelAppointment();
  const active = f.workCustomersForScheduling(customers, history).filter(row => row.status !== "Lemondva");
  assert.equal(active.length, 0);
  assert.equal(history[customer.id].length, 1);
});

test("A09: failed manual billing does not tick a box or report success", async () => {
  let writes = 0, uiChanges = 0, message = "";
  const f = h.functions(["markManualInvoice", "setChecklistItem", "updateChecklistForCustomer", "persistWorkChecklist", "workScopeKey"], {
    ...base, selected: customer, effectiveChecklistFor: () => ({ alinInvoice: false }),
    setWorkChecklist: () => uiChanges++, setWorkChecklistsByCustomer: () => uiChanges++,
    setMessage: v => message = v, supabase: database(() => { writes++; return { error: { message: "offline" } }; }) });
  await f.markManualInvoice("maintenance");
  assert.equal(writes, 1);
  assert.equal(uiChanges, 0);
  assert.match(message, /offline/);
  assert.doesNotMatch(message, /készre jelölve/);
});

test("A09: document errors never retry a customer-wide overwrite", async () => {
  let writes = 0;
  const f = h.functions(["logDocument"], { ...base, supabase: database(() => { writes++; return { error: { message: "offline" } }; }) });
  await assert.rejects(() => f.logDocument(customer, "work_report", "Report"), /offline/);
  assert.equal(writes, 1);
});

test("A10: persisted materials are isolated per work and default for new work", () => {
  const usage = { materials: [{ name: "Pipe", qty: "3", unit: "m" }], overrides: { Pipe: "15" } };
  assert.equal(materials.materialAmountForWork("Pipe", [{ customName: "AC", quantity: 3 }], usage), 15);
  assert.equal(materials.materialAmountForWork("Pipe", [{ customName: "AC", quantity: 3 }],
    { ...usage, overrides: {} }), 9);
  assert.equal(materials.materialAmountForWork("Pipe", [{ customName: "AC", quantity: 1 }]), 0);
  assert.match(declarations.get("saveWorkChanges"), /materialUsage: \{ materials, overrides: materialOverrides \}/);
  assert.match(source, /\[selected.id, selected.activeAppointmentId\]/);
});

test("A10: material reservation distinguishes two appointments of the same customer", () => {
  const workA = { ...customer, activeAppointmentId: "A", quoteItems: [{ customName: "AC", quantity: 1 }],
    materialUsage: { materials: [{ name: "Pipe", qty: "3", unit: "m" }], overrides: { Pipe: "7" } } };
  const f = h.functions(["materialReserved", "workScopeKey"], { ...base, materialAmountForWork: materials.materialAmountForWork,
    allWorkCustomers: [workA], selected: customer, shouldExcludeReservedWork: () => false,
    usedMaterialAmountForStock: () => 15 });
  assert.equal(f.materialReserved("Pipe"), 7);
});

function schedule(selected, onPersist) {
  return h.functions(["saveSchedule", "stockDeductedFromWorkStatus"], { ...base, selected,
    scheduleDate: "2026-09-07", scheduleTime: "08:00", normalizedScheduleAppointmentType: "installation",
    quoteItems: [{ customName: "AC", quantity: 1, customPrice: 100 }], allWorkCustomers: [],
    appointmentTimeAvailable: () => true, EMPTY_QUOTE_ITEMS: [],
    persistCustomerToDb: async value => { onPersist(value); return { appointmentId: value.activeAppointmentId || "new" }; },
    logDocument: noop, appointmentBookedDocumentType: () => "appointment", promoteCustomerWork: noop,
    setSelected: noop, sendAppointmentNotice: false, setMessage: noop, clearCustomerDraft: noop,
    readCustomerDraft: noop, setDraftNotice: noop, replaceView: noop });
}
test("A12: rescheduling a completed installation preserves the deducted state", async () => {
  let saved;
  await schedule({ ...customer, status: "Lezárva", stockDeducted: true, stockDeductedAt: "2026-01-01T00:00:00Z" },
    v => saved = v).saveSchedule();
  assert.equal(saved.status, "Lezárva");
  assert.equal(saved.stockDeductedAt, "2026-01-01T00:00:00Z");
});
test("A13: changing survey to installation creates a new work identity", async () => {
  let saved;
  await schedule({ ...customer, appointmentType: "survey", activeQuoteId: "survey-quote" }, v => saved = v).saveSchedule();
  assert.equal(saved.activeAppointmentId, undefined);
  assert.equal(saved.activeQuoteId, undefined);
  assert.equal(saved.appointmentType, "installation");
});

test("A14: failed detail reads preserve cache and allow retry", async () => {
  const loaded = { current: {} }, loading = { current: {} };
  let queries = 0, reportWrites = 0;
  const f = h.functions(["loadCustomerDetailData"], { ...base,
    detailDataLoadedRef: loaded, detailDataLoadingRef: loading,
    setDetailDataLoadingByCustomer: noop, setMessage: noop,
    setWorkReportsByCustomer: () => reportWrites++,
    readWorkspaceRows: async () => { queries++; return { error: { message: "offline" }, data: null }; } });
  await f.loadCustomerDetailData([customer.id]);
  await f.loadCustomerDetailData([customer.id]);
  assert.equal(queries, 8);
  assert.equal(reportWrites, 0);
  assert.equal(loaded.current[customer.id], undefined);
  assert.equal(loading.current[customer.id], false);
});

test("A15: a new appointment detects overlapping work for the same customer", () => {
  const scheduling = h.load("src/lib/alinflow/schedule.ts");
  const input = { customers: [customer], date: customer.date, time: customer.time,
    appointmentType: "maintenance", items: [], selectedCustomerId: customer.id };
  assert.equal(scheduling.appointmentTimeAvailable(input), false);
  assert.equal(scheduling.appointmentTimeAvailable({ ...input, selectedAppointmentId: customer.activeAppointmentId }), true);
});

test("R01: pagination reads every row even below the requested server page size", async () => {
  const { readAllRows } = h.load("src/lib/alinflow/pagination.ts");
  const expected = Array.from({ length: 1234 }, (_, id) => ({ id }));
  const result = await readAllRows(async (from, to) => ({ data: expected.slice(from, Math.min(to + 1, from + 37)), error: null }));
  assert.equal(result.data.length, 1234);
  assert.equal(new Set(result.data.map(row => row.id)).size, 1234);
  const failed = await readAllRows(async from => from ? { error: { message: "offline" } } : { data: expected.slice(0, 1) });
  assert.equal(failed.data.length, 0);
  assert.equal(failed.error.message, "offline");
});

test("R01: export follows server page limits and uses stable ordering", async () => {
  const { readAllRows } = h.load("src/lib/alinflow/pagination.ts");
  const rows = Array.from({ length: 1203 }, (_, id) => ({ id }));
  const operations = [];
  const f = h.functions(["fetchAllExportRows", "readWorkspaceRows"], { ...base, readAllRows,
    supabase: database(op => {
      operations.push(op);
      return { data: rows.slice(op.range[0], op.range[0] + 17), error: null };
    }),
  });
  const result = await f.fetchAllExportRows("customers");
  assert.equal(result.length, 1203);
  assert.equal(operations[0].filters.workspace_id, "test-workspace");
  assert.deepEqual(operations[0].order, ["created_at", "id"]);
});

test("A10: invalid materials prevent saving a work rather than persisting corrupt quantities", async () => {
  let writes = 0, message = "";
  const f = h.functions(["saveWorkChanges"], { ...base, selected: customer,
    workResourceEditLocked: false, allowWorkResourceEdit: true, quoteItems: [],
    materials: [{ name: "Pipe", qty: "-1", unit: "m" }], materialOverrides: {},
    stockMaterialQuantities: materials.stockMaterialQuantities,
    persistCustomerToDb: async () => { writes++; }, setMessage: v => message = v,
  });
  await f.saveWorkChanges();
  assert.equal(writes, 0);
  assert.match(message, /anyag/);
});

test("Positive controls: accent-insensitive search, postal codes, real signature requirement", () => {
  const search = h.functions(["normalizeSearch", "customerMatchesSearch"], base);
  for (const [name, query] of [["Kovács Péter", "KOVACS PETER"], ["Kovacs Peter", "Kovács Péter"]]) {
    assert.equal(search.customerMatchesSearch({ ...customer, name }, query, "all"), true);
  }
  assert.equal(search.customerMatchesSearch({ ...customer, city: "Gödöllő" }, "godollo", "all"), true);
  const postal = h.load("src/lib/alinflow/postal-codes.ts");
  assert.equal(postal.uniqueSettlementByCity("Godollo").postalCode, "2100");
  assert.equal(postal.uniqueSettlementByPostalCode("2100").city, "Gödöllő");
  assert.equal(reports.hasValidWorkReportSignature({ signedAt: "2026-09-06T00:00:00Z" }), false);
});
