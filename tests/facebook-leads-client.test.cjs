const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const { harness, source } = require("./helpers.cjs");

const { runFacebookLeadSync } = harness({ DOMException }).load("src/lib/alinflow/facebook-leads-client.ts");
const page = (overrides = {}) => ({ imported: 1, matched: 0, review: 0, duplicates: 0,
  nextCursor: null, nextFormId: null, hasMore: false, ...overrides });

test("Facebook backfill preserves opaque cursors and moves to the next form without carrying the previous cursor", async () => {
  const requests = [];
  const progress = [];
  const pages = [
    page({ nextCursor: "opaque-one", nextFormId: "form-one", hasMore: true }),
    page({ matched: 2, nextFormId: "form-two", hasMore: true }),
    page({ imported: 0, duplicates: 3 }),
  ];
  const result = await runFacebookLeadSync({
    signal: new AbortController().signal,
    requestPage: async (checkpoint) => { requests.push({ ...checkpoint }); return pages.shift(); },
    onPage: (state) => progress.push(JSON.parse(JSON.stringify(state))),
  });
  assert.deepEqual(requests, [{}, { formId: "form-one", cursor: "opaque-one" }, { formId: "form-two" }]);
  assert.equal(result.complete, true);
  assert.deepEqual({ ...result.totals }, { imported: 2, matched: 2, review: 0, duplicates: 3 });
  assert.equal(progress.at(-1).checkpoint, null);
});

test("Facebook backfill retries the failed page from the last acknowledged checkpoint", async () => {
  let checkpoint = {};
  let count = 0;
  await assert.rejects(runFacebookLeadSync({
    signal: new AbortController().signal,
    requestPage: async () => {
      if (++count === 2) throw new Error("Network failure");
      return page({ nextCursor: "resume-here", nextFormId: "form-one", hasMore: true });
    },
    onPage: (state) => { checkpoint = state.checkpoint; },
  }), /Network failure/);
  assert.deepEqual({ ...checkpoint }, { formId: "form-one", cursor: "resume-here" });
  let retried;
  await runFacebookLeadSync({
    checkpoint,
    signal: new AbortController().signal,
    requestPage: async (value) => { retried = value; return page({ duplicates: 2 }); },
    onPage: () => {},
  });
  assert.deepEqual({ ...retried }, { formId: "form-one", cursor: "resume-here" });
});

test("cancelling an in-flight Facebook request does not advance its checkpoint or show stale progress", async () => {
  const controller = new AbortController();
  let progressCount = 0;
  await assert.rejects(runFacebookLeadSync({
    signal: controller.signal,
    requestPage: async () => { controller.abort(); return page(); },
    onPage: () => { progressCount += 1; },
  }), (error) => error.name === "AbortError");
  assert.equal(progressCount, 0);
});

test("Facebook backfill caps a run while preserving the next continuation", async () => {
  let next;
  let count = 0;
  const result = await runFacebookLeadSync({
    signal: new AbortController().signal,
    maxPages: 2,
    requestPage: async () => page({ nextCursor: `cursor-${++count}`, nextFormId: "form-one", hasMore: true }),
    onPage: ({ checkpoint }) => { next = checkpoint; },
  });
  assert.equal(result.complete, false);
  assert.equal(count, 2);
  assert.deepEqual({ ...next }, { formId: "form-one", cursor: "cursor-2" });
});

test("a repeated Facebook cursor stops instead of importing in an endless loop", async () => {
  let requests = 0;
  await assert.rejects(runFacebookLeadSync({
    signal: new AbortController().signal,
    checkpoint: { formId: "form-one", cursor: "same" },
    requestPage: async () => { requests += 1; return page({ nextCursor: "same", nextFormId: "form-one", hasMore: true }); },
    onPage: () => {},
  }), /nem tudott továbblépni/);
  assert.equal(requests, 1);
});

test("invalid Facebook page response leaves the previous continuation available for retry", async () => {
  let progressed = false;
  await assert.rejects(runFacebookLeadSync({
    signal: new AbortController().signal,
    requestPage: async () => page({ hasMore: true, nextFormId: null }),
    onPage: () => { progressed = true; },
  }), /válasza hiányos/);
  assert.equal(progressed, false);
});

