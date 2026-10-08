const assert = require("node:assert/strict");
const test = require("node:test");
const { harness, database, noop } = require("./helpers.cjs");

const originalInstallation = {
  id: "customer-fixture", name: "Teszt ügyfél", appointmentType: "installation",
  activeAppointmentId: "installation-fixture", activeQuoteId: "quote-fixture",
  activeWorkReportId: "report-fixture", status: "Lezárva", date: "2026-09-01", time: "08:00",
  quoteItems: [{ productId: "climate-fixture", quantity: 1 }],
};

function scenario(options = {}) {
  const customer = {
    ...originalInstallation,
    appointmentType: options.type || "maintenance",
    activeAppointmentId: "appointment-to-cancel",
    status: "Időpont foglalva", date: "2026-10-08", time: "10:00",
    activeQuoteId: "maintenance-quote", activeWorkReportId: "maintenance-report",
  };
  const state = {
    customer, selected: customer, customers: [originalInstallation], history: [],
    messages: [], events: [], mutations: [], view: "work", workspaceId: "workspace-fixture",
  };
  const db = database((operation) => {
    state.events.push("customer-status");
    state.mutations.push(operation);
    if (options.customerError) return { data: null, error: new Error("Ügyfélállapot nem menthető") };
    if (options.customerMissing) return { data: null, error: null };
    return { data: { id: customer.id }, error: null };
  });
  const api = harness({ Error }).functions(["cancelAppointment", "cancelAppointmentWithJobMirror"], {
    selected: customer,
    currentWorkspaceId: () => state.workspaceId,
    notifyGoogleCalendarAppointmentsChanged: noop,
    supabase: {
      ...db,
      rpc: async (name, input) => {
        assert.equal(name, "cancel_appointment_with_job_mirror");
        assert.equal(input.p_appointment_id, customer.activeAppointmentId);
        assert.equal(input.p_customer_id, customer.id);
        assert.equal(input.p_workspace_id, "workspace-fixture");
        state.events.push("rpc");
        if (options.changeWorkspace) state.workspaceId = "other-workspace";
        if (options.rpcError) return { data: null, error: new Error("Lemondás elutasítva") };
        return { data: Object.hasOwn(options, "rpcData") ? options.rpcData : [{ appointment_id: customer.activeAppointmentId, job_id: "job-fixture" }], error: null };
      },
    },
    normalizeAppointmentType: (value) => value,
    installationWorkAfterMaintenanceCancellation: () => options.noInstallation ? undefined : originalInstallation,
    maintenanceCancellationDocumentType: () => "maintenance_cancelled",
    maintenanceCancellationTitle: () => "Karbantartás lemondva",
    logDocument: async (target) => {
      state.events.push("log");
      assert.equal(target.activeAppointmentId, customer.activeAppointmentId);
      if (options.logError) throw new Error("Napló nem menthető");
    },
    updateWorkHistory: (value) => { state.events.push("history"); state.history.push(value); },
    setSelected: (value) => { state.selected = value; state.events.push("selected"); },
    setCustomers: (update) => { state.customers = update(state.customers); },
    setQuoteItems: (value) => { state.quoteItems = value; },
    setScheduleAppointmentType: noop,
    setScheduleDate: noop,
    setScheduleTime: noop,
    setAllowWorkResourceEdit: noop,
    todayIso: () => "2026-10-08",
    firstAppointmentTime: (value) => value,
    EMPTY_QUOTE_ITEMS: [],
    setMessage: (message, tone) => state.messages.push({ message, tone }),
    replaceView: (value) => { state.view = value; state.events.push("navigate"); },
    returnToLastMenu: () => { state.view = "tasks"; state.events.push("navigate"); },
    promoteCustomerWork: (value) => { state.promoted = value; },
    persistCustomerToDb: () => { throw new Error("Cancellation must not rewrite a quote"); },
  });
  return { ...api, state };
}

test("failed maintenance cancellation does not write a false cancellation document", async () => {
  const action = scenario({ rpcError: true });
  await action.cancelAppointment();
  assert.deepEqual(action.state.events, ["rpc"]);
  assert.equal(action.state.selected, action.state.customer);
  assert.equal(action.state.mutations.length, 0);
  assert.match(action.state.messages.at(-1).message, /lemondási hiba/);
});

test("cancellation requires a matching appointment in the RPC response", async () => {
  for (const rpcData of [null, [], [{ appointment_id: null }], [{ appointment_id: "different-appointment" }]]) {
    const action = scenario({ rpcData });
    await action.cancelAppointment();
    assert.deepEqual(action.state.events, ["rpc"]);
    assert.equal(action.state.selected, action.state.customer);
    assert.match(action.state.messages.at(-1).message, /nem igazolta/);
  }
});

