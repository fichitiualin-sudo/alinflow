const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database, noop } = require("./helpers.cjs");
const h = harness();
const { assertMaintenanceDeviceConsistency: check } = h.load("src/lib/alinflow/maintenance-consistency.ts");
const item = (quantity, name = "Synthetic AC") => ({ isManual: true, customName: name, quantity, customPrice: 100000 });
const device = (unitNumber, productName = "Synthetic AC") => ({ productName, unitNumber });
const installation = (id = "installation", items = [item(4)]) => ({ id: "customer", name: "Synthetic Customer",
  activeAppointmentId: id, appointmentType: "installation", quoteItems: items });
const work = (selection = [device(3)]) => ({ id: "customer", name: "Synthetic Customer", appointmentType: "maintenance",
  activeAppointmentId: "maintenance", maintenanceInstallationIds: ["installation"], quoteItems: [item(1)],
  ...(selection === undefined ? {} : { maintenanceDeviceSelections: { installation: selection } }) });
const legacyWork = () => { const value = work(); delete value.maintenanceDeviceSelections; return value; };
const link = (selection = [device(3)], id = "installation") => ({ installation_appointment_id: id, selected_devices: selection });
const friendly = /A klímák kiválasztása nem egyezik a mentett időponttal\. Mentsd újra a karbantartási időpontot\./;

test("failed all-four to one link save blocks the visible one-device work", () => {
  assert.throws(() => check(work(), [item(1)], [installation()], [link(null)], [item(1)]), friendly);
});

test("reloading old all-four links cannot hide a one-device quote left by the failed save", () => {
  assert.throws(() => check(legacyWork(), [item(4)], [installation()], [link(null)], [item(1)]), friendly);
});

test("the saved third device passes without renumbering it or modifying prices or source rows", () => {
  const args = [work(), [item(1)], [installation()], [link()], [item(1)]];
  const before = JSON.stringify(args);
  assert.doesNotThrow(() => check(...args));
  assert.equal(JSON.stringify(args), before);
  assert.equal(args[0].maintenanceDeviceSelections.installation[0].unitNumber, 3);
});

test("equal quantity for a different physical device is rejected", () => {
  assert.throws(() => check(work(), [item(1)], [installation()], [link([device(2)])], [item(1)]), friendly);
});

test("legacy whole-installation links expand to all four units", () => {
  assert.doesNotThrow(() => check(legacyWork(), [item(4)], [installation()], [link(null)], [item(4)]));
  assert.doesNotThrow(() => check(legacyWork(), [item(4)], [installation()], [{ installation_appointment_id: "installation" }], [item(4)]));
});

test("legacy maintenance without links or an explicit selection remains usable", () => {
  const legacy = { id: "customer", appointmentType: "maintenance", quoteItems: [item(2)] };
  assert.doesNotThrow(() => check(legacy, [item(2)], [], [], [item(2)]));
  assert.doesNotThrow(() => check({ ...legacy, maintenanceDeviceSelections: {} }, [item(2)], [], [], [item(2)]));
  assert.throws(() => check({ ...legacy, maintenanceDeviceSelections: { installation: [] } }, [], [], [], []), friendly);
});

test("visible and persisted model quantities must both match the selected units", () => {
  for (const [visible, stored] of [[[item(4)], [item(1)]], [[item(1)], [item(4)]], [[item(1, "Other AC")], [item(1)]]]) {
    assert.throws(() => check(work(), visible, [installation()], [link()], stored), friendly);
  }
});

test("grouped model rows, capitalization and extra line items do not change device identity", () => {
  const extra = { ...item(8, "Synthetic extra"), itemType: "extra" };
  const source = installation("installation", [item(2, " Synthetic AC "), item(2, "synthetic ac"), extra]);
  assert.doesNotThrow(() => check(work(), [item(1, " SYNTHETIC AC "), extra], [source],
    [link([device(3, "synthetic ac")])], [item(1, "Synthetic AC")]));
});

