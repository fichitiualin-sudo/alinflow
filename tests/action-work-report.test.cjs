const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database, identity } = require("./helpers.cjs");
const h = harness();
const reportTools = h.load("src/lib/alinflow/work-report.ts");
const appointments = h.load("src/lib/alinflow/appointments.ts");
const scopeTools = h.load("src/lib/alinflow/report-scope.ts");
const declarationTools = h.load("src/lib/alinflow/purchase-declarations.ts");
const workspaceId = "10000000-1111-4000-8000-000000000001";
const reportId = "40000000-1111-4000-8000-000000000001";
const declarationId = "50000000-1111-4000-8000-000000000001";
const customer = {
  id: "20000000-1111-4000-8000-000000000001", name: "Mesterséges Teszt", email: "synthetic@example.invalid",
  activeAppointmentId: "30000000-1111-4000-8000-000000000001", appointmentType: "installation",
  status: "Időpont foglalva", date: "2026-10-15", time: "08:00", address: "Teszt cím",
  quoteItems: [{ isManual: true, customName: "Teszt klíma", quantity: 1, customPrice: 100000 }],
};
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

function fixture(options = {}) {
  const selected = { ...customer, quoteItems: customer.quoteItems.map((item) => ({ ...item })), appointmentType: options.type || "installation" };
  const state = { report: { ...reportTools.emptyWorkReport(selected),
    signatureDataUrl: "data:image/png;base64,U1lOVEhFVElD", signedAt: "2026-10-15T09:00:00Z" },
    declarations: [], reports: {}, maintenance: {}, view: "workReport", workspaceId, busy: false, emailBusy: false };
  const calls = { db: [], send: [], message: [], checklist: [], log: [], navigation: [] };
  const pendingActionsRef = { current: new Set() };
  const workReportReceiptsRef = { current: new Map() };
  let reportFailures = options.reportFailures || 0;
  let declarationFailures = options.declarationFailures || 0;
  let deliveryFailures = options.deliveryFailures || 0;
  let logFailures = options.logFailures || 0;
  let checklistFailures = options.checklistFailures || 0;
  const db = database(async (op) => {
    calls.db.push(op);
    if (op.table === "work_reports" && op.value?.work_description) {
      if (options.onStage) await options.onStage("report-save");
      if (options.reportGate) await options.reportGate.promise;
      if (reportFailures-- > 0) return { error: { message: "synthetic report save failure" } };
      return { data: { ...op.value, id: reportId, legacy_source_key: "synthetic-report" }, error: null };
    }
    if (op.table === "work_reports" && op.value?.email_sent_at) {
      if (options.onStage) await options.onStage("delivery");
      if (deliveryFailures-- > 0) return { error: { message: "synthetic delivery mark failure" } };
      return { error: null };
    }
    if (op.table === "purchase_declarations" && op.method === "select") return { data: state.declarations[0] ? { id: declarationId } : null, error: null };
    if (op.table === "purchase_declarations" && ["insert", "update"].includes(op.method)) {
      if (declarationFailures-- > 0) return { error: { message: "synthetic declaration save failure" } };
      const row = { ...op.value, id: declarationId };
      state.declarations = [declarationTools.declarationFromRow(row)];
      return { data: row, error: null };
    }
    throw Error(`Unexpected synthetic DB operation ${op.table}/${op.method}`);
  });
  const context = {
    ...reportTools, ...appointments, ...scopeTools, ...declarationTools,
    selected, quoteItems: selected.quoteItems, user: { id: "synthetic-user" },
    workReportBusy: false, workReportLoadBlocked: false, pendingActionsRef, workReportReceiptsRef,
    currentWorkspaceId: () => state.workspaceId, setPendingActions() {},
    scheduleDate: selected.date, scheduleTime: selected.time, shownTime: selected.time,
    withWorkspace: identity, workspaceQuery: identity, workspaceSettings: {}, supabase: db,
    fullCustomerAddress: (value) => value.address, climateSummary: () => "Teszt klíma",
    sellerCompanies: [{ id: "synthetic-seller", name: "Teszt eladó", taxNumber: "TEST", representative: "Teszt" }],
    selectedSellerId: "synthetic-seller", purchaseDeclarationItemKeys: ["0"],
    workReportDeclarationItems: selected.quoteItems,
    savedReportFor: () => [...Object.values(state.reports), ...(state.maintenance[selected.id] || [])].find((report) => report.id === state.report.id),
    purchaseDeclarationsFor: () => state.declarations,
    isMissingSellerTableError: () => false, errorMentionsWorkReportType: () => false,
    errorMentionsWorkReportHistoryLink: () => false,
    setWorkReportBusy(value) { state.busy = value; }, setWorkReportEmailBusy(value) { state.emailBusy = value; },
    setMessage: (message, tone) => calls.message.push({ message, tone }),
    setWorkReport: (value) => { state.report = typeof value === "function" ? value(state.report) : value; },
    setWorkReportsByCustomer: (value) => { state.reports = value(state.reports); },
    setMaintenanceReportsByCustomer: (value) => { state.maintenance = value(state.maintenance); },
    setPurchaseDeclarationsByCustomer: (value) => { state.declarations = value({ [selected.id]: state.declarations })[selected.id]; },
    setWorkReportDeclaration: (value) => { state.editorDeclaration = value; },
    setSelectedSellerId: (value) => { context.selectedSellerId = value; },
    setPurchaseDeclarationItemKeys: (value) => { context.purchaseDeclarationItemKeys = value(context.purchaseDeclarationItemKeys); },
    setSelected() {}, updateWorkHistory() {}, compareWorkReportsDesc: () => 0, setWorkFocusTarget() {},
    replaceView: (value) => { state.view = value; calls.navigation.push(value); },
    logDocument: async (...args) => {
      calls.log.push(args);
      if (options.onStage) await options.onStage(args[1] === "work_report" ? "report-log" : "declaration-log");
      if (logFailures-- > 0) throw Error("synthetic document log failure");
    },
    updateChecklistForCustomer: async (...args) => {
      calls.checklist.push(args);
      if (options.onStage) await options.onStage("checklist");
      if (checklistFailures-- > 0) throw Error("synthetic checklist save failure");
    },
    authenticatedFetch: async (url, request) => {
      const payload = JSON.parse(request.body);
      calls.send.push({ url, payload });
      if (options.onStage) await options.onStage("provider");
      if (options.sendGate) await options.sendGate.promise;
      if (options.sendResponse) return options.sendResponse();
      return Response.json({ ok: true, workReportId: payload.documents === "purchase_declaration" ? null : payload.workReportId,
        purchaseDeclarationIds: payload.purchaseDeclarationIds });
    },
  };
  const render = () => h.functions(["beginAction", "endAction", "workReportPayload", "saveWorkReport", "sendSavedWorkDocuments", "updateWorkReportSignature", "togglePurchaseDeclarationItem", "selectWorkReportSeller"], {
    ...context, workReport: state.report, workReportDeclaration: state.editorDeclaration,
  });
  return { calls, state, context, pendingActionsRef, workReportReceiptsRef,
    sign: (image, signedAt) => render().updateWorkReportSignature(image, signedAt),
    toggleDeclaration: (key) => render().togglePurchaseDeclarationItem(key),
    chooseSeller: (id) => render().selectWorkReportSeller(id),
    switchWorkspace() {
      state.workspaceId = "10000000-1111-4000-8000-000000000002";
      state.report = { id: "new-workspace-report", notes: "New workspace" };
      state.reports = {}; state.maintenance = {}; state.declarations = [];
      state.view = "new-workspace";
      workReportReceiptsRef.current.clear();
      // The global action guard remains held until the original request finishes.
    },
    save: (sendEmail = true) => render().saveWorkReport(sendEmail),
    sendSaved: (documents = "work_report") => render().sendSavedWorkDocuments({ ...selected, activeWorkReportId: reportId }, documents),
  };
}

