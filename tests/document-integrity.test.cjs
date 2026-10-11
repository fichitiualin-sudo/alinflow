const test = require("node:test");
const assert = require("node:assert/strict");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness, database, identity, noop } = require("./helpers.cjs");
const h = harness({}, { "react/jsx-runtime": require("react/jsx-runtime") });
const reports = h.load("src/lib/alinflow/work-report.ts");
const appointments = h.load("src/lib/alinflow/appointments.ts");
const scope = h.load("src/lib/alinflow/report-scope.ts");
const declarations = h.load("src/lib/alinflow/purchase-declarations.ts");
const { WorkReportDocument, AllWorkReportsDocument } = h.load("src/components/alinflow/DocumentPreviewDocuments.tsx");
const { buildWorkReportHtml } = h.load("src/lib/alinflow/signed-document-export.ts");
const customer = { id: "customer-a", name: "CURRENT CUSTOMER", address: "CURRENT ADDRESS", city: "Current City",
  phone: "CURRENT PHONE", email: "current@example.invalid", appointmentType: "maintenance", activeAppointmentId: "maintenance-a",
  date: "2026-10-12", time: "08:00", quoteItems: [{ isManual: true, customName: "CURRENT AC", quantity: 3 }] };
const savedRow = (patch = {}) => ({ id: "saved-report-a", customer_id: customer.id, appointment_id: "installation-a", appointment_type: "installation",
  work_date: "2025-10-01", work_time: "08:00", customer_name: "SAVED CUSTOMER", customer_address: "SAVED ADDRESS",
  customer_email: "", customer_phone: "", climate_summary: "1 db SAVED AC", work_description: "SAVED WORK", notes: "",
  signature_data_url: "data:image/png;base64,U0lH", signed_at: "2025-10-01T08:00:00Z", signer_name: "SAVED SIGNER", ...patch });

test("work report mapping, preview and archive keep the signed customer/device snapshot including empty contact fields", () => {
  const report = reports.workReportFromRow(savedRow());
  assert.equal(report.documentSnapshot.customerName, "SAVED CUSTOMER");
  assert.equal(report.documentSnapshot.customerEmail, "");
  for (const html of [renderToStaticMarkup(WorkReportDocument({ customer, report, quoteItems: customer.quoteItems })),
    buildWorkReportHtml(customer, report, customer.quoteItems)]) {
    assert.match(html, /SAVED CUSTOMER/); assert.match(html, /SAVED ADDRESS/); assert.match(html, /SAVED AC/);
    assert.match(html, /data:image\/png;base64,U0lH/);
    assert.doesNotMatch(html, /CURRENT CUSTOMER|CURRENT ADDRESS|CURRENT AC|CURRENT PHONE|current@example/);
  }
});

test("email PDFs preserve explicitly blank saved customer fields and only use live data for legacy absent fields", () => {
  const { reportCustomer } = h.functions(["address", "reportCustomer"], {}, "src/lib/alinflow/document-pdf-render.ts");
  const saved = reportCustomer(savedRow({ customer_name: "", customer_address: null }), customer);
  assert.equal(saved.name, ""); assert.equal(saved.address, "");
  assert.equal(saved.email, ""); assert.equal(saved.phone, "");
  const legacy = reportCustomer({ signer_name: "Legacy signer" }, customer);
  assert.equal(legacy.name, customer.name); assert.equal(legacy.email, customer.email);
});

test("all worksheets includes every saved installation and maintenance, deduplicates IDs and excludes other customers/drafts", () => {
  const first = reports.workReportFromRow(savedRow());
  const second = reports.workReportFromRow(savedRow({ id: "saved-report-b", appointment_id: "installation-b", customer_address: "SECOND ADDRESS", climate_summary: "SECOND AC" }));
  const maintenance = reports.workReportFromRow(savedRow({ id: "maintenance-report", appointment_id: customer.activeAppointmentId, appointment_type: "maintenance", customer_address: "MAINTENANCE ADDRESS", climate_summary: "MAINTENANCE AC" }));
  const context = { ...appointments, selected: customer, workReportsByCustomer: { first, second, duplicate: first,
    foreign: { ...first, id: "foreign", customerId: "customer-b" }, draft: { ...first, id: undefined } },
    maintenanceReportsFor: () => [maintenance], compareWorkReportsDesc: () => 0 };
  const found = h.functions(["allWorkReportsForPreview"], context).allWorkReportsForPreview(customer);
  assert.deepEqual(Array.from(found, (report) => report.id).sort(), ["maintenance-report", "saved-report-a", "saved-report-b"]);
  const html = renderToStaticMarkup(AllWorkReportsDocument({ customer, reports: found, quoteItems: customer.quoteItems }));
  for (const value of ["SAVED AC", "SECOND AC", "MAINTENANCE AC", "SAVED ADDRESS", "SECOND ADDRESS", "MAINTENANCE ADDRESS"]) assert.match(html, new RegExp(value));
  assert.doesNotMatch(html, /CURRENT AC/);
});

