const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

function fixture(options = {}) {
  const h = harness();
  const products = h.load("src/lib/alinflow/products.ts");
  const billing = h.load("src/lib/alinflow/billing.ts");
  const workspaceSettings = h.load("src/lib/alinflow/workspace-settings.ts").defaultWorkspaceSettings(null);
  const customer = {
    id: "synthetic-customer", activeAppointmentId: "synthetic-appointment", email: "synthetic@example.invalid",
    quoteItems: [{ customName: "Synthetic climate", quantity: 1, customPrice: 250000 }],
  };
  const pendingActionsRef = { current: new Set() };
  const invoiceReceiptsRef = { current: new Map() };
  const state = { workspaceId: "synthetic-workspace", requests: [], confirmations: [], checklist: [], messages: [], busy: [], pending: [] };
  const f = h.functions(["createInvoice", "beginAction", "endAction"], {
    ...products, ...billing, selected: customer, quoteItems: customer.quoteItems,
    workspaceSettings, EMPTY_QUOTE_ITEMS: [], pendingActionsRef, invoiceReceiptsRef,
    currentWorkspaceId: () => state.workspaceId,
    ft: amount => `${amount} Ft`,
    window: { confirm(message) { state.confirmations.push(message); return options.confirm !== false; } },
    authenticatedFetch: async (url, init, expectedWorkspaceId) => {
      const request = { url, body: JSON.parse(init.body), expectedWorkspaceId };
      state.requests.push(request);
      return options.send ? options.send(request) : Response.json({ ok: true, invoiceNumber: "SYNTHETIC-2026-42", emailSent: true });
    },
    updateChecklistForCustomer: async (customer, changes) => {
      state.checklist.push({ customer, changes });
      if (options.checklist) await options.checklist();
    },
    setChecklistItem: async (key, value) => {
      state.checklist.push({ customer, changes: { [key]: value } });
      if (options.checklist) await options.checklist();
    },
    setMessage: (message, tone) => state.messages.push({ message, tone }),
    setInvoiceBusy: value => state.busy.push(value),
    setPendingActions: value => state.pending.push(value),
  });
  return { ...f, customer, state, pendingActionsRef, invoiceReceiptsRef };
}

for (const kind of ["device", "combined"]) {
  test(`accepted ${kind} invoice retries only checklist persistence without another confirmation or invoice`, async () => {
    let rejectChecklist = true;
    const f = fixture({ checklist: async () => { if (rejectChecklist) throw Error("Synthetic checklist write detail"); } });
    await f.createInvoice(kind, "120 000", "transfer", true);
    assert.equal(f.state.requests.length, 1);
    assert.equal(f.state.requests[0].url, "/api/create-invoice");
    assert.equal(f.state.requests[0].body.amount, 120000);
    assert.equal(f.state.requests[0].body.sendEmail, true);
    assert.equal(f.state.confirmations.length, 1);
    assert.match(f.state.confirmations[0], /120000 Ft/);
    assert.equal(f.state.messages.at(-1).tone, "warning");
    assert.equal(f.state.messages.at(-1).message,
      "A számla elkészült (SYNTHETIC-2026-42), de az ellenőrzőlista mentése nem sikerült: Synthetic checklist write detail Újrapróbáláskor csak az állapotot mentjük.");
    assert.equal(f.invoiceReceiptsRef.current.size, 1);
    assert.equal(f.pendingActionsRef.current.size, 0);

    rejectChecklist = false;
    await f.createInvoice(kind, "120 000", "transfer", true);
    assert.equal(f.state.requests.length, 1, "known accepted invoice must never be created again for a checklist retry");
    assert.equal(f.state.confirmations.length, 1, "record-only retry must not ask to create another invoice");
    assert.equal(f.state.checklist.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(f.state.checklist[1].changes)), kind === "combined" ? { amovaInvoice: true, alinInvoice: true } : { amovaInvoice: true });
    assert.match(f.state.messages.at(-1).message, /Számlaszám: SYNTHETIC-2026-42.*Emailben elküldve/);
    assert.equal(f.invoiceReceiptsRef.current.size, 0);
    assert.equal(f.pendingActionsRef.current.size, 0);
    assert.deepEqual(f.state.busy, [kind, null, kind, null]);
  });
}