const reportWrites = (run) => run.calls.db.filter((op) => op.table === "work_reports" && op.value?.work_description);

test("a committed unsigned edit replaces the signed cache even when later document logging fails", async () => {
  const run = fixture({ logFailures: 1 });
  const previouslySigned = { ...run.state.report, id: reportId };
  run.state.reports["saved"] = previouslySigned;
  run.state.report = previouslySigned;
  run.sign("", undefined);
  await run.save(false);
  assert.equal(reportWrites(run).length, 1);
  const committed = Object.values(run.state.reports).find((report) => report.id === reportId && !report.signatureDataUrl);
  assert.ok(committed, "closure must see the committed unsigned report after a partial failure");
  assert.equal(run.calls.send.length, 0);
  assert.equal(run.state.view, "workReport");
  assert.ok(run.calls.message.some((item) => item.message.includes("synthetic document log failure")));
});

test("resaving a signed report keeps its captured customer/devices and saved declaration until a fresh signature", async () => {
  const run = fixture();
  await run.save(false);
  const original = reportWrites(run)[0].value;
  const signature = run.state.report.signatureDataUrl, signedAt = run.state.report.signedAt;
  const declarationWrites = () => run.calls.db.filter((op) => op.table === "purchase_declarations" && op.value);
  const originalDeclaration = JSON.stringify(run.state.declarations[0]);
  run.context.selected.name = "Changed customer";
  run.context.selected.address = "Changed address";
  run.context.quoteItems[0] = { isManual: true, customName: "Changed AC", quantity: 3 };
  await run.save(false);
  const unchanged = reportWrites(run).at(-1).value;
  for (const key of ["customer_name", "customer_address", "climate_summary", "signature_data_url", "signed_at"]) assert.equal(unchanged[key], original[key]);
  assert.equal(declarationWrites().length, 1);
  assert.equal(JSON.stringify(run.state.declarations[0]), originalDeclaration);
  run.sign(signature, "2026-10-16T10:00:00Z");
  await run.save(false);
  const fresh = reportWrites(run).at(-1).value;
  assert.equal(fresh.customer_name, "Changed customer");
  assert.match(fresh.climate_summary, /Changed AC/);
  assert.notEqual(fresh.signed_at, signedAt);
  assert.equal(declarationWrites().length, 2);
});

