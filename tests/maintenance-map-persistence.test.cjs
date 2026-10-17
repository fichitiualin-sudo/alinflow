const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database, noop } = require("./helpers.cjs");

const h = harness();
const customers = h.load("src/lib/alinflow/customers.ts");
const canonical = {
  id: "customer-a", workspace_id: "workspace-a", name: "Synthetic Customer",
  city: "Hatvan", postal_code: "3000", address: "Synthetic utca 1.",
};
const appointment = {
  id: "maintenance-a", workspace_id: "workspace-a", customer_id: canonical.id,
  appointment_type: "maintenance", scheduled_date: "2026-10-17", scheduled_time: "08:00",
  status: "Időpont foglalva", address: "3000 Hatvan, Synthetic utca 1.",
  latitude: 47.66, longitude: 19.67, geocode_status: "ok", quote_id: null,
};

function fixture({ customer = canonical, work = appointment, onOperation } = {}) {
  const scope = { workspace: { current: "workspace-a" }, user: { current: "user-a" }, generation: { current: 1 } };
  const state = {
    customer: customer ? { ...customer } : null,
    work: work ? { ...work } : null,
    operations: [], calls: [], notifications: [], loaded: [], history: {},
  };
  const db = database(async operation => {
    state.operations.push(operation);
    const intercepted = await onOperation?.(operation, scope, state);
    if (intercepted !== undefined) return intercepted;
    if (operation.method === "upsert") {
      assert.equal(operation.table, "customers");
      state.customer = { ...state.customer, ...operation.value };
      return { data: null, error: null };
    }
    if (operation.method === "select") {
      return { data: operation.table === "customers" ? state.customer
        : operation.table === "appointments" ? state.work : null, error: null };
    }
    throw Error("Unexpected database operation: " + operation.method);
  });
  db.rpc = async (name, args) => {
    state.calls.push({ name, args });
    if (name === "save_quote_with_items") return { data: "quote-a", error: null };
    assert.equal(name, "save_appointment_with_resources");
    state.work = { ...state.work, id: args.p_appointment_id || "new-work", address: args.p_address };
    return { data: [{ appointment_id: state.work.id, job_id: "job-a" }], error: null };
  };
  const context = {
    ...h.load("src/lib/alinflow/products.ts"), ...h.load("src/lib/alinflow/appointments.ts"),
    ...h.load("src/lib/alinflow/schedule.ts"), allWorkCustomers: [],
    ...h.load("src/lib/alinflow/appointment-records.ts"), ...h.load("src/lib/alinflow/maintenance-selection.ts"),
    ...h.load("src/lib/alinflow/maintenance-origin.ts"), ...h.load("src/lib/alinflow/constants.ts"), ...customers,
    user: { id: "user-a" }, activeWorkspaceIdRef: scope.workspace, authUserIdRef: scope.user,
    authLoadGenerationRef: scope.generation, supabase: db,
    notifyGoogleCalendarAppointmentsChanged: (...args) => state.notifications.push(args),
    loadCustomersPromiseRef: { current: null }, loadCustomersWorkspaceIdRef: { current: null },
    lastCustomerLoadRef: { current: null }, appointmentAliasesRef: { current: null },
    products: [], documentsByCustomer: {}, setDataLoading: noop, setMessage: noop,
    readWorkspaceRows: async table => ({ error: null, data: table === "customers" && state.customer ? [state.customer]
      : table === "appointments" && state.work ? [state.work] : [] }),
    setCustomers: value => { state.loaded = value; },
    setWorkHistoryByCustomer: value => { state.history = value; },
  };
  const actions = h.functions([
    "currentWorkspaceId", "workspaceQuery", "withWorkspace", "numericDbValue", "stockDeductedFromWorkStatus",
    "isMissingPostalCodeColumnError", "withoutPostalCode", "quoteReceiptScopeFromRows",
    "loadCustomersFromDb", "ensureAppointmentDurationAvailable", "persistCustomerToDb", "saveAppointmentWithJobMirror",
  ], context);
  return { ...actions, state, scope, context,
    async loadWork() {
      await actions.loadCustomersFromDb({ background: true, preserveEditing: true });
      return state.history[canonical.id]?.[0] || state.loaded[0];
    },
  };
}

function addressPayload(state) {
  return state.operations.find(operation => operation.method === "upsert").value;
}
function assertLocationOmitted(payload) {
  for (const key of ["address", "city", "postal_code"]) assert.equal(Object.hasOwn(payload, key), false, key);
}
function assertScopedReads(state) {
  for (const operation of state.operations.filter(operation => operation.method === "select")) {
    assert.equal(operation.filters.workspace_id, "workspace-a");
    if (operation.table === "appointments") {
      assert.equal(operation.filters.customer_id, canonical.id);
      assert.equal(operation.filters.id, appointment.id);
    }
  }
}

test("loaded full work address can be saved and closed without erasing the canonical city or changing its coordinates", async () => {
  for (const status of ["Időpont foglalva", "Lezárva"]) for (const explicit of [false, true]) {
    const run = fixture();
    const loaded = await run.loadWork();
    assert.equal(loaded.city, canonical.city);
    assert.equal(loaded.address, appointment.address);
    assert.equal(loaded.postalCode, "3000");
    await run.persistCustomerToDb({ ...loaded, status }, { persistCustomerAddress: explicit, persistQuote: false });
    assertLocationOmitted(addressPayload(run.state));
    assert.equal(run.state.customer.city, canonical.city);
    assert.equal(run.state.customer.postal_code, canonical.postal_code);
    assert.equal(run.state.customer.address, canonical.address);
    assert.equal(run.state.work.address, appointment.address);
    assert.equal(run.state.work.latitude, appointment.latitude);
    assert.equal(run.state.calls[0].args.p_status, status);
    assertScopedReads(run.state);
  }
});