function customerLoader(overrides = {}) {
  const state = { customers: null, history: null, appliedCustomerIds: [] };
  const loadRef = { current: null };
  const scopeRef = { current: undefined };
  const lastLoadRef = { current: null };
  const mustNotTouchEditing = () => { throw new Error("Unsaved editing state was changed"); };
  const { loadCustomersFromDb } = harness().functions(["loadCustomersFromDb", "quoteReceiptScopeFromRows"], {
    loadCustomersPromiseRef: loadRef,
    loadCustomersWorkspaceIdRef: scopeRef,
    lastCustomerLoadRef: lastLoadRef,
    currentWorkspaceId: () => "workspace-one",
    products: [],
    setDataLoading: () => {},
    setMessage: mustNotTouchEditing,
    loadProductsFromDb: mustNotTouchEditing,
    loadSellerCompaniesFromDb: mustNotTouchEditing,
    loadInventoryFromDb: mustNotTouchEditing,
    readWorkspaceRows: async (table) => ({ data: table === "customers"
      ? [{ id: "new-lead", name: "Teszt érdeklődő", city: "Budapest", need: "Teszt klíma", source: "Facebook" }] : [], error: null }),
    compatibleAppointmentRows: () => [],
    currentAppointmentsByCustomer: () => new Map(),
    appointmentsByCustomer: () => new Map(),
    documentsByCustomer: {},
    normalizeAppointmentType: () => "installation",
    cleanQuoteItems: (value) => value,
    normalizeStatus: (value) => value,
    postalCodeFromCustomerData: () => "",
    quotePricingModeFromNotes: () => "bundle",
    stockDeductedFromWorkStatus: () => false,
    numericDbValue: () => undefined,
    EMPTY_QUOTE_ITEMS: [],
    sortCustomersByCreatedAtDesc: (value) => value,
    setCustomers: (value) => { state.customers = value; state.appliedCustomerIds.push(value.map(item => item.id)); },
    setWorkHistoryByCustomer: (value) => { state.history = value; },
    readReturnContext: mustNotTouchEditing,
    readCustomerDraft: mustNotTouchEditing,
    setSelected: mustNotTouchEditing,
    setQuoteItems: mustNotTouchEditing,
    ...overrides,
  });
  return { loadCustomersFromDb, state, loadRef, scopeRef, lastLoadRef };
}

test("a Facebook-triggered customer refresh adds leads without restoring a draft or changing the open form", async () => {
  const { loadCustomersFromDb, state, lastLoadRef, loadRef } = customerLoader();
  await loadCustomersFromDb({ background: true, preserveEditing: true });
  assert.equal(state.customers[0].need, "Teszt klíma");
  assert.equal(state.customers[0].city, "Budapest");
  assert.equal(state.history["new-lead"].length, 0);
  assert.equal(lastLoadRef.current.workspaceId, "workspace-one");
  assert.equal(loadRef.current, null);
});

test("a new workspace reload waits for the prior request and then loads its own rows", async () => {
  let workspace = "workspace-one";
  let releaseOldCustomers;
  const pendingCustomers = new Promise(resolve => { releaseOldCustomers = resolve; });
  const queried = [];
  const { loadCustomersFromDb, state, lastLoadRef, scopeRef } = customerLoader({
    currentWorkspaceId: () => workspace,
    readWorkspaceRows: async table => {
      queried.push(`${workspace}:${table}`);
      if (table !== "customers") return { data: [], error: null };
      if (workspace === "workspace-one") return pendingCustomers;
      return { data: [{ id: "new-workspace-customer" }], error: null };
    },
  });
  const first = loadCustomersFromDb({ background: true, preserveEditing: true });
  workspace = "workspace-two";
  const second = loadCustomersFromDb({ background: true, preserveEditing: true });
  releaseOldCustomers({ data: [{ id: "old-workspace-customer" }], error: null });
  await Promise.all([first, second]);
  assert.equal(state.customers[0].id, "new-workspace-customer");
  assert.equal(lastLoadRef.current.workspaceId, "workspace-two");
  assert.deepEqual(state.appliedCustomerIds.map(ids => Array.from(ids)), [["new-workspace-customer"]]);
  assert.ok(queried.includes("workspace-two:customers"));
  assert.equal(scopeRef.current, undefined);
});

test("opening a Facebook lead uses its freshly loaded work scope and fails safely if the customer was deleted", async () => {
  const latest = { current: null };
  const opened = [];
  let available = true;
  const { openFacebookCustomer } = harness().functions(["openFacebookCustomer"], {
    currentWorkspaceId: () => "workspace-one",
    currentViewRef: { current: "dashboard" },
    lastCustomerLoadRef: latest,
    loadCustomersFromDb: async () => {
      latest.current = { workspaceId: "workspace-one", customers: available ? [{ id: "lead-one", need: "Friss klíma" }] : [] };
    },
    openCustomer: (...args) => opened.push(args),
  });
  await openFacebookCustomer("lead-one");
  assert.equal(opened[0][0].need, "Friss klíma");
  assert.equal(opened[0][2], true);
  available = false;
  await assert.rejects(openFacebookCustomer("lead-one"), /már nem érhető el/);
  assert.equal(opened.length, 1);
});

test("a late Facebook customer load cannot open an old workspace's record", async () => {
  let workspace = "workspace-one";
  const latest = { current: null };
  const { openFacebookCustomer } = harness().functions(["openFacebookCustomer"], {
    currentWorkspaceId: () => workspace,
    currentViewRef: { current: "dashboard" },
    lastCustomerLoadRef: latest,
    loadCustomersFromDb: async () => {
      latest.current = { workspaceId: "workspace-one", customers: [{ id: "lead-one" }] };
      workspace = "workspace-two";
    },
    openCustomer: () => { throw new Error("Opened a record in the wrong workspace"); },
  });
  await openFacebookCustomer("lead-one");
});

