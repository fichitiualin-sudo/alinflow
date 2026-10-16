const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database, noop } = require("./helpers.cjs");
const { privacyNotice, signature } = require("./document-pdf-fixtures.cjs");
const h = harness();
const appointments = h.load("src/lib/alinflow/appointments.ts");
const reports = h.load("src/lib/alinflow/work-report.ts");
const scopes = h.load("src/lib/alinflow/report-scope.ts");
const privacy = h.load("src/lib/alinflow/privacy-notice.ts");
const documents = h.load("src/lib/alinflow/documents.ts");
const declarations = h.load("src/lib/alinflow/purchase-declarations.ts");
const common = { ...appointments, ...reports, ...scopes, ...privacy, ...documents, ...declarations };
const plain = value => JSON.parse(JSON.stringify(value));
const customer = { id: "synthetic-customer", name: "Synthetic customer", phone: "", email: "synthetic@example.invalid",
  address: "Synthetic address", city: "Synthetic city", activeAppointmentId: "other-work", activeQuoteId: "service-quote",
  appointmentType: "other", date: "2026-10-16", time: "10:00", status: "Időpont foglalva", stockDeducted: false,
  quoteItems: [{ itemType: "extra", customName: "Javítás", isManual: true, quantity: 1, customPrice: 12000 }] };
function savedReport(extra = {}) {
  return { ...reports.emptyWorkReport(customer), id: "service-report", signatureDataUrl: signature(), signerName: customer.name,
    signedAt: "2026-10-16T11:00:00Z", ...extra };
}
function noticeFor(report) {
  const saved = privacyNotice();
  return privacyNotice({ version: privacy.OTHER_PRIVACY_NOTICE_VERSION, controllers: [saved.controllers[1]],
    signatureDataUrl: report.signatureDataUrl, signerName: report.signerName, signedAt: report.signedAt });
}
function closing(options = {}) {
  const state = { writes: [], logs: [], messages: [], selected: null, view: null, pending: new Set() };
  const report = options.report || savedReport();
  const context = { ...common, selected: options.customer || customer, quoteItems: customer.quoteItems,
    workReportsByCustomer: { saved: report, ...(options.extraReports || {}) }, maintenanceReportsByCustomer: {},
    workReport: savedReport(), workspaceSettings: { documentSettings: { privacyNotice: { enabled: !!options.privacyEnabled } } },
    beginAction: key => { if (state.pending.has(key)) return false; state.pending.add(key); return true; },
    endAction: key => state.pending.delete(key),
    persistCustomerToDb: async value => { if (options.gate) await options.gate; if (options.failure) throw Error("Synthetic save failure"); state.writes.push(plain(value)); },
    logDocument: async (...args) => state.logs.push(args),
    setSelected: value => { state.selected = value; }, promoteCustomerWork: noop, setAllowWorkResourceEdit: noop,
    setMessage: value => state.messages.push(value), replaceView: value => { state.view = value; },
    stockErrorMessage: () => { throw Error("Other work must not inspect installation stock"); },
    completeInstallation: () => { throw Error("Other work must not complete an installation"); },
    sendThankYouEmailFor: () => { throw Error("Other work must not send installation thank-you mail"); },
  };
  return { ...h.functions(["savedReportFor", "markInstallationDone"], context), state };
}

test("other closure requires a persisted signature for this customer, work and type", async () => {
  for (const patch of [{ signatureDataUrl: "", signedAt: undefined }, { id: undefined },
    { appointmentId: "old-installation", appointmentType: "installation" }, { appointmentId: "another-service" },
    { customerId: "another-customer" }]) {
    const f = closing({ report: savedReport(patch) });
    await f.markInstallationDone();
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.state.logs.length, 0);
    assert.match(f.state.messages.at(-1), /írasd alá/);
  }
});

test("signed other work closes only itself without installation records, inventory or thank-you mail", async () => {
  const f = closing({ extraReports: { old: savedReport({ id: "old-report", appointmentId: "old-installation", appointmentType: "installation" }) } });
  await f.markInstallationDone();
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.writes[0].activeAppointmentId, "other-work");
  assert.equal(f.state.writes[0].activeQuoteId, "service-quote");
  assert.equal(f.state.writes[0].status, "Lezárva");
  assert.equal(f.state.writes[0].stockDeducted, false);
  assert.equal(f.state.logs.length, 1);
  assert.equal(f.state.logs[0][1], "work_closed");
  assert.equal(f.state.logs[0][0].activeAppointmentId, "other-work");
  assert.equal(f.state.view, "work");
});