test("missing appointment identifiers cannot start cancellation", async () => {
  const action = scenario();
  await assert.rejects(action.cancelAppointmentWithJobMirror({ id: "customer-fixture" }, "2026-10-08"), /azonositoja/);
  assert.deepEqual(action.state.events, []);
});

test("maintenance cancellation commits before logging and restores the previous installation", async () => {
  const action = scenario();
  await action.cancelAppointment();
  assert.equal(action.state.events[0], "rpc");
  assert.ok(action.state.events.indexOf("log") > action.state.events.indexOf("history"));
  assert.equal(action.state.history[0].activeAppointmentId, "appointment-to-cancel");
  assert.equal(action.state.history[0].status, "Lemondva");
  assert.equal(action.state.selected.activeAppointmentId, originalInstallation.activeAppointmentId);
  assert.equal(action.state.selected.activeQuoteId, originalInstallation.activeQuoteId);
  assert.equal(action.state.selected.activeWorkReportId, originalInstallation.activeWorkReportId);
  assert.equal(action.state.selected.status, originalInstallation.status);
  assert.deepEqual(action.state.quoteItems, originalInstallation.quoteItems);
  assert.equal(action.state.mutations.length, 0);
  assert.equal(action.state.view, "work");
  assert.equal(action.state.messages.at(-1).tone, "success");
});

test("post-cancellation logging failure still updates history and reports partial success", async () => {
  const action = scenario({ logError: true });
  await action.cancelAppointment();
  assert.equal(action.state.history[0].status, "Lemondva");
  assert.equal(action.state.selected.activeAppointmentId, originalInstallation.activeAppointmentId);
  assert.equal(action.state.events.at(-1), "navigate");
  assert.equal(action.state.messages.at(-1).tone, "warning");
  assert.match(action.state.messages.at(-1).message, /időpont lemondva, de a lemondás naplózása nem sikerült/);
});

test("maintenance without a prior installation stays with the customer without cancelling the customer", async () => {
  const action = scenario({ noInstallation: true });
  await action.cancelAppointment();
  assert.equal(action.state.selected.id, action.state.customer.id);
  assert.equal(action.state.selected.activeAppointmentId, undefined);
  assert.equal(action.state.selected.status, "Visszahívandó");
  assert.equal(action.state.history[0].status, "Lemondva");
  assert.equal(action.state.mutations.length, 0);
});

test("installation cancellation updates only customer status after the appointment transaction", async () => {
  const action = scenario({ type: "installation" });
  await action.cancelAppointment();
  assert.equal(action.state.events[0], "rpc");
  assert.equal(action.state.mutations.length, 1);
  const mutation = action.state.mutations[0];
  assert.equal(mutation.table, "customers");
  assert.equal(mutation.method, "update");
  assert.deepEqual(Object.keys(mutation.value).sort(), ["status", "updated_at"]);
  assert.equal(mutation.value.status, "Lemondva");
  assert.equal(mutation.filters.id, action.state.customer.id);
  assert.equal(mutation.filters.workspace_id, "workspace-fixture");
  assert.equal(action.state.promoted.status, "Lemondva");
  assert.equal(action.state.promoted.date, undefined);
  assert.equal(action.state.selected.activeQuoteId, "maintenance-quote");
  assert.equal(action.state.view, "tasks");
  assert.equal(action.state.messages.at(-1).tone, "success");
});

test("failed installation cancellation does not change customer status or navigate", async () => {
  const action = scenario({ type: "installation", rpcError: true });
  await action.cancelAppointment();
  assert.deepEqual(action.state.events, ["rpc"]);
  assert.equal(action.state.mutations.length, 0);
  assert.equal(action.state.promoted, undefined);
  assert.equal(action.state.view, "work");
});

test("customer-status write failure after cancellation cannot reopen an active appointment", async () => {
  for (const options of [{ customerError: true }, { customerMissing: true }]) {
    const action = scenario({ type: "survey", ...options });
    await action.cancelAppointment();
    assert.equal(action.state.promoted.status, "Lemondva");
    assert.equal(action.state.selected.date, undefined);
    assert.equal(action.state.view, "tasks");
    assert.equal(action.state.messages.at(-1).tone, "warning");
    assert.match(action.state.messages.at(-1).message, /időpont lemondva.*ügyfél állapotának frissítése nem sikerült/);
  }
});

test("a late cancellation response cannot mutate the newly selected workspace", async () => {
  const action = scenario({ changeWorkspace: true });
  await action.cancelAppointment();
  assert.deepEqual(action.state.events, ["rpc"]);
  assert.equal(action.state.mutations.length, 0);
  assert.equal(action.state.messages.length, 0);
  assert.equal(action.state.selected, action.state.customer);
});