test("changing purchase items clears the old signature; only a new signature can update the declaration", async () => {
  const run = fixture();
  run.context.quoteItems.push({ isManual: true, customName: "Second AC", quantity: 1 });
  await run.save(false);
  const original = JSON.stringify(run.state.declarations[0]);
  run.toggleDeclaration("0"); run.toggleDeclaration("1");
  assert.equal(run.state.report.signatureDataUrl, "");
  assert.equal(run.state.report.signedAt, undefined);
  await run.save(false);
  assert.equal(JSON.stringify(run.state.declarations[0]), original);
  run.sign("data:image/png;base64,TkVX", "2026-10-16T10:00:00Z");
  await run.save(false);
  const saved = run.state.declarations[0];
  assert.equal(saved.quoteItems[0].customName, "Second AC");
  assert.equal(saved.signedAt, "2026-10-16T10:00:00Z");
  assert.equal(saved.signatureDataUrl, "data:image/png;base64,TkVX");
});

test("changing the purchase seller clears its old signature and optional notice", async () => {
  const run = fixture();
  run.state.report.privacyNotice = { synthetic: true };
  run.chooseSeller("second-seller");
  assert.equal(run.context.selectedSellerId, "second-seller");
  assert.equal(run.state.report.signatureDataUrl, "");
  assert.equal(run.state.report.privacyNotice, undefined);
});

test("shared synchronous guard blocks simultaneous report saves and saved-PDF sends", async () => {
  const gate = deferred();
  const run = fixture({ reportGate: gate });
  const saving = run.save();
  await Promise.all([run.save(), run.sendSaved()]);
  assert.equal(reportWrites(run).length, 1);
  assert.equal(run.calls.send.length, 0);
  gate.resolve();
  await saving;
  assert.equal(run.calls.send.length, 1);
  assert.equal(run.pendingActionsRef.current.size, 0);
});

test("shared synchronous guard also blocks saves during an active saved-PDF send", async () => {
  const gate = deferred();
  const run = fixture({ sendGate: gate });
  const sending = run.sendSaved();
  await run.save();
  assert.equal(reportWrites(run).length, 0);
  assert.equal(run.calls.send.length, 1);
  gate.resolve();
  await sending;
  assert.equal(run.pendingActionsRef.current.size, 0);
});

test("failed report persistence shows an error and never sends or navigates", async () => {
  const run = fixture({ reportFailures: 1 });
  await run.save();
  assert.equal(run.state.report.id, undefined);
  assert.equal(run.calls.send.length, 0);
  assert.equal(run.calls.message.at(-1).tone, "error");
  assert.match(run.calls.message.at(-1).message, /Munkalap mentési hiba.*synthetic report save failure/);
  assert.deepEqual(run.calls.navigation, []);
});

test("saved report survives declaration failure; retry updates the saved identity", async () => {
  const run = fixture({ declarationFailures: 1 });
  await run.save();
  assert.equal(run.state.report.id, reportId);
  assert.equal(run.calls.send.length, 0);
  assert.equal(run.calls.message.at(-1).tone, "warning");
  assert.match(run.calls.message.at(-1).message, /A munkalap mentve.*synthetic declaration save failure/);
  await run.save();
  assert.equal(reportWrites(run)[1].method, "update");
  assert.equal(reportWrites(run)[1].filters.id, reportId);
  assert.equal(run.calls.send.length, 1);
  assert.equal(run.state.view, "work");
});

