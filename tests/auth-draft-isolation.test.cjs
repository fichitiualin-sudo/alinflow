const assert = require("node:assert/strict");
const test = require("node:test");
const { harness, database, noop } = require("./helpers.cjs");

function storageHarness(denied = false) {
  const values = new Map();
  const storage = { getItem(key) { if (denied) throw Error("denied"); return values.get(key) || null; },
    setItem(key, value) { if (denied) throw Error("denied"); values.set(key, value); },
    removeItem(key) { if (denied) throw Error("denied"); values.delete(key); } };
  const h = harness({ window: { sessionStorage: storage } });
  return { ...h.load("src/lib/alinflow/drafts.ts"), constants: h.load("src/lib/alinflow/constants.ts"), values };
}
const a = { userId: "synthetic-a", workspaceId: "workspace-a" };
const b = { userId: "synthetic-b", workspaceId: "workspace-b" };
const draft = () => ({ customer: { id: "synthetic-customer", name: "Draft", quoteItems: [] }, quoteItems: [],
  scheduleDate: "2026-10-11", scheduleTime: "08:00", scheduleAppointmentType: "installation", view: "work", at: Date.now() });

test("drafts and phone-return state are isolated by both signed-in user and workspace", () => {
  const store = storageHarness();
  store.writeCustomerDraft(draft(), a);
  store.writeReturnContext({ customerId: "synthetic-customer", view: "work", at: Date.now() }, a);
  for (const other of [b, { ...a, workspaceId: "workspace-b" }, { ...a, userId: "synthetic-b" }, null]) {
    assert.equal(store.readCustomerDraft(other), null);
    assert.equal(store.readReturnContext(other), null);
    store.clearCustomerDraft(other);
    store.clearReturnContext(other);
  }
  assert.equal(store.readCustomerDraft(a).customer.name, "Draft");
  assert.equal(store.readReturnContext(a).customerId, "synthetic-customer");
  store.clearCustomerDraft(a, "different-customer");
  assert.ok(store.readCustomerDraft(a));
  store.clearCustomerDraft(a, "synthetic-customer");
  assert.equal(store.readCustomerDraft(a), null);
});

test("legacy unowned cache is never restored into a signed-in account", () => {
  const store = storageHarness();
  store.values.set(store.constants.CUSTOMER_DRAFT_KEY, JSON.stringify(draft()));
  store.values.set(store.constants.RETURN_CONTEXT_KEY, JSON.stringify({ customerId: "old-account", at: Date.now() }));
  assert.equal(store.readCustomerDraft(a), null);
  assert.equal(store.readReturnContext(a), null);
});

test("blocked session storage never prevents editing, return navigation or logout", () => {
  const store = storageHarness(true);
  assert.equal(store.readCustomerDraft(a), null);
  assert.equal(store.readReturnContext(a), null);
  assert.doesNotThrow(() => { store.writeCustomerDraft(draft(), a); store.clearCustomerDraft(a);
    store.writeReturnContext({ customerId: "synthetic", view: "work", at: Date.now() }, a); store.clearReturnContext(a); });
});

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function bootstrapFixture() {
  const gate = deferred();
  const calls = [];
  const context = { authUserIdRef: { current: "synthetic-a" }, authLoadGenerationRef: { current: 1 },
    authLoadPromiseRef: { current: null }, initialDataReadyRef: { current: false }, loadedUserIdRef: { current: null },
    currentWorkspaceId: () => "workspace-a", setDataLoading: value => calls.push(["loading", value]),
    ensureWorkspaceForUser: async () => { calls.push(["workspace"]); return gate.promise; },
    loadWorkspaceSettingsFromDb: async () => calls.push(["settings"]),
    loadCustomersFromDb: async () => calls.push(["customers"]),
    setInitialDataReady: noop, setCustomers: noop, setSelected: noop, setQuoteItems: noop, EMPTY_CUSTOMER: {},
    setMessage: message => calls.push(["message", message]),
  };
  return { ...harness().functions(["requestDataLoadForUser"], context), context, gate, calls };
}
test("refocusing an already loaded account does not reload settings or discard an open editor", async () => {
  const f = bootstrapFixture();
  f.context.initialDataReadyRef.current = true;
  f.context.loadedUserIdRef.current = "synthetic-a:workspace-a";
  await f.requestDataLoadForUser({ id: "synthetic-a" });
  assert.deepEqual(f.calls, []);
});
test("initial auth events coalesce into a single workspace and customer load", async () => {
  const f = bootstrapFixture();
  const first = f.requestDataLoadForUser({ id: "synthetic-a" });
  const second = f.requestDataLoadForUser({ id: "synthetic-a" });
  assert.equal(f.calls.filter(([name]) => name === "workspace").length, 1);
  f.gate.resolve({ id: "workspace-a" });
  await Promise.all([first, second]);
  assert.deepEqual(f.calls.map(([name]) => name), ["loading", "workspace", "settings", "customers"]);
});
test("a workspace lookup that finishes after account change cannot load old settings or customers", async () => {
  const f = bootstrapFixture();
  const pending = f.requestDataLoadForUser({ id: "synthetic-a" });
  f.context.authUserIdRef.current = "synthetic-b";
  f.context.authLoadGenerationRef.current++;
  f.gate.resolve({ id: "workspace-a" });
  await pending;
  assert.deepEqual(f.calls.map(([name]) => name), ["loading", "workspace"]);
  assert.equal(f.context.loadedUserIdRef.current, null);
});
test("a delayed auth event cannot start a request for the previous user", async () => {
  const f = bootstrapFixture();
  await f.requestDataLoadForUser({ id: "synthetic-b" });
  assert.deepEqual(f.calls, []);
});
test("workspace resolution itself cannot overwrite the active account after an old membership response", async () => {
  const gate = deferred(); let current = true; const writes = [];
  const f = harness().functions(["ensureWorkspaceForUser"], {
    supabase: database(() => gate.promise), setWorkspaceContext: value => writes.push(value),
    isMissingWorkspaceSchemaError: () => false,
  });
  const pending = f.ensureWorkspaceForUser({ id: "synthetic-a" }, () => current);
  current = false;
  gate.resolve({ data: [{ workspace_id: "old", workspaces: { id: "old", name: "Old" } }], error: null });
  assert.equal(await pending, null);
  assert.deepEqual(writes, []);
});