test("other closure requires the matching privacy signature when its workspace notice is enabled", async () => {
  const report = savedReport();
  for (const notice of [undefined, noticeFor({ ...report, signatureDataUrl: "data:image/png;base64,QkFE" })]) {
    const f = closing({ report: { ...report, privacyNotice: notice }, privacyEnabled: true });
    await f.markInstallationDone();
    assert.equal(f.state.writes.length, 0);
    assert.match(f.state.messages.at(-1), /adatkezelési/);
  }
  const f = closing({ report: { ...report, privacyNotice: noticeFor(report) }, privacyEnabled: true });
  await f.markInstallationDone();
  assert.equal(f.state.writes.length, 1);
});

test("other closure failure and a same-tick repeat cannot produce false or duplicate completion", async () => {
  const failed = closing({ failure: true }); await failed.markInstallationDone();
  assert.equal(failed.state.logs.length, 0); assert.equal(failed.state.selected, null);
  assert.equal(failed.state.pending.size, 0); assert.match(failed.state.messages.at(-1), /Synthetic save failure/);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = closing({ gate }); const first = f.markInstallationDone(); const second = f.markInstallationDone();
  release(); await Promise.all([first, second]);
  assert.equal(f.state.writes.length, 1); assert.equal(f.state.logs.length, 1); assert.equal(f.state.pending.size, 0);
});

function cancellation(options = {}) {
  const state = { requests: [], history: [], selected: null, messages: [], view: null };
  const context = { ...common, selected: customer, currentWorkspaceId: () => "workspace", notifyGoogleCalendarAppointmentsChanged: noop,
    supabase: { from: () => { throw Error("Cancellation must not mutate base customer/quotes"); }, rpc: async (name, args) => {
      state.requests.push({ name, args });
      if (options.failure) return { error: Error("Synthetic cancellation failure") };
      return { data: [{ appointment_id: options.mismatch ? "foreign-work" : customer.activeAppointmentId, job_id: "mirror" }] };
    } },
    setSelected: value => { state.selected = value; }, updateWorkHistory: value => state.history.push(value), setAllowWorkResourceEdit: noop,
    setMessage: value => state.messages.push(value), replaceView: value => { state.view = value; },
    persistCustomerToDb: () => { throw Error("Cancellation must not rewrite a quote"); },
  };
  return { ...h.functions(["cancelAppointment", "cancelAppointmentWithJobMirror"], context), state };
}

test("other cancellation affects the verified work only and keeps previous customer jobs and quote identities", async () => {
  const f = cancellation(); await f.cancelAppointment();
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0].name, "cancel_appointment_with_job_mirror");
  assert.equal(f.state.requests[0].args.p_appointment_id, "other-work");
  assert.equal(f.state.requests[0].args.p_customer_id, customer.id);
  assert.equal(f.state.requests[0].args.p_workspace_id, "workspace");
  assert.equal(f.state.history.length, 1); assert.equal(f.state.history[0].status, "Lemondva");
  assert.equal(f.state.selected.activeQuoteId, "service-quote"); assert.equal(f.state.selected.appointmentType, "other");
  assert.equal(f.state.view, "work");
});

test("failed or unverified other cancellation cannot mark local work as cancelled", async () => {
  for (const options of [{ failure: true }, { mismatch: true }]) {
    const f = cancellation(options); await f.cancelAppointment();
    assert.equal(f.state.history.length, 0); assert.equal(f.state.selected, null); assert.equal(f.state.view, null);
    assert.match(f.state.messages.at(-1), /lemondási hiba/);
  }
});