test("two installations of the same model retain independent unit identities", () => {
  const value = { ...work(), maintenanceInstallationIds: ["installation", "second"],
    maintenanceDeviceSelections: { installation: [device(3)], second: [device(2)] } };
  assert.doesNotThrow(() => check(value, [item(2)], [installation(), installation("second", [item(2)])],
    [link(), link([device(2)], "second")], [item(1), item(1)]));
  assert.throws(() => check(value, [item(2)], [installation(), installation("second", [item(2)])],
    [link([device(2)]), link([device(3)], "second")], [item(2)]), friendly);
});

test("missing, duplicate, stale or out-of-scope source/link data fails closed", () => {
  const cases = [
    [work(), [], [link()]],
    [work(), [installation(), installation()], [link()]],
    [work(), [{ ...installation(), id: "another-customer" }], [link()]],
    [work(), [{ ...installation(), appointmentType: "maintenance" }], [link()]],
    [work(), [installation()], []],
    [work(), [installation()], [link(), link()]],
    [work(), [installation()], [link(), link(null, "unselected")]],
    [work([device(5)]), [installation()], [link([device(5)])]],
    [work([device(3), device(3)]), [installation()], [link()]],
    [work([]), [installation()], [link([])]],
    [{ ...work(), maintenanceInstallationIds: ["installation", "installation"] }, [installation()], [link()]],
  ];
  for (const [value, sources, links] of cases) assert.throws(() => check(value, [item(1)], sources, links, [item(1)]), friendly);
});

test("a deselected installation's empty UI entry is ignored, but a hidden nonempty selection is not", () => {
  const value = { ...work(), maintenanceDeviceSelections: { ...work().maintenanceDeviceSelections, second: [] } };
  assert.doesNotThrow(() => check(value, [item(1)], [installation()], [link()], [item(1)]));
  value.maintenanceDeviceSelections.second = [device(1)];
  assert.throws(() => check(value, [item(1)], [installation()], [link()], [item(1)]), friendly);
});

test("summary-only selected device metadata is checked when no selection map is present", () => {
  const value = { ...legacyWork(), maintenanceInstallations: [{ appointmentId: "installation", selectedDevices: [device(3)], quoteItems: [item(1)] }] };
  assert.doesNotThrow(() => check(value, [item(1)], [installation()], [link()], [item(1)]));
  assert.throws(() => check(value, [item(1)], [installation()], [link(null)], [item(1)]), friendly);
});