for (const reply of ["success", "failure"]) test(`late thank-you ${reply} cannot fetch or display old customer documents after a workspace switch`, async () => {
  const gate = deferred(); let workspace = "old"; const changes = [];
  const h = harness();
  const f = h.functions(["sendThankYouEmailFor"], { ...h.load("src/lib/alinflow/appointments.ts"),
    selected: {}, quoteItems: [], currentWorkspaceId: () => workspace,
    setMessage: value => changes.push(value), setThankYouEmailBusy: value => changes.push(value), quotePayload: value => value,
    authenticatedFetch: () => gate.promise, supabase: { from() { throw Error("Must not read documents after account change"); } },
  });
  const pending = f.sendThankYouEmailFor({ id: "old-customer", email: "synthetic@example.invalid", appointmentType: "installation", status: "Lezárva" }, true);
  workspace = "next";
  const before = changes.length;
  gate.resolve(Response.json(reply === "success" ? { ok: true } : { error: "old failure" }, { status: reply === "success" ? 200 : 500 }));
  assert.equal(await pending, false);
  assert.equal(changes.length, before);
});

function restoreFixture(returnContext, error = null) {
  const h = harness();
  const state = { ready: null };
  const localDraft = { ...draft(), customer: { ...draft().customer, id: "customer-a", notes: "Unsaved note", activeAppointmentId: "appointment-a" },
    quoteItems: [{ productId: "draft-ac", quantity: 9 }] };
  const context = {
    ...h.load("src/lib/alinflow/appointments.ts"), ...h.load("src/lib/alinflow/products.ts"),
    ...h.load("src/lib/alinflow/maintenance-origin.ts"), ...h.load("src/lib/alinflow/appointment-records.ts"),
    loadCustomersPromiseRef: { current: null }, loadCustomersWorkspaceIdRef: { current: null },
    lastCustomerLoadRef: { current: null }, initialDataReadyRef: { current: false },
    currentWorkspaceId: () => "workspace", selected: {}, products: [], documentsByCustomer: {}, EMPTY_QUOTE_ITEMS: [], LIST_PAGE_SIZE: 10,
    setDataLoading: noop, setMessage: noop, loadProductsFromDb: async () => [], loadSellerCompaniesFromDb: async () => [], loadInventoryFromDb: async () => {},
    readWorkspaceRows: async table => ({ error, data: table === "customers"
      ? [{ id: "customer-a", name: "Customer A" }, { id: "customer-b", name: "Customer B" }]
      : table === "appointments" ? [{ id: "appointment-a", customer_id: "customer-a", appointment_type: "installation", status: "Lezárva", scheduled_date: "2026-01-01" }] : [] }),
    normalizeStatus: value => value, postalCodeFromCustomerData: () => "", numericDbValue: () => undefined,
    stockDeductedFromWorkStatus: () => false, sortCustomersByCreatedAtDesc: value => value,
    setCustomers: noop, setWorkHistoryByCustomer: noop, readReturnContext: () => returnContext, readCustomerDraft: () => localDraft, setDraftNotice: noop,
    setSelected: value => { state.selected = value; }, setQuoteItems: value => { state.quoteItems = value; }, setWorkChecklist: noop, effectiveChecklistFor: () => ({}),
    setInitialDataReady: value => { state.ready = value; }, loadCustomerDetailData: async () => {}, setScheduleDate: noop, setScheduleTime: noop,
    setScheduleAppointmentType: noop, setEditCustomer: noop, setAllowWorkResourceEdit: noop, setWorkReport: noop, emptyWorkReport: () => ({}),
    todayIso: () => "2026-10-11", replaceView: value => { state.view = value; }, clearReturnContext: () => { state.returnCleared = true; },
  };
  return { ...h.functions(["loadCustomersFromDb", "quoteReceiptScopeFromRows", "restoreCustomerMaintenanceOrigin"], context), context, state };
}
test("returning from a call to customer B never combines B with customer A's draft quote", async () => {
  const f = restoreFixture({ customerId: "customer-b", view: "work" });
  await f.loadCustomersFromDb();
  assert.equal(f.state.selected.id, "customer-b");
  assert.deepEqual(f.state.quoteItems, f.state.selected.quoteItems);
  assert.equal(f.state.quoteItems.some(item => item.productId === "draft-ac"), false);
});
test("returning to the same work preserves its unsaved edits and quote together", async () => {
  const f = restoreFixture({ customerId: "customer-a", appointmentId: "appointment-a", view: "work" });
  await f.loadCustomersFromDb();
  assert.equal(f.state.selected.notes, "Unsaved note");
  assert.equal(f.state.selected.activeAppointmentId, "appointment-a");
  assert.equal(f.state.quoteItems[0].quantity, 9);
  assert.equal(f.state.view, "work");
  assert.equal(f.state.returnCleared, true);
});
test("an initial database failure stays uninitialized so a later auth focus can retry", async () => {
  const f = restoreFixture(null, { message: "synthetic offline" });
  await f.loadCustomersFromDb();
  assert.equal(f.context.initialDataReadyRef.current, false);
  assert.equal(f.state.ready, false);
  assert.equal(f.context.lastCustomerLoadRef.current, null);
});