function reportFlow(options = {}) {
  const row = extra => ({ id: "service-report", customer_id: customer.id, appointment_id: customer.activeAppointmentId,
    appointment_type: "other", work_date: customer.date, work_time: customer.time,
    legacy_source_key: "work_reports:service-report", ...extra });
  const state = { report: savedReport({ id: options.existing ? "service-report" : undefined }), reports: {}, messages: [], requests: [], writes: [], logs: [], checklists: [], view: "workReport" };
  const db = database(op => {
    state.writes.push(op);
    assert.equal(op.table, "work_reports", "Service work must never create a purchase declaration");
    if (op.value?.appointment_type) {
      assert.equal(op.value.appointment_type, "other"); assert.equal(op.value.appointment_id, "other-work");
      if (op.method === "update") assert.equal(op.filters.id, "service-report");
      return { data: row(op.value) };
    }
    if (op.value?.email_sent_at) return { data: null };
    throw Error("Unexpected service report query");
  });
  const context = { ...common, selected: customer, quoteItems: customer.quoteItems, user: { id: "user" },
    workReportLoadBlocked: false, pendingActionsRef: { current: new Set() }, setPendingActions: noop,
    workReportReceiptsRef: { current: new Map() }, workReportDeclaration: undefined,
    currentWorkspaceId: () => "workspace", withWorkspace: value => ({ ...value, workspace_id: "workspace" }),
    workspaceQuery: query => query.eq("workspace_id", "workspace"), supabase: db,
    scheduleDate: customer.date, scheduleTime: customer.time, shownTime: customer.time,
    setWorkReport: value => { state.report = value; }, setWorkReportBusy: noop, setWorkReportEmailBusy: noop,
    setWorkReportsByCustomer: update => { state.reports = update(state.reports); },
    setMaintenanceReportsByCustomer: () => { throw Error("Other report must not enter maintenance report cache"); },
    setSelected: noop, updateWorkHistory: noop, errorMentionsWorkReportHistoryLink: () => false,
    savedReportFor: () => options.existing ? state.report : undefined,
    logDocument: async (...args) => state.logs.push(args), updateChecklistForCustomer: async (_customer, checklist) => state.checklists.push(checklist),
    setMessage: message => state.messages.push(message), setWorkFocusTarget: noop, replaceView: view => { state.view = view; },
    workReportPayload: (report, target, declarationIds, documents) => ({ reportId: report.id, appointmentId: target.activeAppointmentId, declarationIds, documents }),
    authenticatedFetch: async (url, init) => { state.requests.push({ url, body: JSON.parse(init.body) }); return Response.json({ ok: true }); },
  };
  return { state, save: (sendEmail = false) => h.functions(["beginAction", "endAction", "saveWorkReport"], { ...context, workReport: state.report }).saveWorkReport(sendEmail) };
}

test("other report insert and update save only its own scoped signed worksheet", async () => {
  for (const existing of [false, true]) {
    const f = reportFlow({ existing }); await f.save();
    assert.equal(f.state.writes.length, 1); assert.equal(f.state.writes[0].method, existing ? "update" : "insert");
    assert.equal(f.state.report.appointmentId, customer.activeAppointmentId);
    assert.equal(f.state.report.appointmentType, "other");
    assert.equal(f.state.logs.length, 1); assert.equal(f.state.logs[0][1], "work_report");
    assert.equal(f.state.checklists.length, 1); assert.equal(f.state.checklists[0].signature, true);
    assert.equal(Object.hasOwn(f.state.checklists[0], "purchaseDeclaration"), false);
    assert.equal(f.state.requests.length, 0); assert.equal(f.state.view, "work");
  }
});

test("other signed PDF delivery explicitly selects worksheet only and never a purchase declaration", async () => {
  const f = reportFlow(); await f.save(true);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0].url, "/api/send-work-report");
  assert.equal(f.state.requests[0].body.documents, "work_report");
  assert.equal(f.state.requests[0].body.appointmentId, "other-work");
  assert.deepEqual(f.state.requests[0].body.declarationIds, []);
  assert.equal(f.state.checklists[0].docsSent, true);
  assert.equal(f.state.view, "work");
});

test("an installation worksheet cannot be reused as the other job's draft", async () => {
  const f = reportFlow(); f.state.report = savedReport({ appointmentId: "old-installation", appointmentType: "installation" });
  await f.save(); assert.equal(f.state.writes.length, 0); assert.match(f.state.messages.at(-1), /másik munkához/);
});

