const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database, identity } = require("./helpers.cjs");

const h = harness();
const { normalizeStatus } = h.load("src/lib/alinflow/constants.ts");
const { cleanQuoteItems } = h.load("src/lib/alinflow/products.ts");
const { normalizeAppointmentType, normalizeAppointmentTimeInput, appointmentTypeLabel } = h.load("src/lib/alinflow/appointments.ts");
const workspaceId = "10000000-1111-4000-8000-000000000001";
const customerId = "20000000-1111-4000-8000-000000000001";
const quoteId = "30000000-1111-4000-8000-000000000001";
const appointmentId = "40000000-1111-4000-8000-000000000001";
const item = { isManual: true, customName: "Mesterséges tesztklíma", quantity: 1, customPrice: 100000 };
const customer = (patch = {}) => ({
  id: customerId, name: "Mesterséges Teszt", email: "synthetic@example.invalid",
  phone: "", city: "Tesztváros", address: "", source: "Teszt", status: "Visszahívandó",
  quoteItems: [item], quotePricingMode: "bundle", ...patch,
});
const plain = (value) => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(options = {}) {
  const person = options.customer || customer();
  const state = { workspaceId, selected: person, customers: [person], databaseStatus: person.status };
  const calls = { selected: [], customers: [], messages: [], navigate: [], persist: [], send: [], log: [], db: [], pending: [], busy: [], cleared: [] };
  const pendingActionsRef = { current: new Set() };
  const quoteReceiptsRef = { current: new Map() };
  const selectedCustomerIdRef = { current: person.id };
  let failuresRemaining = options.logFailures || 0;
  const context = {
    selected: person, quoteItems: options.items || person.quoteItems, EMPTY_QUOTE_ITEMS: [],
    normalizeStatus, cleanQuoteItems, sortCustomersByCreatedAtDesc: identity,
    view: "quote", quoteIssuedAt: "", currentWorkspaceId: () => state.workspaceId,
    currentViewRef: { current: "lead" }, selectedCustomerIdRef,
    pendingActionsRef, quoteReceiptsRef,
    setPendingActions: (value) => calls.pending.push(Array.from(value)),
    setQuoteEmailBusy: (value) => calls.busy.push(value), setQuoteIssuedAt() {},
    setMessage: (message, tone) => calls.messages.push({ message, tone }),
    setSelected: (value) => {
      calls.selected.push(typeof value === "function" ? "functional" : "value");
      state.selected = typeof value === "function" ? value(state.selected) : value;
    },
    setCustomers: (value) => {
      state.customers = typeof value === "function" ? value(state.customers) : value;
      calls.customers.push(plain(state.customers));
    },
    clearCustomerDraft: (id) => calls.cleared.push(id), readCustomerDraft: () => null, setDraftNotice() {},
    navigateToView: (view) => calls.navigate.push(view), returnToLastMenu: () => calls.navigate.push("last-menu"),
    persistCustomerToDb: async (value, config) => {
      calls.persist.push({ customer: plain(value), config });
      if (options.persistGate) await options.persistGate.promise;
      if (options.persistError) throw Error(options.persistError);
      return { quoteId, appointmentId: options.savedAppointmentId };
    },
    promoteCustomerWork: (value) => {
      state.customers = state.customers.map((current) => current.id === value.id ? value : current);
    },
    quotePayload: (target, items, issuedAt) => ({ customer: target, items, issuedAt }),
    authenticatedFetch: async (url, request) => {
      calls.send.push({ url, payload: JSON.parse(request.body) });
      return options.sendResponse ? options.sendResponse() : Response.json({ ok: true, id: "synthetic-delivery" });
    },
    logDocument: async (...args) => {
      calls.log.push(args);
      if (options.beforeLog) await options.beforeLog({ state, selectedCustomerIdRef });
      if (failuresRemaining > 0) { failuresRemaining -= 1; throw Error("synthetic logging failure"); }
    },
    workspaceQuery: identity,
    supabase: database(async (operation) => {
      calls.db.push(plain(operation));
      assert.equal(operation.table, "customers");
      assert.equal(operation.method, "update");
      if (operation.filters.status.includes(state.databaseStatus)) state.databaseStatus = operation.value.status;
      return { error: null };
    }),
  };
  const functions = h.functions(["beginAction", "endAction", "saveCustomer", "saveCustomerOnly", "sendQuoteEmail"], context);
  return { ...functions, state, calls, pendingActionsRef, quoteReceiptsRef };
}