test("an unsaved editor signature never authorizes maintenance closure; a committed signature still does", async () => {
  const persisted = reports.workReportFromRow(savedRow({ appointment_id: customer.activeAppointmentId, appointment_type: "maintenance", signature_data_url: "", signed_at: null }));
  const draft = { ...persisted, signatureDataUrl: "data:image/png;base64,U0lH", signedAt: "2026-10-12T10:00:00Z" };
  const writes = [], messages = [];
  const context = { ...reports, ...appointments, ...scope, selected: customer, quoteItems: customer.quoteItems,
    workReportsByCustomer: {}, maintenanceReportsByCustomer: { [customer.id]: [persisted] }, workReport: draft,
    workspaceSettings: { documentSettings: { privacyNotice: { enabled: false } } },
    persistCustomerToDb: async (value) => writes.push(value), logDocument: async () => {}, setSelected: noop,
    updateWorkHistory: noop, setAllowWorkResourceEdit: noop, setMessage: (message) => messages.push(message), replaceView: noop };
  let actions = h.functions(["savedReportFor", "markInstallationDone"], context);
  assert.equal(actions.savedReportFor(customer).signatureDataUrl, "");
  await actions.markInstallationDone(); assert.equal(writes.length, 0); assert.match(messages[0], /alá/);
  context.maintenanceReportsByCustomer[customer.id] = [draft];
  actions = h.functions(["savedReportFor", "markInstallationDone"], context);
  await actions.markInstallationDone(); assert.equal(writes.length, 1); assert.equal(writes[0].status, "Lezárva");
});

function loader(reply) {
  const state = { declaration: { id: "other-customer-declaration" }, items: [], keys: ["99"], sellerId: "other-seller", report: null, declarations: {} };
  const context = { ...reports, ...appointments, ...scope, ...declarations,
    currentWorkspaceId: () => "workspace-a", workspaceQuery: identity, workReportLoadSequence: { current: 0 },
    sellerCompanies: [{ id: "default-seller", isDefault: true }], scheduleDate: customer.date, scheduleTime: customer.time, shownTime: customer.time,
    setWorkReportDeclaration: (value) => { state.declaration = value; }, setWorkReportDeclarationItems: (value) => { state.items = value; },
    setPurchaseDeclarationItemKeys: (value) => { state.keys = value; }, setSelectedSellerId: (value) => { state.sellerId = value; },
    setWorkReport: (value) => { state.report = value; }, setWorkReportLoadBlocked: (value) => { state.blocked = value; },
    setPurchaseDeclarationsByCustomer: (value) => { state.declarations = value(state.declarations); },
    setWorkReportsByCustomer: noop, setMaintenanceReportsByCustomer: noop, setMessage: (value) => { state.error = value; }, compareWorkReportsDesc: () => 0,
    supabase: database(reply) };
  return { ...h.functions(["loadWorkReportFor"], context), state, context };
}

test("opening a signed report restores its own seller and selected historical device rather than another customer's choices", async () => {
  const declaration = { id: "saved-declaration", customer_id: customer.id, work_report_id: "saved-report-a", appointment_id: "installation-a",
    seller_company_id: "saved-seller", seller_name: "Saved seller", quote_items: [{ isManual: true, customName: "REMOVED HISTORICAL AC", quantity: 1 }] };
  const run = loader((op) => ({ data: op.table === "work_reports" ? [savedRow()] : [declaration], error: null }));
  await run.loadWorkReportFor({ ...customer, appointmentType: "installation", activeAppointmentId: "installation-a" });
  assert.equal(run.state.blocked, false); assert.equal(run.state.error, undefined);
  assert.equal(run.state.sellerId, "saved-seller"); assert.equal(run.state.declaration.id, declaration.id);
  assert.deepEqual(Array.from(run.state.keys), ["1"]);
  assert.equal(run.state.items[1].customName, "REMOVED HISTORICAL AC");
  assert.equal(run.state.declarations[customer.id][0].workReportId, "saved-report-a");
});

test("a new report resets declaration choices to its own devices and default seller", async () => {
  const run = loader(() => ({ data: [], error: null }));
  await run.loadWorkReportFor(customer);
  assert.equal(run.state.declaration, undefined); assert.equal(run.state.sellerId, "default-seller");
  assert.deepEqual(Array.from(run.state.keys), ["0"]); assert.equal(run.state.items[0].customName, "CURRENT AC");
});

test("historical declaration selection handles duplicate devices without selecting a different occurrence", () => {
  const item = { isManual: true, customName: "Same AC", quantity: 1 };
  const editor = declarations.purchaseDeclarationEditorItems([item, item], { quoteItems: [item, item] });
  assert.deepEqual(Array.from(editor.selectedKeys), ["0", "1"]);
  assert.equal(editor.items.length, 2);
});