test("other report reload filters exact workspace, customer, appointment and type, without reading a purchase declaration", async () => {
  const queries = [], state = { report: null, blocked: true };
  const f = h.functions(["loadWorkReportFor"], { ...common, workReportLoadSequence: { current: 0 },
    currentWorkspaceId: () => "workspace", workspaceQuery: query => query.eq("workspace_id", "workspace"),
    sellerCompanies: [{ id: "synthetic-default", isDefault: true }], scheduleDate: customer.date, scheduleTime: customer.time, shownTime: customer.time,
    setWorkReportDeclaration: noop, setWorkReportDeclarationItems: noop, setPurchaseDeclarationItemKeys: noop, setSelectedSellerId: noop,
    setWorkReport: value => { state.report = value; }, setWorkReportLoadBlocked: value => { state.blocked = value; },
    setWorkReportsByCustomer: noop, setMaintenanceReportsByCustomer: () => { throw Error("Wrong cache"); },
    setMessage: value => { state.error = value; },
    supabase: database(op => { queries.push(op); assert.equal(op.table, "work_reports");
      return { data: [{ id: "service-report", customer_id: customer.id, appointment_id: "other-work", appointment_type: "other", work_date: customer.date, work_time: customer.time,
        signature_data_url: signature(), signed_at: "2026-10-16T11:00:00Z", signer_name: customer.name }] }; }),
  });
  await f.loadWorkReportFor(customer);
  assert.equal(queries.length, 1); assert.deepEqual(queries[0].filters, { customer_id: customer.id, workspace_id: "workspace", appointment_id: "other-work", appointment_type: "other" });
  assert.equal(state.blocked, false); assert.equal(state.error, undefined); assert.equal(state.report.id, "service-report");
});

test("other report remains visible in the all-works bundle", () => {
  const other = savedReport(), installation = savedReport({ id: "old-report", appointmentId: "old-installation", appointmentType: "installation" });
  const f = h.functions(["allWorkReportsForPreview"], { ...common, selected: customer, workReportsByCustomer: { other, installation },
    maintenanceReportsFor: () => [], compareWorkReportsDesc: () => 0 });
  assert.deepEqual(Array.from(f.allWorkReportsForPreview(customer), report => report.id).sort(), ["old-report", "service-report"]);
});

test("other checklist recognises its saved signature without inventing a purchase declaration", () => {
  const report = savedReport();
  const f = h.functions(["effectiveChecklistFor"], { ...common, selected: customer, workReportsByCustomer: { other: report },
    documentsByCustomer: {}, workChecklistsByCustomer: {}, EMPTY_WORK_CHECKLIST: {}, workScopeKey: c => `${c.id}:${c.activeAppointmentId}`,
    documentsForCustomerScope: () => [] });
  const checklist = f.effectiveChecklistFor(customer);
  assert.equal(checklist.worksheet, true); assert.equal(checklist.signature, true); assert.equal(checklist.purchaseDeclaration, false);
});


test("a cancelled other job cannot be accidentally reopened by its old signed worksheet", async () => {
  const f = closing({ customer: { ...customer, status: "Lemondva" } });
  await f.markInstallationDone();
  assert.equal(f.state.writes.length, 0); assert.equal(f.state.logs.length, 0);
  assert.match(f.state.messages.at(-1), /lemond|visszaáll/i);
});


test("other document actions contain only its own confirmation, worksheet and service invoice", () => {
  const report = savedReport();
  const f = h.functions(["documentRowsFor"], { ...common, savedReportFor: () => report,
    effectiveChecklistFor: () => ({ alinInvoice: true }), docStatus: (_customer, type) => type,
    workReportDocumentStatus: () => "Aláírva, elkészült",
    quoteDocumentFor: () => { throw Error("Other work must not read an installation quote receipt"); },
  });
  const rows = Array.from(f.documentRowsFor(customer));
  assert.deepEqual(rows.map(row => row.action), ["Időpont", "Munkalap", "Számla"]);
  assert.ok(rows.every(row => row.appointmentType === "other"));
  assert.equal(rows[1].appointmentId, customer.activeAppointmentId);
  assert.equal(rows[1].reportId, report.id);
  assert.equal(rows[2].status, "Kész");
  assert.doesNotMatch(JSON.stringify(rows), /purchase_declaration|Köszönő|NKVH|AMOVA|Vásárlási/);
});