test("a failed customer refresh is reported so the next Facebook poll can retry it", async () => {
  const { refreshFacebookCustomers } = harness().functions(["refreshFacebookCustomers"], {
    initialDataReadyRef: { current: true },
    currentWorkspaceId: () => "workspace-one",
    currentViewRef: { current: "dashboard" },
    lastCustomerLoadRef: { current: { workspaceId: "workspace-one", customers: [] } },
    loadCustomersFromDb: async () => {},
  });
  await assert.rejects(refreshFacebookCustomers(), /frissítése nem sikerült/);
});

test("initial loading covers the workspace lookup before dashboard callbacks can run", async () => {
  let releaseWorkspace;
  const workspace = new Promise(resolve => { releaseWorkspace = resolve; });
  const loading = [];
  const calls = [];
  const { requestDataLoadForUser } = harness().functions(["requestDataLoadForUser"], {
    initialDataReadyRef: { current: false },
    loadedUserIdRef: { current: null },
    setDataLoading: value => loading.push(value),
    ensureWorkspaceForUser: () => { calls.push("workspace"); return workspace; },
    loadWorkspaceSettingsFromDb: async () => { calls.push("settings"); },
    loadCustomersFromDb: async options => { calls.push(options.background ? "background" : "initial"); },
  });
  const request = requestDataLoadForUser({ id: "synthetic-user" });
  try {
    assert.deepEqual(calls, ["workspace"]);
    assert.deepEqual(loading, [true], "the dashboard must remain covered while workspace resolution is pending");
  } finally {
    releaseWorkspace({ id: "workspace-one" });
    await request;
  }
  assert.deepEqual(calls, ["workspace", "settings", "initial"]);
});

test("an early Facebook callback cannot claim the shared customer loader before initialization", async () => {
  const reads = [];
  const latest = { current: null };
  const { refreshFacebookCustomers } = harness().functions(["refreshFacebookCustomers"], {
    initialDataReadyRef: { current: false },
    currentWorkspaceId: () => "workspace-one",
    currentViewRef: { current: "dashboard" },
    lastCustomerLoadRef: latest,
    loadCustomersFromDb: async options => {
      reads.push(options);
      latest.current = { workspaceId: "workspace-one", customers: [] };
    },
  });
  await refreshFacebookCustomers();
  assert.deepEqual(reads, [], "a partial refresh must not replace the initial customer/draft load");
});

test("after initialization a Facebook callback refreshes customers without changing the open form", async () => {
  const { loadCustomersFromDb, state, lastLoadRef } = customerLoader();
  const { refreshFacebookCustomers } = harness().functions(["refreshFacebookCustomers"], {
    initialDataReadyRef: { current: true },
    currentWorkspaceId: () => "workspace-one",
    currentViewRef: { current: "dashboard" },
    lastCustomerLoadRef: lastLoadRef,
    loadCustomersFromDb,
  });
  await refreshFacebookCustomers();
  assert.equal(state.customers[0].need, "Teszt klíma");
  assert.equal(state.customers[0].city, "Budapest");
  assert.equal(lastLoadRef.current.workspaceId, "workspace-one");
});

test("the Facebook panel mounts only after the initial workspace data is ready", () => {
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let panel;
  (function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "FacebookLeadsPanel") panel = node;
    ts.forEachChild(node, visit);
  })(ast);
  assert.ok(panel, "the dashboard must retain its Facebook panel");
  let branch = panel.parent;
  while (branch && !ts.isConditionalExpression(branch)) branch = branch.parent;
  assert.ok(branch, "the Facebook panel must have a conditional mount");
  const code = ts.transpileModule(
    `globalThis.renderPanel = (initialDataReady, activeWorkspace, user) => (${branch.getText(ast)});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  const component = () => null;
  const context = {
    exports: {},
    FacebookLeadsPanel: component,
    refreshFacebookCustomers: () => {},
    openFacebookCustomer: () => {},
    require: name => {
      assert.equal(name, "react/jsx-runtime");
      return require("react/jsx-runtime");
    },
  };
  vm.runInNewContext(code, context);
  const workspace = { id: "workspace-one" };
  const user = { id: "synthetic-user" };
  assert.equal(context.renderPanel(false, workspace, user), null);
  assert.equal(context.renderPanel(true, null, user), null);
  assert.equal(context.renderPanel(true, workspace, null), null);
  const mounted = context.renderPanel(true, workspace, user);
  assert.equal(mounted.type, component);
  assert.equal(mounted.props.workspaceId, workspace.id);
  assert.equal(mounted.props.userId, user.id);
});