for (const action of ["saveCustomerOnly", "saveCustomer"]) {
  test(`${action}: failed persistence keeps the editor and local customer unchanged`, async () => {
    const run = fixture({ persistError: "synthetic database failure" });
    await run[action]();
    assert.equal(run.calls.persist.length, 1);
    assert.deepEqual(run.calls.selected, []);
    assert.deepEqual(run.calls.customers, []);
    assert.deepEqual(run.calls.navigate, []);
    assert.deepEqual(run.calls.cleared, []);
    assert.equal(run.state.selected.status, "Visszahívandó");
    assert.match(run.calls.messages.at(-1).message, /Mentési hiba: synthetic database failure/);
    assert.equal(run.pendingActionsRef.current.size, 0);
  });
}

test("opening the quote editor saves its identity without claiming an email was sent", async () => {
  const run = fixture();
  await run.saveCustomer("quote");
  assert.equal(run.calls.persist[0].customer.status, "Visszahívandó");
  assert.equal(run.calls.persist[0].config.persistQuote, true);
  assert.equal(run.state.selected.activeQuoteId, quoteId);
  assert.equal(run.state.customers[0].activeQuoteId, quoteId);
  assert.equal(run.state.selected.status, "Visszahívandó");
  assert.deepEqual(run.calls.navigate, ["quote"]);
  assert.equal(run.calls.send.length, 0);
});

test("save-only confirms persistence before returning to the previous menu", async () => {
  const gate = deferred();
  const run = fixture({ persistGate: gate });
  const saving = run.saveCustomerOnly();
  assert.deepEqual(run.calls.selected, []);
  assert.deepEqual(run.calls.navigate, []);
  gate.resolve();
  await saving;
  assert.deepEqual(run.calls.navigate, ["last-menu"]);
  assert.equal(run.state.selected.activeQuoteId, quoteId);
  assert.match(run.calls.messages.at(-1).message, /Ügyféladatok mentve/);
});

test("quote rejection stays in place and exposes the server error", async () => {
  const run = fixture({ sendResponse: () => Response.json({ error: "synthetic provider rejection" }, { status: 503 }) });
  await run.sendQuoteEmail();
  assert.equal(run.calls.send.length, 1);
  assert.equal(run.calls.log.length, 0);
  assert.deepEqual(run.calls.navigate, []);
  assert.equal(run.calls.messages.at(-1).tone, "error");
  assert.match(run.calls.messages.at(-1).message, /synthetic provider rejection/);
  assert.equal(run.state.selected.status, "Visszahívandó");
  assert.deepEqual(run.calls.busy, [true, false]);
  assert.equal(run.quoteReceiptsRef.current.size, 0);
});

test("quote response must explicitly confirm success before logging delivery", async () => {
  const run = fixture({ sendResponse: () => Response.json({}) });
  await run.sendQuoteEmail();
  assert.equal(run.calls.log.length, 0);
  assert.equal(run.calls.messages.at(-1).tone, "error");
  assert.match(run.calls.messages.at(-1).message, /Nem érkezett sikeres visszaigazolás/);
});

test("late quote acceptance cannot recreate a receipt after a workspace change", async () => {
  const run = fixture({ sendResponse: () => {
    run.state.workspaceId = "different-workspace";
    run.quoteReceiptsRef.current.clear();
    return Response.json({ ok: true });
  } });
  await run.sendQuoteEmail();
  assert.equal(run.quoteReceiptsRef.current.size, 0);
  assert.equal(run.calls.log.length, 0);
  assert.equal(run.calls.db.length, 0);
  assert.equal(run.calls.messages.length, 1, "only the original pending notice preceded the workspace change");
  assert.equal(run.pendingActionsRef.current.size, 0);
});

