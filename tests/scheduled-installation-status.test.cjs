const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database, noop } = require("./helpers.cjs");

const h = harness();
const business = Object.assign({}, ...["constants", "appointments", "products", "customers"]
  .map(name => h.load(`src/lib/alinflow/${name}.ts`)));
const { scheduledInstallationStatus } = business;
const workspaceId = "synthetic-workspace";
const customerId = "synthetic-customer";
const appointmentId = "synthetic-appointment";
const quoteId = "synthetic-quote";
const item = { productId: "", isManual: true, customName: "Synthetic AC", quantity: 1, customPrice: 100000 };
const customer = (patch = {}) => ({
  id: customerId, name: "Synthetic Customer", city: "Synthetic City", phone: "", email: "",
  address: "Synthetic street 1.", source: "Test", need: "", status: "Ajánlat elküldve",
  date: "2026-11-03", time: "08:00", appointmentType: "installation",
  activeAppointmentId: appointmentId, activeQuoteId: quoteId, quoteItems: [item], ...patch,
});
const appointment = (patch = {}) => ({
  id: appointmentId, customer_id: customerId, quote_id: quoteId, workspace_id: workspaceId,
  appointment_type: "installation", scheduled_date: "2026-11-03", scheduled_time: "08:00",
  status: "Időpont foglalva", cancelled_at: null, address: "Synthetic street 1.", ...patch,
});
const plain = value => JSON.parse(JSON.stringify(value));

test("dated installation lead and legacy quote statuses resolve to booked", () => {
  for (const status of ["Visszahívandó", "Ajánlat elküldve", "Időpont egyeztetés", "Ajánlat készül", "Beszélve"]) {
    for (const existing of [undefined, null, appointment({ status }), appointment({ status: null })]) {
      assert.equal(scheduledInstallationStatus(customer({ status }), existing), "Időpont foglalva");
    }
  }
});

test("a stale installation quote draft preserves the saved booked, admin or closed stage", () => {
  for (const status of ["Időpont foglalva", "Szerelés kész – admin folyamatban", "Lezárva", "Szerelés folyamatban"]) {
    const saved = appointment({ status });
    const draft = customer();
    assert.equal(scheduledInstallationStatus(draft, saved), business.normalizeStatus(status));
    assert.equal(saved.status, status);
    assert.equal(draft.status, "Ajánlat elküldve");
  }
});

test("explicit work stages, other appointment types and undated leads remain unchanged", () => {
  for (const status of ["Időpont foglalva", "Szerelés kész – admin folyamatban", "Lezárva", "Lemondva"]) {
    assert.equal(scheduledInstallationStatus(customer({ status }), appointment({ status: "Ajánlat elküldve" })), status);
  }
  for (const appointmentType of ["survey", "maintenance", "other"]) {
    for (const status of ["Visszahívandó", "Ajánlat elküldve"]) {
      assert.equal(scheduledInstallationStatus(customer({ appointmentType, status }),
        appointment({ appointment_type: appointmentType, status: "Lezárva" })), status);
    }
  }
  assert.equal(scheduledInstallationStatus(customer({ date: undefined }), appointment()), "Ajánlat elküldve");
  assert.equal(scheduledInstallationStatus(customer({ date: "" }), appointment()), "Ajánlat elküldve");
});

test("a lead or quote draft cannot reopen a cancelled installation or change its saved type", () => {
  for (const status of ["Visszahívandó", "Ajánlat elküldve"]) {
    for (const patch of [{ status: "Lemondva" }, { cancelled_at: "2026-10-18T08:00:00Z" }]) {
      assert.throws(() => scheduledInstallationStatus(customer({ status }), appointment(patch)), /lemondták/);
    }
    for (const appointment_type of ["survey", "maintenance", "other", "Felmérés", "Karbantartás"]) {
      assert.throws(() => scheduledInstallationStatus(customer({ status }), appointment({ appointment_type })), /típusa.*megváltozott/);
    }
  }
});

