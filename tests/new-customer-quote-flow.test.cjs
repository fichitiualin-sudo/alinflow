const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database, noop } = require("./helpers.cjs");

const h = harness();
const business = Object.assign({}, ...[
  "constants", "products", "appointments", "customers", "schedule", "documents",
  "work-report", "report-scope", "billing", "workspace-settings", "pagination",
].map((name) => h.load(`src/lib/alinflow/${name}.ts`)));
const workspaceId = "10000000-1111-4000-8000-000000000001";
const customerId = "20000000-1111-4000-8000-000000000001";
const quoteId = "30000000-1111-4000-8000-000000000001";
const appointmentId = "40000000-1111-4000-8000-000000000001";
const item = { productId: "", isManual: true, customName: "Szintetikus tesztklíma", quantity: 1, customPrice: 100000 };
const copy = (value) => JSON.parse(JSON.stringify(value));

// Exercise the real page handlers and document row builder. Only the database,
// email transport and React/browser state boundaries are replaced by fixtures.
function fixture({ rejectedEmail = false, rejectedDocumentWrites = 0 } = {}) {
  const state = {
    selected: { ...business.EMPTY_CUSTOMER, id: customerId, name: "Szintetikus ügyfél",
      email: "synthetic@example.invalid", status: "Visszahívandó", quoteItems: [] },
    quoteItems: [], customers: [], documentsByCustomer: {}, workHistoryByCustomer: {},
    workReportsByCustomer: {}, maintenanceReportsByCustomer: {}, purchaseDeclarationsByCustomer: {},
    workChecklistsByCustomer: {}, detailDataLoadedByCustomer: {}, detailDataLoadingByCustomer: {},
    view: "lead", messages: [], sends: [], operations: [], rpcCalls: [],
  };
  const tables = { customers: [], quotes: [], appointments: [], documents: [], work_reports: [], work_checklists: [], purchase_declarations: [] };
  const pendingActionsRef = { current: new Set() };
  const quoteReceiptsRef = { current: new Map() };
  const detailDataLoadedRef = { current: {} };
  const detailDataLoadingRef = { current: {} };
  const supabase = database(async (operation) => {
    state.operations.push(copy(operation));
    assert.equal(operation.value?.workspace_id || operation.filters.workspace_id, workspaceId);
    const rows = tables[operation.table];
    assert.ok(rows, `Unexpected table: ${operation.table}`);
    if (operation.method === "upsert") {
      if (operation.table === "documents" && rejectedDocumentWrites-- > 0) {
        return { data: null, error: { message: "Synthetic document write failure" } };
      }
      const payload = operation.value;
      const index = rows.findIndex((row) => operation.table === "documents"
        ? row.customer_id === payload.customer_id && row.document_type === payload.document_type && row.appointment_id === payload.appointment_id
        : row.id === payload.id);
      const saved = { id: "synthetic-document", created_at: new Date().toISOString(), ...(rows[index] || {}), ...copy(payload) };
      if (index >= 0) rows[index] = saved;
      else rows.push(saved);
      return { data: copy(saved), error: null };
    }
    if (operation.method === "update") {
      for (const row of rows) {
        if (Object.entries(operation.filters).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)) {
          Object.assign(row, copy(operation.value));
        }
      }
      return { data: null, error: null };
    }
    let data = rows.filter((row) => Object.entries(operation.filters)
      .every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
    if (operation.range) data = data.slice(operation.range[0], operation.range[1] + 1);
    return { data: copy(operation.single ? data[0] || null : data), error: null };
  });
  supabase.rpc = async (name, params) => {
    if (name === "save_appointment_with_resources") {
      assert.equal(params.p_customer_id, customerId);
      assert.equal(params.p_quote_id, quoteId);
      tables.appointments[0] = { id: appointmentId, customer_id: customerId, quote_id: quoteId,
        created_at: new Date().toISOString(), appointment_type: params.p_appointment_type,
        scheduled_date: params.p_scheduled_date, status: params.p_status };
      tables.quotes[0].appointment_id = appointmentId;
      return { data: { appointment_id: appointmentId }, error: null };
    }
    assert.equal(name, "save_quote_with_items");
    assert.equal(params.p_workspace_id, workspaceId);
    assert.equal(params.p_appointment_id, null);
    state.rpcCalls.push(copy(params));
    if (params.p_quote_id) assert.equal(params.p_quote_id, quoteId);
    tables.quotes[0] = { id: quoteId, customer_id: params.p_customer_id, appointment_id: null,
      created_at: tables.quotes[0]?.created_at || new Date().toISOString(),
      status: params.p_status, items: copy(params.p_items) };
    return { data: quoteId, error: null };
  };
  const setter = (key) => (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const names = [
    "beginAction", "endAction", "workspaceQuery", "withWorkspace", "readWorkspaceRows",
    "persistCustomerToDb", "isMissingPostalCodeColumnError", "withoutPostalCode",
    "saveCustomer", "sendQuoteEmail", "quotePayload", "logDocument", "promoteCustomerWork",
    "saveSchedule", "saveAppointmentWithJobMirror", "quoteReceiptScopeFromRows", "quoteDocumentFor",
    "updateWorkHistory", "shouldPromoteWorkToCustomerList", "documentsForCustomerScope",
    "docsFor", "docFor", "docStatus", "sentDocumentTimestamp", "quoteSentAtFor", "customerHasSentQuote",
    "formatQuoteSentAt", "documentRowsFor", "savedReportFor", "workAndDeclarationStatus",
    "purchaseDeclarationsFor", "effectiveChecklistFor", "workScopeKey",
    "loadCustomerDetailData", "customerWithDetailDocuments", "replaceLoadedDetailIds",
    "compareWorkReportsDesc", "reportDateSortValue",
  ];
  function render() {
    return h.functions(names, {
      ...business, ...state, supabase, user: { id: "synthetic-user" },
      workspaceSettings: business.defaultWorkspaceSettings(null), workReport: {}, workChecklist: business.EMPTY_WORK_CHECKLIST,
      currentWorkspaceId: () => workspaceId, pendingActionsRef, quoteReceiptsRef,
      notifyGoogleCalendarAppointmentsChanged: noop,
      normalizedScheduleAppointmentType: "installation", scheduleDate: "2026-10-12", scheduleTime: "08:00",
      allWorkCustomers: [], sendAppointmentNotice: false, maintenanceReturnRef: { current: null },
      detailDataLoadedRef, detailDataLoadingRef, selectedCustomerIdRef: { current: state.selected.id },
      quoteIssuedAt: "", setQuoteIssuedAt: noop, setPendingActions: noop, setQuoteEmailBusy: noop,
      setMessage: (message, tone) => state.messages.push({ message, tone }),
      setSelected: setter("selected"), setCustomers: setter("customers"),
      setDocumentsByCustomer: setter("documentsByCustomer"), setWorkHistoryByCustomer: setter("workHistoryByCustomer"),
      setWorkReportsByCustomer: setter("workReportsByCustomer"), setMaintenanceReportsByCustomer: setter("maintenanceReportsByCustomer"),
      setPurchaseDeclarationsByCustomer: setter("purchaseDeclarationsByCustomer"), setWorkChecklistsByCustomer: setter("workChecklistsByCustomer"),
      setDetailDataLoadedByCustomer: setter("detailDataLoadedByCustomer"), setDetailDataLoadingByCustomer: setter("detailDataLoadingByCustomer"),
      clearCustomerDraft: noop, readCustomerDraft: () => null, setDraftNotice: noop,
      navigateToView: setter("view"),
      replaceView: setter("view"),
      authenticatedFetch: async (url, request) => {
        assert.equal(url, "/api/send-quote");
        state.sends.push(JSON.parse(request.body));
        return rejectedEmail ? Response.json({ error: "Synthetic provider rejection" }, { status: 503 })
          : Response.json({ ok: true, id: "synthetic-provider-receipt" });
      },
    });
  }
  return { state, tables, render, quoteReceiptsRef, detailDataLoadedRef, detailDataLoadingRef };
}

async function openNewCustomerQuote(run) {
  await run.render().saveCustomer("quote");
  assert.equal(run.state.view, "quote");
  assert.equal(run.state.selected.activeQuoteId, quoteId);
  assert.equal(run.state.selected.status, "Visszahívandó");
  assert.equal(run.tables.documents.length, 0);
  run.state.quoteItems = [item];
}

test("new customer -> quote -> send persists the unbooked quote receipt and displays it after fresh document loading", async () => {
  const run = fixture();
  await openNewCustomerQuote(run);
  await run.render().sendQuoteEmail();
  assert.equal(run.state.sends.length, 1);
  assert.equal(run.state.sends[0].customer.id, customerId);
  assert.equal(run.state.sends[0].customer.activeAppointmentId, undefined);
  assert.equal(run.state.sends[0].items[0].name, item.customName);
  assert.equal(run.state.rpcCalls.length, 2);
  assert.equal(run.state.rpcCalls[1].p_quote_id, quoteId, "sending updates the saved quote instead of creating another");
  assert.equal(run.tables.quotes.length, 1);
  assert.equal(run.tables.documents.length, 1);
  const receipt = run.tables.documents[0];
  assert.equal(receipt.document_type, "quote_email");
  assert.equal(receipt.appointment_id, null);
  assert.equal(receipt.customer_id, customerId);
  assert.equal(receipt.status, "Elküldve");
  assert.ok(!Number.isNaN(Date.parse(receipt.sent_at)));
  assert.equal(run.state.selected.quoteSentAt, receipt.sent_at);
  assert.equal(run.state.messages.at(-1).tone, "success");
  assert.match(run.state.messages.at(-1).message, /Ajánlat elküldve: synthetic@example.invalid/);
  assert.match(run.render().documentRowsFor(run.state.selected)[0].status, /^Elküldve · /);

  // Discard every locally known receipt and restore only persisted customer data.
  // The visible sent timestamp must be recovered from the documents query.
  run.state.documentsByCustomer = {};
  run.state.selected = { ...run.tables.customers[0], activeQuoteId: quoteId, quoteItems: [item] };
  run.state.customers = [run.state.selected];
  assert.equal(run.state.selected.quoteSentAt, undefined);
  await run.render().loadCustomerDetailData([customerId], { force: true });
  assert.equal(run.state.documentsByCustomer[customerId].length, 1);
  assert.equal(run.state.selected.quoteSentAt, receipt.sent_at);
  assert.match(run.render().documentRowsFor(run.state.selected)[0].status, /^Elküldve · /);
  assert.equal(run.state.sends.length, 1, "reading the document library must not resend the quote");

  run.state.selected.quoteReceiptScope = run.render().quoteReceiptScopeFromRows(run.tables.quotes, [], quoteId);
  await run.render().saveSchedule();
  assert.equal(run.state.selected.activeAppointmentId, appointmentId);
  assert.equal(run.state.selected.status, "Időpont foglalva");
  const quoteReceipts = run.tables.documents.filter((row) => row.document_type === "quote_email");
  assert.equal(quoteReceipts.length, 2, "the original lead receipt and appointment receipt both remain");
  assert.equal(quoteReceipts.find((row) => row.appointment_id === null).sent_at, receipt.sent_at);
  assert.equal(quoteReceipts.find((row) => row.appointment_id === appointmentId).sent_at, receipt.sent_at);
  assert.equal(run.state.sends.length, 1, "booking only associates the existing receipt, without sending another quote");
  run.state.documentsByCustomer = {};
  run.state.selected = { ...run.tables.customers[0], activeQuoteId: quoteId, activeAppointmentId: appointmentId,
    date: "2026-10-12", quoteItems: [item] };
  run.state.customers = [run.state.selected];
  await run.render().loadCustomerDetailData([customerId], { force: true });
  assert.equal(run.state.selected.quoteSentAt, receipt.sent_at);
  assert.match(run.render().documentRowsFor(run.state.selected)[0].status, /^Elküldve · /);
});

test("new-customer accepted email with failed document write remains visible and retries only the receipt", async () => {
  const run = fixture({ rejectedDocumentWrites: 1 });
  await openNewCustomerQuote(run);
  await run.render().sendQuoteEmail();
  assert.equal(run.state.sends.length, 1);
  assert.equal(run.tables.documents.length, 0);
  assert.equal(run.state.messages.at(-1).tone, "warning");
  assert.match(run.state.messages.at(-1).message, /emailt elküldtük.*állapot mentése nem sikerült/);
  assert.equal(run.quoteReceiptsRef.current.size, 1);
  await run.render().sendQuoteEmail();
  assert.equal(run.state.sends.length, 1);
  assert.equal(run.tables.documents.length, 1);
  assert.equal(run.quoteReceiptsRef.current.size, 0);
  assert.match(run.render().documentRowsFor(run.state.selected)[0].status, /^Elküldve · /);
  assert.match(run.state.messages.at(-1).message, /Új email nem ment ki/);
});

test("new-customer quote rejection shows the failure without creating a sent document", async () => {
  const run = fixture({ rejectedEmail: true });
  await openNewCustomerQuote(run);
  await run.render().sendQuoteEmail();
  assert.equal(run.state.sends.length, 1);
  assert.equal(run.state.messages.at(-1).tone, "error");
  assert.match(run.state.messages.at(-1).message, /Synthetic provider rejection/);
  assert.equal(run.state.view, "quote");
  assert.equal(run.tables.documents.length, 0);
  assert.equal(run.state.selected.status, "Visszahívandó");
  assert.equal(run.render().documentRowsFor(run.state.selected)[0].status, "Nincs elküldve");
});

function historicalFixture() {
  const run = fixture();
  const quotes = [
    { id: "synthetic-orphan-draft", customer_id: customerId, appointment_id: null, created_at: "2026-10-08T10:00:00.000Z" },
    { id: quoteId, customer_id: customerId, appointment_id: appointmentId, created_at: "2026-10-08T10:01:00.000Z" },
  ];
  const appointments = [{ id: appointmentId, customer_id: customerId, quote_id: quoteId,
    appointment_type: "installation", created_at: "2026-10-08T10:03:00.000Z" }];
  const receipt = { id: "synthetic-historical-receipt", customerId, type: "quote_email", status: "Elküldve",
    sentAt: "2026-10-08T10:02:00.000Z" };
  run.state.selected = { ...run.state.selected, activeQuoteId: quoteId, activeAppointmentId: appointmentId,
    status: "Időpont foglalva", date: "2026-10-12", quoteItems: [item] };
  run.state.documentsByCustomer = { [customerId]: [receipt] };
  function deriveScope() {
    run.state.selected.quoteReceiptScope = run.render().quoteReceiptScopeFromRows(quotes, appointments, quoteId, appointmentId);
  }
  deriveScope();
  return { ...run, quotes, appointments, receipt, deriveScope };
}

test("historical first booking recognizes its prebooking quote despite an older orphan draft, without changing documents", () => {
  const run = historicalFixture();
  const originalDocuments = copy(run.state.documentsByCustomer);
  assert.ok(run.state.selected.quoteReceiptScope);
  assert.equal(run.render().quoteSentAtFor(run.state.selected), run.receipt.sentAt);
  assert.match(run.render().documentRowsFor(run.state.selected)[0].status, /^Elküldve · /);
  assert.equal(run.render().docsFor(run.state.selected).length, 0, "the general document scope must stay strict");
  assert.deepEqual(run.state.documentsByCustomer, originalDocuments);
  assert.equal(run.state.operations.length, 0, "legacy display repair must be read-only");
});

for (const [name, change] of [
  ["another installation", (run) => run.appointments.push({ ...run.appointments[0], id: "other-appointment" })],
  ["a separate maintenance appointment", (run) => run.appointments.push({ ...run.appointments[0], id: "maintenance", appointment_type: "maintenance" })],
  ["an older linked quote", (run) => { run.quotes[0].appointment_id = "other-appointment"; }],
  ["a later unlinked quote", (run) => { run.quotes[0].created_at = "2026-10-08T10:02:30.000Z"; }],
  ["ambiguous quote creation times", (run) => { run.quotes[0].created_at = run.quotes[1].created_at; }],
  ["an invalid older quote date", (run) => { run.quotes[0].created_at = "invalid"; }],
  ["another customer quote", (run) => { run.quotes[0].customer_id = "other-customer"; }],
  ["a mismatched appointment quote", (run) => { run.appointments[0].quote_id = "other-quote"; }],
  ["a receipt before the current quote", (run) => { run.receipt.sentAt = "2026-10-08T10:00:30.000Z"; }],
  ["a receipt after booking", (run) => { run.receipt.sentAt = "2026-10-08T10:03:30.000Z"; }],
  ["an undelivered document with only a creation date", (run) => { delete run.receipt.sentAt; run.receipt.status = "Mentve"; run.receipt.createdAt = "2026-10-08T10:02:00.000Z"; }],
]) {
  test(`historical quote receipt is not assigned when there is ${name}`, () => {
    const run = historicalFixture();
    change(run);
    run.deriveScope();
    assert.equal(run.render().quoteSentAtFor(run.state.selected), undefined);
    assert.equal(run.render().customerHasSentQuote(run.state.selected), false);
    assert.equal(run.render().documentRowsFor(run.state.selected)[0].status, "Nincs elküldve");
  });
}

test("a changed active quote or appointment cannot inherit the previous receipt proof", () => {
  const run = historicalFixture();
  for (const patch of [{ activeQuoteId: "other-quote" }, { activeAppointmentId: "other-appointment" }]) {
    assert.equal(run.render().quoteSentAtFor({ ...run.state.selected, ...patch }), undefined);
  }
});

test("an exact appointment quote receipt takes precedence over the historical lead receipt", () => {
  const run = historicalFixture();
  const scoped = { ...run.receipt, id: "synthetic-scoped-receipt", appointmentId, sentAt: "2026-10-08T10:04:00.000Z" };
  run.state.documentsByCustomer[customerId].push(scoped);
  assert.equal(run.render().quoteSentAtFor(run.state.selected), scoped.sentAt);
});