test("quote logging completion cannot advance customer status after a workspace change", async () => {
  const run = fixture({ beforeLog: ({ state }) => {
    state.workspaceId = "different-workspace";
    run.quoteReceiptsRef.current.clear();
  } });
  await run.sendQuoteEmail();
  assert.equal(run.calls.log.length, 1);
  assert.equal(run.calls.db.length, 0, "no follow-up status write may use the new workspace");
  assert.equal(run.quoteReceiptsRef.current.size, 0);
  assert.equal(run.calls.messages.length, 1);
  assert.equal(run.pendingActionsRef.current.size, 0);
});

test("accepted quote with failed logging retries only the receipt, never the email", async () => {
  const run = fixture({ logFailures: 1 });
  await run.sendQuoteEmail();
  assert.equal(run.calls.send.length, 1);
  assert.equal(run.quoteReceiptsRef.current.size, 1);
  assert.equal(run.calls.messages.at(-1).tone, "warning");
  assert.match(run.calls.messages.at(-1).message, /emailt elküldtük.*állapot mentése nem sikerült/);
  const sentAt = run.calls.log[0][4];
  await run.sendQuoteEmail();
  assert.equal(run.calls.send.length, 1);
  assert.equal(run.calls.persist.length, 1);
  assert.equal(run.calls.log.length, 2);
  assert.equal(run.calls.log[1][4], sentAt);
  assert.equal(run.quoteReceiptsRef.current.size, 0);
  assert.equal(run.state.selected.status, "Ajánlat elküldve");
  assert.equal(run.state.selected.quoteSentAt, sentAt);
  assert.equal(run.calls.messages.at(-1).tone, "success");
  assert.match(run.calls.messages.at(-1).message, /Új email nem ment ki/);
  assert.deepEqual(run.calls.navigate, []);
});

for (const status of ["Időpont foglalva", "Szerelés kész – admin folyamatban", "Lezárva", "Lemondva"]) {
  test(`quote receipt preserves existing work status: ${status}`, async () => {
    const run = fixture({ customer: customer({ status, date: "2026-10-12", activeAppointmentId: appointmentId }) });
    await run.sendQuoteEmail();
    assert.equal(run.calls.persist[0].customer.status, status);
    assert.equal(run.state.selected.status, status);
    assert.equal(run.state.customers[0].status, status);
    assert.equal(run.calls.db.length, 0);
    assert.equal(run.calls.selected.at(-1), "functional");
    assert.ok(run.state.selected.quoteSentAt);
  });
}

test("conditional receipt update preserves an appointment booked while the email was sending", async () => {
  const run = fixture({ beforeLog: ({ state }) => {
    state.selected = { ...state.selected, status: "Időpont foglalva", date: "2026-10-12", activeAppointmentId: appointmentId, notes: "Newer edit" };
    state.customers = [state.selected];
    state.databaseStatus = "Időpont foglalva";
  } });
  await run.sendQuoteEmail();
  assert.equal(run.calls.db.length, 1);
  assert.deepEqual(run.calls.db[0].filters, { id: customerId, status: ["Visszahívandó", "Ajánlat elküldve"] });
  assert.equal(run.state.databaseStatus, "Időpont foglalva");
  assert.equal(run.state.selected.status, "Időpont foglalva");
  assert.equal(run.state.selected.activeAppointmentId, appointmentId);
  assert.equal(run.state.selected.notes, "Newer edit");
  assert.equal(run.calls.selected.at(-1), "functional");
});

test("quote receipt does not select the previous customer after another customer is opened", async () => {
  const other = customer({ id: "20000000-1111-4000-8000-000000000002", name: "Másik mesterséges ügyfél" });
  const run = fixture({ beforeLog: ({ state, selectedCustomerIdRef }) => {
    state.selected = other;
    selectedCustomerIdRef.current = other.id;
  } });
  await run.sendQuoteEmail();
  assert.equal(run.state.selected.id, other.id);
  assert.equal(run.state.selected.quoteSentAt, undefined);
  assert.deepEqual(run.calls.navigate, []);
});

test("two immediate quote clicks start only one persistence and one send", async () => {
  const gate = deferred();
  const run = fixture({ persistGate: gate });
  const first = run.sendQuoteEmail();
  const second = run.sendQuoteEmail();
  assert.equal(run.pendingActionsRef.current.has("quote-email"), true);
  assert.equal(run.calls.persist.length, 1);
  assert.equal(run.calls.send.length, 0);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(run.calls.persist.length, 1);
  assert.equal(run.calls.send.length, 1);
  assert.equal(run.calls.log.length, 1);
  assert.deepEqual(run.calls.busy, [true, false]);
  assert.equal(run.pendingActionsRef.current.size, 0);
});