function persistFixture({ draft = customer(), saved = appointment() } = {}) {
  const state = { customer: customer({ status: saved?.status || draft.status }), work: saved ? { ...saved } : null,
    quote: { id: quoteId, appointment_id: appointmentId }, operations: [], rpc: [], notifications: [] };
  const db = database(async operation => {
    state.operations.push(plain(operation));
    assert.equal(operation.filters.workspace_id || operation.value?.workspace_id, workspaceId);
    if (operation.method === "upsert") {
      assert.equal(operation.table, "customers");
      state.customer = { ...state.customer, ...plain(operation.value) };
      return { data: null, error: null };
    }
    assert.equal(operation.method, "select");
    const data = operation.table === "customers" ? state.customer
      : operation.table === "appointments" ? state.work
      : operation.table === "quotes" ? state.quote : null;
    if (operation.table === "appointments") {
      assert.equal(operation.filters.id, appointmentId);
      assert.equal(operation.filters.customer_id, customerId);
    }
    return { data: plain(data), error: null };
  });
  db.rpc = async (name, args) => {
    state.rpc.push({ name, args: plain(args) });
    assert.equal(args.p_workspace_id, workspaceId);
    if (name === "save_quote_with_items") {
      state.quote = { ...state.quote, status: args.p_status };
      return { data: quoteId, error: null };
    }
    assert.equal(name, "save_appointment_with_resources");
    state.work = { ...state.work, status: args.p_status };
    return { data: [{ appointment_id: appointmentId, job_id: "synthetic-job" }], error: null };
  };
  const actions = h.functions(["currentWorkspaceId", "workspaceQuery", "withWorkspace",
    "ensureAppointmentDurationAvailable", "persistCustomerToDb", "saveAppointmentWithJobMirror"], {
    ...business, allWorkCustomers: [], user: { id: "synthetic-user" }, supabase: db,
    activeWorkspaceIdRef: { current: workspaceId }, authUserIdRef: { current: "synthetic-user" },
    authLoadGenerationRef: { current: 1 }, isMissingPostalCodeColumnError: () => false,
    notifyGoogleCalendarAppointmentsChanged: (...args) => state.notifications.push(args),
  });
  return { state, draft, ...actions };
}

test("real persistence writes the resolved status consistently to customer, quote and appointment", async () => {
  for (const savedStatus of ["Ajánlat elküldve", "Időpont foglalva", "Szerelés kész – admin folyamatban", "Lezárva"]) {
    const run = persistFixture({ saved: appointment({ status: savedStatus }) });
    const originalDraft = plain(run.draft);
    const result = await run.persistCustomerToDb(run.draft);
    const expected = savedStatus === "Ajánlat elküldve" ? "Időpont foglalva" : savedStatus;
    assert.equal(result.status, expected);
    assert.equal(result.appointmentId, appointmentId);
    assert.equal(result.quoteId, quoteId);
    assert.equal(run.state.customer.status, expected);
    assert.equal(run.state.quote.status, expected);
    assert.equal(run.state.work.status, expected);
    assert.deepEqual(run.state.rpc.map(call => call.name), ["save_quote_with_items", "save_appointment_with_resources"]);
    const params = run.state.rpc[1].args;
    assert.equal(params.p_appointment_id, appointmentId);
    assert.equal(params.p_customer_id, customerId);
    assert.equal(params.p_quote_id, quoteId);
    assert.equal(params.p_scheduled_date, originalDraft.date);
    assert.equal(params.p_scheduled_time, originalDraft.time);
    assert.equal(params.p_address, originalDraft.address);
    assert.deepEqual(run.draft, originalDraft, "resolving persistence must not mutate the editor snapshot");
  }
});

test("real persistence rejects cancelled or changed-type records before any write", async () => {
  for (const patch of [{ status: "Lemondva" }, { cancelled_at: "2026-10-18T08:00:00Z" },
    { appointment_type: "survey" }, { appointment_type: "maintenance" }, { appointment_type: "other" }]) {
    const run = persistFixture({ saved: appointment(patch) });
    const before = plain({ customer: run.state.customer, work: run.state.work, quote: run.state.quote });
    await assert.rejects(run.persistCustomerToDb(run.draft), /lemondták|típusa.*megváltozott/);
    assert.equal(run.state.operations.some(operation => operation.method !== "select"), false);
    assert.deepEqual(run.state.rpc, []);
    assert.deepEqual(run.state.notifications, []);
    assert.deepEqual({ customer: run.state.customer, work: run.state.work, quote: run.state.quote }, before);
  }
});

test("real persistence does not convert surveys, maintenance or other work into booked installations", async () => {
  for (const appointmentType of ["survey", "maintenance", "other"]) {
    const run = persistFixture({ draft: customer({ appointmentType }),
      saved: appointment({ appointment_type: appointmentType, status: "Ajánlat elküldve" }) });
    const result = await run.persistCustomerToDb(run.draft);
    assert.equal(result.status, "Ajánlat elküldve");
    assert.equal(run.state.customer.status, "Ajánlat elküldve");
    assert.equal(run.state.rpc[1].args.p_appointment_type, appointmentType);
    assert.equal(run.state.rpc[1].args.p_status, "Ajánlat elküldve");
  }
});