for (const response of [() => Response.json({ error: "synthetic provider failure" }, { status: 503 }), () => Response.json({})]) {
  test("unconfirmed PDF delivery reports the saved report without claiming email success", async () => {
    const run = fixture({ sendResponse: response });
    await run.save();
    assert.equal(run.state.report.id, reportId);
    assert.equal(run.workReportReceiptsRef.current.size, 0);
    assert.equal(run.calls.message.at(-1).tone, "warning");
    assert.match(run.calls.message.at(-1).message, /A munkalap mentve, de a PDF-küldés nem fejeződött be/);
    assert.deepEqual(run.calls.navigation, []);
  });
}

for (const failure of ["deliveryFailures", "logFailures", "checklistFailures"]) {
  test(`accepted PDF with ${failure} retries only bookkeeping and preserves later editor changes`, async () => {
    const run = fixture({ [failure]: 1 });
    await run.save();
    assert.equal(run.state.report.id, reportId);
    assert.equal(run.calls.send.length, 1);
    assert.equal(run.workReportReceiptsRef.current.size, 1);
    assert.equal(run.calls.message.at(-1).tone, "warning");
    assert.match(run.calls.message.at(-1).message, /munkalap mentve és a PDF-ek elküldve/);
    const stateBeforeRetry = reportWrites(run).length;
    run.state.report = { ...run.state.report, notes: "Új, még nem mentett módosítás" };
    await run.save();
    assert.equal(run.calls.send.length, 1);
    assert.equal(reportWrites(run).length, stateBeforeRetry);
    assert.equal(run.workReportReceiptsRef.current.size, 0);
    assert.equal(run.state.report.notes, "Új, még nem mentett módosítás");
    assert.ok(run.state.report.emailSentAt);
    assert.equal(run.calls.message.at(-1).tone, "success");
    assert.match(run.calls.message.at(-1).message, /Új email nem ment ki/);
    assert.equal(run.calls.checklist.at(-1)[1].docsSent, true);
    assert.equal(run.calls.checklist.at(-1)[1].signature, true);
    assert.equal(run.pendingActionsRef.current.size, 0);
  });
}

test("accepted saved-document email with failed logging retries without another PDF send", async () => {
  const run = fixture({ logFailures: 1 });
  assert.equal(await run.sendSaved(), false);
  assert.equal(run.calls.send.length, 1);
  assert.equal(run.workReportReceiptsRef.current.size, 1);
  assert.equal(run.calls.message.at(-1).tone, "warning");
  assert.equal(await run.sendSaved(), true);
  assert.equal(run.calls.send.length, 1);
  assert.equal(run.workReportReceiptsRef.current.size, 0);
  assert.match(run.calls.message.at(-1).message, /Új email nem ment ki/);
});

test("saved-PDF 200 response without ok is not accepted or logged", async () => {
  const run = fixture({ sendResponse: () => Response.json({}) });
  assert.equal(await run.sendSaved(), false);
  assert.equal(run.calls.message.at(-1).tone, "error");
  assert.equal(run.calls.log.length, 0);
  assert.equal(run.workReportReceiptsRef.current.size, 0);
});

for (const handler of ["save", "sendSaved"]) {
  for (const stage of ["provider", "delivery", "report-log", "declaration-log", "checklist"]) {
    test(`${handler}: workspace change during ${stage} stops stale receipts, writes, feedback and navigation`, async () => {
      const entered = deferred(), gate = deferred();
      const run = fixture({ onStage: (current) => {
        if (current === stage) { entered.resolve(); return gate.promise; }
      } });
      if (handler === "sendSaved") run.state.declarations = [{ id: declarationId, workReportId: reportId }];
      const action = handler === "save" ? run.save() : run.sendSaved("both");
      await entered.promise;
      const counts = { db: run.calls.db.length, log: run.calls.log.length, checklist: run.calls.checklist.length, message: run.calls.message.length };
      run.switchWorkspace();
      gate.resolve();
      await action;
      assert.equal(run.workReportReceiptsRef.current.size, 0);
      assert.equal(run.calls.db.length, counts.db);
      assert.equal(run.calls.log.length, counts.log);
      assert.equal(run.calls.checklist.length, counts.checklist);
      assert.equal(run.calls.message.length, counts.message);
      assert.deepEqual(run.calls.navigation, []);
      assert.equal(run.state.report.id, "new-workspace-report");
      assert.equal(run.state.report.emailSentAt, undefined);
      assert.deepEqual(run.state.reports, {});
      assert.deepEqual(run.state.maintenance, {});
      assert.equal(run.state.view, "new-workspace");
      assert.equal(run.state.busy, false);
      assert.equal(run.state.emailBusy, false);
      assert.equal(run.pendingActionsRef.current.has("work-report"), false);
    });
  }
}
