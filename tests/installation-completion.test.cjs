const assert = require("node:assert/strict");
const test = require("node:test");
const { harness, database, identity, noop } = require("./helpers.cjs");
const h = harness();
const appointments = h.load("src/lib/alinflow/appointments.ts");
const reports = h.load("src/lib/alinflow/work-report.ts");
const scopes = h.load("src/lib/alinflow/report-scope.ts");
const declarations = h.load("src/lib/alinflow/purchase-declarations.ts");
const products = h.load("src/lib/alinflow/products.ts");
const customer = { id: "22222222-2222-4222-8222-222222222222", name: "Synthetic customer", email: "synthetic@example.invalid",
  activeAppointmentId: "33333333-3333-4333-8333-333333333333", appointmentType: "installation", status: "Időpont foglalva",
  date: "2026-09-14", time: "08:00", address: "Synthetic street", quoteItems: [{ isManual: true, customName: "Synthetic AC", quantity: 1 }] };
const savedReportId = "44444444-4444-4444-8444-444444444444";
const savedDeclarationId = "55555555-5555-4555-8555-555555555555";
const base = { ...appointments, ...reports, ...scopes, ...declarations, ...products,
  workspaceQuery: identity, withWorkspace: identity, user: { id: "synthetic-user" },
  setSelected: noop, promoteCustomerWork: noop, setAllowWorkResourceEdit: noop, returnToLastMenu: noop };

function closeHarness(patch = {}) {
  const events = [], messages = [], sent = [];
  const completed = { ...customer, activeAppointmentId: "66666666-6666-4666-8666-666666666666", status: "Lezárva", stockDeducted: true };
  const context = { ...base, selected: customer, quoteItems: customer.quoteItems, checklistReady: true, missingChecklist: [],
    stockErrorMessage: () => "", setMessage: (value) => messages.push(value),
    completeInstallation: async (status) => { events.push(["complete", status]); return completed; },
    persistCustomerToDb: async () => { events.push(["persist"]); }, logDocument: async () => { events.push(["log"]); },
    returnToLastMenu: () => events.push(["return"]),
    sendThankYouEmailFor: async (target, automatic) => { sent.push({ target, automatic }); events.push(["email"]); return true; }, ...patch };
  return { ...h.functions(["closeWork"], context), events, messages, sent, completed };
}

test("successful installation closure sends once with the committed customer returned by completion", async () => {
  const run = closeHarness(); await run.closeWork();
  assert.deepEqual(run.events.map((event) => event[0]), ["complete", "return", "email"]);
  assert.equal(run.sent.length, 1); assert.equal(run.sent[0].target, run.completed); assert.equal(run.sent[0].automatic, true);
  assert.equal(run.events[0][1], "Lezárva");
});
test("failed closure, missing checklist and stock shortage never send a thank-you email", async () => {
  const runs = [
    closeHarness({ completeInstallation: async () => { throw new Error("synthetic save failure"); } }),
    closeHarness({ checklistReady: false, missingChecklist: ["Aláírás"] }),
    closeHarness({ stockErrorMessage: () => "synthetic shortage" }),
  ];
  for (const run of runs) { await run.closeWork(); assert.equal(run.sent.length, 0); assert.ok(run.messages.length); }
});
test("maintenance closure keeps its own persistence path and never sends installation thanks", async () => {
  const run = closeHarness({ selected: { ...customer, appointmentType: "maintenance" } }); await run.closeWork();
  assert.deepEqual(run.events.map((event) => event[0]), ["persist", "log", "return"]);
  assert.equal(run.sent.length, 0);
});
test("thank-you guards require a saved closed installation recipient and sending failure keeps closure intact", async () => {
  const sent = [], messages = [], busy = [];
  const run = h.functions(["sendThankYouEmailFor"], { ...base, selected: customer, quoteItems: customer.quoteItems,
    setMessage: (value) => messages.push(value), setThankYouEmailBusy: (value) => busy.push(value),
    quotePayload: (target) => ({ customer: target }), authenticatedFetch: async (_url, options) => { sent.push(JSON.parse(options.body)); return Response.json({ error: "synthetic email failure" }, { status: 503 }); } });
  for (const target of [customer, { ...customer, status: "Lezárva", email: "" }, { ...customer, status: "Lezárva", appointmentType: "maintenance" }]) {
    assert.equal(await run.sendThankYouEmailFor(target, true), false);
  }
  assert.equal(sent.length, 0);
  const completed = { ...customer, status: "Lezárva", stockDeducted: true };
  assert.equal(await run.sendThankYouEmailFor(completed, true), false);
  assert.equal(sent.length, 1); assert.equal(sent[0].customer.activeAppointmentId, customer.activeAppointmentId);
  assert.equal(completed.status, "Lezárva"); assert.deepEqual(busy, [true, false]);
  assert.match(messages.at(-1), /telepítés lezárva.*synthetic email failure/);
});

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function reportHarness({ type = "installation", fail, reportGate, declarationGate, signed = true, sendFailure = false } = {}) {
  const events = [], sent = [], states = [], messages = [], busy = [];
  const selected = { ...customer, appointmentType: type };
  const workReport = { ...reports.emptyWorkReport(selected), signatureDataUrl: signed ? "data:image/png;base64,U1lOVEhFVElD" : "", signedAt: signed ? "2026-09-14T08:00:00Z" : undefined };
  const db = database(async (op) => {
    if (op.table === "work_reports" && op.value?.work_description) {
      events.push("report-start"); if (reportGate) await reportGate.promise;
      if (fail === "report") return { data: null, error: { message: "synthetic report failure" } };
      events.push("report-saved");
      return { data: { ...op.value, id: savedReportId, legacy_source_key: "synthetic-report-link" }, error: null };
    }
    if (op.table === "purchase_declarations" && op.method === "select") return { data: null, error: null };
    if (op.table === "purchase_declarations" && op.method === "insert") {
      events.push("declaration-start"); if (declarationGate) await declarationGate.promise;
      if (fail === "declaration") return { data: null, error: { message: "synthetic declaration failure" } };
      events.push("declaration-saved"); return { data: { ...op.value, id: savedDeclarationId }, error: null };
    }
    if (op.table === "work_reports" && op.value?.email_sent_at) { events.push("delivery-marked"); return { error: null }; }
    throw Error(`Unexpected database call: ${op.table}/${op.method}`);
  });
  const context = { ...base, selected, workReport, quoteItems: customer.quoteItems, workReportBusy: false, workReportLoadBlocked: false,
    scheduleDate: customer.date, shownTime: customer.time, scheduleTime: customer.time,
    workspaceSettings: {}, sellerCompanies: [{ id: "synthetic-seller", name: "Synthetic seller", taxNumber: "TEST", representative: "Test" }], selectedSellerId: "synthetic-seller", purchaseDeclarationItemKeys: ["0"],
    supabase: db, savedReportFor: () => undefined, fullCustomerAddress: (value) => value.address,
    climateSummary: () => "Synthetic AC", isMissingSellerTableError: () => false,
    errorMentionsWorkReportType: () => false, errorMentionsWorkReportHistoryLink: () => false,
    setMessage: (value) => messages.push(value), setWorkReportBusy: (value) => busy.push(value), setWorkReportEmailBusy: noop,
    setWorkReport: (value) => states.push(value), setMaintenanceReportsByCustomer: noop, setWorkReportsByCustomer: noop, setPurchaseDeclarationsByCustomer: noop,
    logDocument: async () => {}, updateChecklistForCustomer: async () => {}, workReportKeyFromReport: (value) => value.id,
    compareWorkReportsDesc: () => 0, updateWorkHistory: noop, setWorkFocusTarget: noop, replaceView: noop,
    authenticatedFetch: async (url, options) => { events.push("email"); sent.push({ url, body: JSON.parse(options.body) }); return sendFailure ? Response.json({ error: "synthetic email failure" }, { status: 503 }) : Response.json({ ok: true }); },
  };
  return { ...h.functions(["saveWorkReport", "workReportPayload"], context), events, sent, states, messages, busy };
}