test("missing quote email or items produces feedback without persistence or send", async () => {
  for (const options of [{ customer: customer({ email: "" }) }, { items: [] }]) {
    const run = fixture(options);
    await run.sendQuoteEmail();
    assert.equal(run.calls.persist.length, 0);
    assert.equal(run.calls.send.length, 0);
    assert.equal(run.calls.messages.length, 1);
    assert.deepEqual(run.calls.navigate, []);
  }
});

function scheduleFixture(options = {}) {
  const type = options.type || "installation";
  const person = options.customer || customer({ appointmentType: type });
  const state = { selected: person, customers: [person], view: "schedule" };
  const calls = { selected: [], persist: [], log: [], link: [], email: [], messages: [], navigate: [], cleared: [] };
  const pendingActionsRef = { current: new Set() };
  const maintenanceReturnRef = { current: person };
  let logFailures = options.logFailures || 0;
  let linkFailures = options.linkFailures || 0;
  const context = {
    pendingActionsRef, maintenanceReturnRef, setPendingActions() {},
    normalizeAppointmentType, normalizeAppointmentTimeInput, appointmentTypeLabel,
    cleanQuoteItems, EMPTY_QUOTE_ITEMS: [], normalizedScheduleAppointmentType: type,
    scheduleDate: "2026-10-15", scheduleTime: "08:00", allWorkCustomers: [],
    appointmentTimeAvailable: () => true,
    customerInstallationWorks: () => [{ activeAppointmentId: "synthetic-installation-id", quoteItems: [item] }],
    maintenanceQuoteItemsForInstallationIds: () => [item],
    maintenanceInstallationSummariesForIds: () => [{ appointmentId: "synthetic-installation-id", quoteItems: [item] }],
    sendAppointmentNotice: options.sendNotice !== false,
    setMessage: (message, tone) => calls.messages.push({ message, tone }),
    persistCustomerToDb: async (value) => {
      calls.persist.push(plain(value));
      if (options.persistGate) await options.persistGate.promise;
      if (options.persistError) throw Error(options.persistError);
      return { appointmentId: value.activeAppointmentId || appointmentId, quoteId };
    },
    promoteCustomerWork: (value) => { state.customers = [value]; },
    setSelected: (value) => { state.selected = value; calls.selected.push(plain(value)); },
    appointmentBookedDocumentType: (value) => `${value}_booked`,
    logDocument: async (...args) => {
      calls.log.push(args);
      if (logFailures > 0) { logFailures -= 1; throw Error("synthetic appointment logging failure"); }
    },
    saveMaintenanceAppointmentLinks: async (...args) => {
      calls.link.push(args);
      if (linkFailures > 0) { linkFailures -= 1; throw Error("synthetic installation links failure"); }
    },
    sendAppointmentEmailFor: async (target, prefix) => {
      calls.email.push({ target: plain(target), prefix });
      if (options.emailError) {
        context.setMessage(`${prefix}Időpont email küldési hiba: ${options.emailError}`, "error");
        return false;
      }
      return true;
    },
    clearCustomerDraft: (id) => calls.cleared.push(id), readCustomerDraft: () => null, setDraftNotice() {},
    replaceView: (view) => { state.view = view; calls.navigate.push(view); },
  };
  return {
    state, calls, pendingActionsRef,
    // Each click gets the latest React state; refs stay stable across renders.
    saveSchedule: () => h.functions(["beginAction", "endAction", "saveSchedule"], {
      ...context, selected: state.selected, quoteItems: state.selected.quoteItems,
    }).saveSchedule(),
  };
}

test("two immediate schedule-save clicks commit only one appointment", async () => {
  const gate = deferred();
  const run = scheduleFixture({ persistGate: gate });
  const first = run.saveSchedule();
  const second = run.saveSchedule();
  assert.equal(run.pendingActionsRef.current.has("schedule-save"), true);
  assert.equal(run.calls.persist.length, 1);
  assert.equal(run.calls.email.length, 0);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(run.calls.persist.length, 1);
  assert.equal(run.calls.email.length, 1);
  assert.equal(run.pendingActionsRef.current.size, 0);
});