test("invoice provider error or malformed success cannot mark the checklist or show invoice success", async () => {
  for (const reply of [
    () => Response.json({}),
    () => new Response("upstream response body"),
    () => Response.json({ ok: false, error: "Synthetic invoice rejection" }, { status: 502 }),
  ]) {
    const f = fixture({ send: reply });
    await f.createInvoice("labor", "10000", "cash");
    assert.equal(f.state.checklist.length, 0);
    assert.equal(f.invoiceReceiptsRef.current.size, 0);
    assert.equal(f.pendingActionsRef.current.size, 0);
    assert.equal(f.state.messages.at(-1).tone, "error");
    assert.match(f.state.messages.at(-1).message, /^Számlázási hiba:/);
    assert.doesNotMatch(f.state.messages.at(-1).message, /elkészült/);
    assert.deepEqual(f.state.busy, ["labor", null]);
  }
});

test("double invoice click cannot create a second invoice or confirmation while the first request is pending", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ send: async () => { await gate; return Response.json({ ok: true, invoiceNumber: "SYNTHETIC-ONE" }); } });
  const first = f.createInvoice("maintenance", "15000", "cash");
  await f.createInvoice("maintenance", "15000", "cash");
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.confirmations.length, 1);
  assert.equal(f.state.checklist.length, 0);
  release();
  await first;
  assert.equal(f.state.checklist.length, 1);
  assert.match(f.state.messages.at(-1).message, /Számlaszám: SYNTHETIC-ONE/);
  assert.equal(f.pendingActionsRef.current.size, 0);
  assert.deepEqual(f.state.busy, ["maintenance", null]);
});

test("declined invoice creation and invalid amount cause no external request or checklist change", async () => {
  const declined = fixture({ confirm: false });
  await declined.createInvoice("labor", "10000", "cash");
  assert.equal(declined.state.confirmations.length, 1);
  assert.equal(declined.state.requests.length, 0);
  assert.equal(declined.state.checklist.length, 0);
  const invalid = fixture();
  await invalid.createInvoice("labor", "not-a-number", "cash");
  assert.equal(invalid.state.confirmations.length, 0);
  assert.equal(invalid.state.requests.length, 0);
  assert.equal(invalid.state.checklist.length, 0);
});

test("late invoice acceptance cannot write checklist data or show an invoice from the previous workspace", async () => {
  const f = fixture({ send: async () => {
    f.state.workspaceId = "different-workspace";
    return Response.json({ ok: true, invoiceNumber: "PREVIOUS-WORKSPACE-INVOICE" });
  } });
  await f.createInvoice("labor", "10000", "cash");
  assert.equal(f.state.requests[0].expectedWorkspaceId, "synthetic-workspace");
  assert.equal(f.state.checklist.length, 0, "a previous workspace's result must not cause a write in the new workspace");
  assert.equal(f.invoiceReceiptsRef.current.size, 0, "late completion must not repopulate cleared receipts");
  assert.ok(f.state.messages.every(({ message }) => !message.includes("PREVIOUS-WORKSPACE-INVOICE")));
  assert.equal(f.pendingActionsRef.current.size, 0);
});

test("late invoice failure is not published in another workspace", async () => {
  const f = fixture({ send: async () => {
    f.state.workspaceId = "different-workspace";
    return Response.json({ error: "PREVIOUS-WORKSPACE-ERROR" }, { status: 502 });
  } });
  await f.createInvoice("labor", "10000", "cash");
  assert.equal(f.state.checklist.length, 0);
  assert.ok(f.state.messages.every(({ message }) => !message.includes("PREVIOUS-WORKSPACE-ERROR")));
  assert.equal(f.pendingActionsRef.current.size, 0);
});