function guardedPage(options = {}) {
  const products = h.load("src/lib/alinflow/products.ts");
  const appointments = h.load("src/lib/alinflow/appointments.ts");
  const reports = h.load("src/lib/alinflow/work-report.ts");
  const scopes = h.load("src/lib/alinflow/report-scope.ts");
  const billing = h.load("src/lib/alinflow/billing.ts");
  const selected = { ...work(), activeQuoteId: "maintenance-quote", email: "test@example.invalid", date: "2026-11-06", time: "08:00" };
  const signed = { ...reports.emptyWorkReport(selected), id: "report", signatureDataUrl: "data:image/png;base64,U1lOVEhFVElD", signedAt: "2026-11-06T08:00:00Z" };
  const state = { workspace: "workspace", reads: [], writes: [], messages: [], requests: [] };
  const context = { ...products, ...appointments, ...reports, ...scopes, ...billing,
    selected, quoteItems: [item(1)], workReport: signed, workReportDeclaration: undefined,
    assertMaintenanceDeviceConsistency: check, customerInstallationWorks: () => [installation()],
    currentWorkspaceId: () => state.workspace, authUserIdRef: { current: "user" }, authLoadGenerationRef: { current: 1 },
    pendingActionsRef: { current: new Set() }, invoiceReceiptsRef: { current: new Map() }, workReportReceiptsRef: { current: new Map() },
    workReportLoadBlocked: false, savedReportFor: () => signed,
    workspaceSettings: h.load("src/lib/alinflow/workspace-settings.ts").defaultWorkspaceSettings(null),
    beginAction: () => true, endAction: noop, setMessage: value => state.messages.push(value),
    setWorkReportBusy: noop, setWorkReportEmailBusy: noop, setInvoiceBusy: noop,
    scheduleDate: selected.date, scheduleTime: selected.time, shownTime: selected.time,
    window: { confirm: () => true }, ft: value => String(value),
    authenticatedFetch: async (...args) => { state.requests.push(args); throw Error("External writes are forbidden"); },
    persistCustomerToDb: async value => { state.writes.push(value); throw Error("Appointment writes are forbidden"); },
    logDocument: async value => { state.writes.push(value); throw Error("Document writes are forbidden"); },
    supabase: database(op => {
      if (op.method !== "select") { state.writes.push(op); throw Error("Database writes are forbidden"); }
      state.reads.push(op);
      if (options.onRead) options.onRead(op, state, context);
      if (options.readError) return { error: { message: "Synthetic read failure" } };
      if (op.table === "appointments") return { data: { quote_id: "maintenance-quote" } };
      if (op.table === "maintenance_appointment_items") return { data: [link(options.valid ? [device(3)] : null)] };
      if (op.table === "quote_items") return { data: [{ product_name: "Synthetic AC", quantity: 1, unit_price: 100000, description: "manual=true" }] };
      throw Error(`Unexpected table ${op.table}`);
    }),
  };
  return { ...h.functions(["assertMaintenanceSelectionSaved", "saveWorkReport", "markInstallationDone", "createInvoice"], context), selected, state, context };
}

test("page consistency guard reads scoped current appointment, links and persisted quote before accepting", async () => {
  const f = guardedPage({ valid: true });
  await assert.doesNotReject(() => f.assertMaintenanceSelectionSaved(f.selected, [item(1)]));
  assert.deepEqual(f.state.reads.map(op => [op.table, op.filters]), [
    ["appointments", { workspace_id: "workspace", customer_id: "customer", id: "maintenance", appointment_type: "maintenance" }],
    ["maintenance_appointment_items", { workspace_id: "workspace", customer_id: "customer", maintenance_appointment_id: "maintenance" }],
    ["quote_items", { workspace_id: "workspace", quote_id: "maintenance-quote" }],
  ]);
  assert.equal(f.state.writes.length, 0);
});

for (const action of ["report", "close", "invoice"]) test(`inconsistent saved links prevent ${action} before any database or external write`, async () => {
  const f = guardedPage();
  if (action === "report") await f.saveWorkReport(false);
  else if (action === "close") await f.markInstallationDone();
  else await f.createInvoice("maintenance", "15000", "cash");
  assert.deepEqual(f.state.reads.map(op => op.table), ["appointments", "maintenance_appointment_items", "quote_items"]);
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.state.messages.at(-1), friendly);
});

test("a failed verification read is never interpreted as legacy unlinked maintenance", async () => {
  const f = guardedPage({ readError: true });
  await assert.rejects(() => f.assertMaintenanceSelectionSaved(f.selected, [item(1)]), error => error.message === "Synthetic read failure");
  assert.equal(f.state.reads.length, 1);
  assert.equal(f.state.writes.length, 0);
});

test("workspace, identity or load generation changes invalidate pending consistency reads", async () => {
  for (const change of [state => { state.workspace = "different-workspace"; },
    (_state, context) => { context.authUserIdRef.current = "different-user"; },
    (_state, context) => { context.authLoadGenerationRef.current++; }]) {
    const f = guardedPage({ valid: true, onRead: (_op, state, context) => change(state, context) });
    await assert.rejects(() => f.assertMaintenanceSelectionSaved(f.selected, [item(1)]), /munkaterület megváltozott/);
    assert.equal(f.state.reads.length, 1);
    assert.equal(f.state.writes.length, 0);
  }
});