test("failed schedule persistence keeps the schedule editor without local success or email", async () => {
  const run = scheduleFixture({ persistError: "synthetic appointment save failure" });
  await run.saveSchedule();
  assert.equal(run.state.view, "schedule");
  assert.deepEqual(run.calls.selected, []);
  assert.deepEqual(run.calls.navigate, []);
  assert.deepEqual(run.calls.cleared, []);
  assert.equal(run.calls.log.length, 0);
  assert.equal(run.calls.email.length, 0);
  assert.equal(run.calls.messages.at(-1).tone, "error");
  assert.match(run.calls.messages.at(-1).message, /Mentési hiba: synthetic appointment save failure/);
  assert.equal(run.pendingActionsRef.current.size, 0);
});

for (const failure of ["log", "link"]) {
  test(`committed appointment with ${failure} failure preserves its ID and retries the same appointment`, async () => {
    const run = scheduleFixture(failure === "log" ? { logFailures: 1 } : { type: "maintenance", linkFailures: 1 });
    await run.saveSchedule();
    assert.equal(run.state.view, "schedule");
    assert.equal(run.state.selected.activeAppointmentId, appointmentId);
    assert.equal(run.state.selected.activeQuoteId, quoteId);
    assert.equal(run.state.customers[0].activeAppointmentId, appointmentId);
    assert.equal(run.state.selected.date, "2026-10-15");
    assert.equal(run.calls.email.length, 0);
    assert.equal(run.calls.messages.at(-1).tone, "warning");
    assert.match(run.calls.messages.at(-1).message, /Az időpont mentve.*nem kell újra létrehozni/);
    assert.deepEqual(run.calls.cleared, []);
    await run.saveSchedule();
    assert.equal(run.calls.persist.length, 2);
    assert.equal(run.calls.persist[0].activeAppointmentId, undefined);
    assert.equal(run.calls.persist[1].activeAppointmentId, appointmentId);
    assert.equal(run.calls.email.length, 1);
    assert.equal(run.state.view, "work");
    assert.equal(run.state.selected.activeAppointmentId, appointmentId);
    assert.equal(run.pendingActionsRef.current.size, 0);
  });
}

test("schedule email failure retains the detailed reason and opens the saved work", async () => {
  const run = scheduleFixture({ emailError: "synthetic recipient denied by provider" });
  await run.saveSchedule();
  assert.equal(run.calls.email.length, 1);
  assert.equal(run.calls.email[0].prefix, "Az időpont mentve. ");
  assert.equal(run.calls.email[0].target.activeAppointmentId, appointmentId);
  assert.equal(run.calls.messages.at(-1).message, "Az időpont mentve. Időpont email küldési hiba: synthetic recipient denied by provider");
  assert.equal(run.state.selected.status, "Időpont foglalva");
  assert.equal(run.state.view, "work");
  assert.deepEqual(run.calls.navigate, ["work"]);
});

test("fully successful new scheduling returns to dashboard after confirmation", async () => {
  const run = scheduleFixture();
  await run.saveSchedule();
  assert.equal(run.calls.email.length, 1);
  assert.equal(run.state.view, "dashboard");
  assert.deepEqual(run.calls.navigate, ["dashboard"]);
  assert.match(run.calls.messages.at(-1).message, /Időpont mentve és tájékoztató email elküldve/);
  assert.equal(run.state.selected.activeAppointmentId, appointmentId);
});

test("successful appointment editing returns to its work and retains its identity", async () => {
  const run = scheduleFixture({ customer: customer({ appointmentType: "installation", date: "2026-10-14", activeAppointmentId: appointmentId }) });
  await run.saveSchedule();
  assert.equal(run.calls.persist[0].activeAppointmentId, appointmentId);
  assert.equal(run.state.selected.date, "2026-10-15");
  assert.equal(run.state.view, "work");
  assert.deepEqual(run.calls.navigate, ["work"]);
  assert.match(run.calls.messages.at(-1).message, /Időpont módosítva és tájékoztató email elküldve/);
});