test("real persistence keeps explicit admin, closed and cancelled input statuses", async () => {
  for (const status of ["Szerelés kész – admin folyamatban", "Lezárva", "Lemondva"]) {
    const run = persistFixture({ draft: customer({ status }) });
    const result = await run.persistCustomerToDb(run.draft);
    assert.equal(result.status, status);
    assert.equal(run.state.customer.status, status);
    assert.equal(run.state.rpc[1].args.p_status, status);
  }
});
function handlerFixture(resolvedStatus) {
  const draft = customer({ email: "synthetic@example.invalid" });
  const sibling = customer({ activeAppointmentId: "synthetic-other-appointment", status: "Lezárva" });
  const state = { selected: draft, customers: [draft], history: { [customerId]: [draft, sibling] },
    sends: [], messages: [], persisted: [] };
  const setter = key => value => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const context = {
    ...business, ...h.load("src/lib/alinflow/schedule.ts"), selected: draft, quoteItems: draft.quoteItems,
    setSelected: setter("selected"), setCustomers: setter("customers"), setWorkHistoryByCustomer: setter("history"),
    currentWorkspaceId: () => workspaceId, authLoadGenerationRef: { current: 1 },
    customerEditSnapshotRef: { current: draft }, selectedCustomerIdRef: { current: customerId },
    beginAction: () => true, endAction: noop, pendingActionsRef: { current: new Set() },
    quoteReceiptsRef: { current: new Map() }, view: "quote", quoteIssuedAt: "",
    persistCustomerToDb: async value => {
      state.persisted.push(plain(value));
      return { status: resolvedStatus, appointmentId, quoteId };
    },
    setMessage: (message, tone) => state.messages.push({ message, tone }),
    clearCustomerDraft: noop, readCustomerDraft: () => null, setDraftNotice: noop,
    setEditCustomer: noop, navigateToView: noop, returnToLastMenu: noop, replaceView: noop,
    workResourceEditLocked: false, allowWorkResourceEdit: false, materials: [], materialOverrides: {},
    scheduleTime: "08:00", ensureAppointmentDurationAvailable: noop, stockMaterialQuantities: noop,
    setAllowWorkResourceEdit: noop, setQuoteEmailBusy: noop, setQuoteIssuedAt: noop,
    quotePayload: value => ({ customer: value }),
    authenticatedFetch: async (url, request) => {
      state.sends.push({ url, payload: JSON.parse(request.body) });
      return Response.json({ ok: true });
    },
    logDocument: async () => {},
  };
  const actions = h.functions(["saveCustomerData", "saveCustomer", "saveCustomerOnly", "saveWorkChanges", "sendQuoteEmail",
    "updateWorkHistory", "promoteCustomerWork", "shouldPromoteWorkToCustomerList", "workCustomersForScheduling"], context);
  return { ...actions, state };
}

test("every affected save uses returned work status in the editor, customer list and calendar history", async () => {
  for (const action of ["saveCustomerData", "saveCustomer", "saveCustomerOnly", "saveWorkChanges", "sendQuoteEmail"]) {
    for (const status of ["Időpont foglalva", "Szerelés kész – admin folyamatban", "Lezárva"]) {
      const run = handlerFixture(status);
      await run[action]();
      assert.equal(run.state.messages.some(message => message.tone === "error" || /hiba:/i.test(message.message)), false,
        JSON.stringify({ action, messages: run.state.messages }));
      assert.equal(run.state.persisted.length, 1, action);
      assert.equal(run.state.selected.status, status, action);
      assert.equal(run.state.customers[0].status, status, action);
      const calendar = run.workCustomersForScheduling(run.state.customers, run.state.history);
      assert.equal(calendar.find(work => work.activeAppointmentId === appointmentId).status, status, action);
      assert.equal(calendar.find(work => work.activeAppointmentId === "synthetic-other-appointment").status, "Lezárva",
        action + " must retain other work for the customer");
      if (action === "sendQuoteEmail") {
        assert.equal(run.state.sends.length, 1);
        assert.equal(run.state.sends[0].payload.customer.status, status);
        assert.equal(run.state.sends[0].payload.customer.activeAppointmentId, appointmentId);
      } else assert.equal(run.state.sends.length, 0, action + " must not send an email");
    }
  }
});