test("PDF email waits for report and declaration commits, then uses the new saved IDs", async () => {
  const reportGate = deferred(), declarationGate = deferred();
  const run = reportHarness({ reportGate, declarationGate });
  const pending = run.saveWorkReport(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(run.events, ["report-start"]); assert.equal(run.sent.length, 0);
  reportGate.resolve(); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(run.events, ["report-start", "report-saved", "declaration-start"]); assert.equal(run.sent.length, 0);
  declarationGate.resolve(); await pending;
  assert.deepEqual(run.events, ["report-start", "report-saved", "declaration-start", "declaration-saved", "email", "delivery-marked"]);
  assert.equal(run.sent.length, 1);
  assert.equal(run.sent[0].body.workReportId, savedReportId);
  assert.deepEqual(run.sent[0].body.purchaseDeclarationIds, [savedDeclarationId]);
  assert.equal(run.sent[0].body.customer.activeAppointmentId, customer.activeAppointmentId);
  assert.equal(run.sent[0].body.documents, "both");
  assert.equal(run.states[0].id, savedReportId);
  assert.deepEqual(run.busy, [true, false]);
});
test("report or declaration save failure cannot trigger PDF email", async () => {
  for (const fail of ["report", "declaration"]) {
    const run = reportHarness({ fail }); await run.saveWorkReport(true);
    assert.equal(run.sent.length, 0); assert.match(run.messages.at(-1), /synthetic .* failure/);
    assert.deepEqual(run.busy, [true, false]);
    if (fail === "declaration") assert.equal(run.states[0].id, savedReportId);
  }
});
test("maintenance PDF sends only the freshly saved report and never writes a purchase declaration", async () => {
  const run = reportHarness({ type: "maintenance" }); await run.saveWorkReport(true);
  assert.equal(run.sent.length, 1); assert.equal(run.sent[0].body.documents, "work_report");
  assert.deepEqual(run.sent[0].body.purchaseDeclarationIds, []);
  assert.equal(run.sent[0].body.workReportId, savedReportId);
  assert.equal(run.events.some((event) => event.startsWith("declaration")), false);
});
test("save-only and missing-signature actions never send PDF mail", async () => {
  const saveOnly = reportHarness(); await saveOnly.saveWorkReport(false);
  assert.equal(saveOnly.sent.length, 0); assert.ok(saveOnly.events.includes("declaration-saved"));
  const unsigned = reportHarness({ signed: false }); await unsigned.saveWorkReport(true);
  assert.equal(unsigned.sent.length, 0); assert.equal(unsigned.events.length, 0);
  assert.match(unsigned.messages.at(-1), /aláírás/);
});
test("PDF provider failure retains the saved report identity for retry", async () => {
  const run = reportHarness({ sendFailure: true }); await run.saveWorkReport(true);
  assert.equal(run.sent.length, 1); assert.equal(run.states[0].id, savedReportId);
  assert.ok(run.events.includes("declaration-saved")); assert.ok(!run.events.includes("delivery-marked"));
  assert.match(run.messages.at(-1), /synthetic email failure/);
  assert.deepEqual(run.busy, [true, false]);
});