test("a different installation address never becomes the canonical customer address through routine work saving", async () => {
  const work = { ...appointment, address: "2100 Gödöllő, Synthetic másik utca 2." };
  const run = fixture({ work });
  const loaded = await run.loadWork();
  assert.equal(loaded.postalCode, "2100");
  await run.persistCustomerToDb(loaded, { persistQuote: false });
  assertLocationOmitted(addressPayload(run.state));
  assert.equal(run.state.customer.address, canonical.address);
  assert.equal(run.state.customer.city, canonical.city);
  assert.equal(run.state.work.address, work.address);
});

test("empty legacy work addresses keep the original blank value instead of persisting the displayed customer fallback", async () => {
  for (const empty of [null, ""]) {
    const run = fixture({ work: { ...appointment, address: empty } });
    const loaded = await run.loadWork();
    assert.equal(loaded.address, canonical.address);
    assert.equal(loaded.city, canonical.city);
    await run.persistCustomerToDb(loaded, { persistQuote: false });
    assertLocationOmitted(addressPayload(run.state));
    assert.equal(run.state.calls[0].args.p_address, empty);
    assert.equal(run.state.work.address, empty);
  }
});

test("an explicit address edit still updates customer location and the saved work address", async () => {
  for (const originalAddress of [appointment.address, null]) {
    const run = fixture({ work: { ...appointment, address: originalAddress } });
    const loaded = await run.loadWork();
    const edited = { ...loaded, city: "Gödöllő", postalCode: "2100", address: "Synthetic új utca 2." };
    await run.persistCustomerToDb(edited, { persistCustomerAddress: true, persistQuote: false });
    assert.equal(addressPayload(run.state).city, edited.city);
    assert.equal(addressPayload(run.state).postal_code, edited.postalCode);
    assert.equal(addressPayload(run.state).address, edited.address);
    assert.equal(run.state.calls[0].args.p_address, edited.address);
  }
});

test("new customer creation persists location even without an explicit existing-customer edit flag", async () => {
  const run = fixture({ customer: null, work: null });
  await run.persistCustomerToDb({
    id: canonical.id, name: canonical.name, city: canonical.city, postalCode: canonical.postal_code,
    address: canonical.address, quoteItems: [], date: "2026-10-17", time: "08:00", appointmentType: "installation",
  }, { persistQuote: false });
  assert.equal(addressPayload(run.state).city, canonical.city);
  assert.equal(addressPayload(run.state).address, canonical.address);
  assert.equal(addressPayload(run.state).postal_code, canonical.postal_code);
  assert.equal(run.state.calls[0].args.p_appointment_id, null);
  assert.equal(run.state.calls[0].args.p_address, canonical.address);
});

test("customer or work read failure and a missing work stop persistence before any mutation", async () => {
  for (const failure of ["customers", "appointments", "missing-work"]) {
    const run = fixture({ onOperation(operation) {
      if (operation.method !== "select") return;
      if (operation.table === failure) return { data: null, error: { message: "synthetic read failure" } };
      if (failure === "missing-work" && operation.table === "appointments") return { data: null, error: null };
    } });
    const loaded = await run.loadWork();
    await assert.rejects(() => run.persistCustomerToDb(loaded, { persistQuote: false }),
      error => /synthetic read failure|időpont nem érhető el/.test(error.message));
    assert.equal(run.state.operations.some(operation => operation.method !== "select"), false);
    assert.equal(run.state.calls.length, 0);
  }
});

test("a workspace, user, or auth-generation switch during either address read stops before writes", async () => {
  for (const stage of ["customers", "appointments"]) for (const changed of ["workspace", "user", "generation"]) {
    const run = fixture({ onOperation(operation, scope) {
      if (operation.method === "select" && operation.table === stage) {
        if (changed === "generation") scope.generation.current++;
        else scope[changed].current = "different-scope";
      }
    } });
    const loaded = await run.loadWork();
    await assert.rejects(() => run.persistCustomerToDb(loaded, { persistQuote: false }),
      /munkaterület vagy a bejelentkezés megváltozott/);
    assert.equal(run.state.operations.some(operation => operation.method !== "select"), false);
    assert.equal(run.state.calls.length, 0);
  }
});

test("parcel numbers preserve the settlement and compact postcode prefixes still identify a full work address", async () => {
  for (const address of ["4321/2 hrsz.", "Synthetic külterület 3941"]) {
    const run = fixture({ work: { ...appointment, address }, customer: { ...canonical, postal_code: null } });
    const loaded = await run.loadWork();
    assert.equal(loaded.city, canonical.city);
    assert.equal(loaded.postalCode, canonical.postal_code);
    await run.persistCustomerToDb(loaded, { persistCustomerAddress: true, persistQuote: false });
    assertLocationOmitted(addressPayload(run.state));
    assert.equal(run.state.customer.city, canonical.city);
    assert.equal(run.state.work.address, address);
  }
  const run = fixture({ work: { ...appointment, address: "1162Budapest, Synthetic utca 1." } });
  const loaded = await run.loadWork();
  assert.equal(loaded.city, "Budapest");
  assert.equal(loaded.postalCode, "1162");
  await run.persistCustomerToDb(loaded, { persistCustomerAddress: true, persistQuote: false });
  assertLocationOmitted(addressPayload(run.state));
  assert.equal(run.state.customer.city, canonical.city);
});

