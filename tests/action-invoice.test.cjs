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
  const f = h.functions(["createInvoice", "markManualInvoice", "beginAction", "endAction"], {
    ...products, ...billing, selected: customer, quoteItems: customer.quoteItems,
    workspaceSettings, EMPTY_QUOTE_ITEMS: [], pendingActionsRef, invoiceReceiptsRef,
    currentWorkspaceId: () => state.workspaceId,
    ft: amount => `${amount} Ft`,
    navigator: { onLine: options.online !== false },
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

for (const kind of ["device", "labor", "maintenance", "combined"]) {
  for (const action of ["automatic", "manual"]) {
    test(`offline ${action} ${kind} invoicing stops before confirmation, writes, or receipt changes`, async () => {
      const f = fixture({ online: false });
      const receiptKey = `synthetic-workspace:${f.customer.id}:${f.customer.activeAppointmentId}:${kind}`;
      const receipt = { invoiceNumber: "SYNTHETIC-SAVED", emailSent: false };
      f.invoiceReceiptsRef.current.set(receiptKey, receipt);
      if (action === "automatic") await f.createInvoice(kind, "10000", "cash");
      else await f.markManualInvoice(kind);
      assert.equal(f.state.confirmations.length, 0);
      assert.equal(f.state.requests.length, 0);
      assert.equal(f.state.checklist.length, 0);
      assert.equal(f.invoiceReceiptsRef.current.size, 1);
      assert.equal(f.invoiceReceiptsRef.current.get(receiptKey), receipt);
      assert.equal(f.pendingActionsRef.current.size, 0);
      assert.deepEqual(f.state.busy, []);
      assert.equal(f.state.messages.at(-1).tone, "error");
    });
  }
}

test("automatic completion requires explicit success and a nonempty string invoice number", async () => {
  for (const result of [
    { ok: true },
    { ok: true, invoiceNumber: null },
    { ok: true, invoiceNumber: "" },
    { ok: true, invoiceNumber: " \t\n" },
    { ok: true, invoiceNumber: 42 },
    { ok: true, invoiceNumber: { value: "SYNTHETIC-42" } },
    { ok: "true", invoiceNumber: "SYNTHETIC-42" },
    { ok: 1, invoiceNumber: "SYNTHETIC-42" },
  ]) {
    const f = fixture({ send: () => Response.json(result) });
    await f.createInvoice("device", "10000", "cash");
    assert.equal(f.state.requests.length, 1);
    assert.equal(f.state.checklist.length, 0, JSON.stringify(result));
    assert.equal(f.invoiceReceiptsRef.current.size, 0);
    assert.equal(f.state.messages.at(-1).tone, "error");
    assert.equal(f.pendingActionsRef.current.size, 0);
    assert.deepEqual(f.state.busy, ["device", null]);
  }
});

test("a valid invoice number is trimmed before receipt retention and success display", async () => {
  let rejectChecklist = true;
  const f = fixture({
    send: () => Response.json({ ok: true, invoiceNumber: "  SYNTHETIC-TRIMMED \n", emailSent: false }),
    checklist: async () => { if (rejectChecklist) throw Error("Synthetic write failure"); },
  });
  await f.createInvoice("labor", "10000", "cash");
  assert.equal([...f.invoiceReceiptsRef.current.values()][0].invoiceNumber, "SYNTHETIC-TRIMMED");
  rejectChecklist = false;
  await f.createInvoice("labor", "10000", "cash");
  assert.equal(f.state.requests.length, 1);
  assert.match(f.state.messages.at(-1).message, /Számlaszám: SYNTHETIC-TRIMMED/);
  assert.doesNotMatch(f.state.messages.at(-1).message, /TRIMMED\s+$/);
});

test("a network exception cannot mark an invoice complete or retain a receipt", async () => {
  const f = fixture({ send: async () => { throw new TypeError("Synthetic network failure"); } });
  await f.createInvoice("maintenance", "10000", "cash");
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.checklist.length, 0);
  assert.equal(f.invoiceReceiptsRef.current.size, 0);
  assert.equal(f.state.messages.at(-1).tone, "error");
  assert.match(f.state.messages.at(-1).message, /Synthetic network failure/);
  assert.equal(f.pendingActionsRef.current.size, 0);
  assert.deepEqual(f.state.busy, ["maintenance", null]);
});

test("declining external invoice confirmation leaves the manual checklist unchanged", async () => {
  const f = fixture({ confirm: false });
  await f.markManualInvoice("device");
  assert.equal(f.state.confirmations.length, 1);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.checklist.length, 0);
  assert.equal(f.invoiceReceiptsRef.current.size, 0);
  assert.equal(f.pendingActionsRef.current.size, 0);
  assert.deepEqual(f.state.busy, []);
  assert.equal(f.state.messages.length, 0);
});

test("manual checklist persistence failure reports an error and releases the invoice lock", async () => {
  const f = fixture({ checklist: async () => { throw Error("Synthetic manual persistence failure"); } });
  await f.markManualInvoice("combined");
  assert.equal(f.state.confirmations.length, 1);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.checklist.length, 1);
  assert.equal(f.state.messages.at(-1).tone, "error");
  assert.match(f.state.messages.at(-1).message, /Synthetic manual persistence failure/);
  assert.ok(f.state.messages.every(({ tone }) => tone !== "success"));
  assert.equal(f.invoiceReceiptsRef.current.size, 0);
  assert.equal(f.pendingActionsRef.current.size, 0);
  assert.deepEqual(f.state.busy, ["combined", null]);
});

for (const kind of ["device", "labor", "maintenance", "combined"]) {
  test(`confirmed external ${kind} invoice marks only the matching checklist without an issuance request`, async () => {
    const f = fixture();
    await f.markManualInvoice(kind);
    assert.equal(f.state.confirmations.length, 1);
    assert.equal(f.state.requests.length, 0);
    assert.equal(f.state.checklist.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.state.checklist[0].changes)),
      kind === "combined" ? { amovaInvoice: true, alinInvoice: true }
        : kind === "device" ? { amovaInvoice: true } : { alinInvoice: true });
    assert.match(f.state.messages.at(-1).message, /Kézi számlázás készre jelölve/);
    assert.equal(f.invoiceReceiptsRef.current.size, 0);
    assert.equal(f.pendingActionsRef.current.size, 0);
    assert.deepEqual(f.state.busy, [kind, null]);
  });
}

test("pending automatic invoice prevents manual confirmation and checklist writes", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ send: async () => {
    await gate;
    return Response.json({ ok: true, invoiceNumber: "SYNTHETIC-CONCURRENT" });
  } });
  const automatic = f.createInvoice("device", "10000", "cash");
  await f.markManualInvoice("labor");
  assert.equal(f.state.confirmations.length, 1);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.checklist.length, 0);
  release();
  await automatic;
  assert.equal(f.state.checklist.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.checklist[0].changes)), { amovaInvoice: true });
  assert.equal(f.pendingActionsRef.current.size, 0);
  assert.deepEqual(f.state.busy, ["device", null]);
});

test("pending manual completion prevents automatic and duplicate manual actions", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ checklist: () => gate });
  const manual = f.markManualInvoice("labor");
  await f.createInvoice("device", "10000", "cash");
  await f.markManualInvoice("labor");
  assert.equal(f.state.confirmations.length, 1);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.checklist.length, 1);
  release();
  await manual;
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.checklist[0].changes)), { alinInvoice: true });
  assert.equal(f.pendingActionsRef.current.size, 0);
  assert.deepEqual(f.state.busy, ["labor", null]);
});

test("the manual invoice checkbox reflects saved completion after a failed write", async () => {
  const jsx = (type, props) => ({ type, props });
  const viewHarness = harness({}, { "react/jsx-runtime": { jsx, jsxs: jsx } });
  const { InvoicePrepCard } = viewHarness.functions(["InvoicePrepCard"], {
    billingPaymentMethodLabel: method => method, formatDoneAt: value => value,
    ft: amount => `${amount} Ft`, WorkSectionIcon: () => null,
  }, "src/components/alinflow/WorkPagePanel.tsx");
  const f = fixture({ checklist: async () => { throw Error("Synthetic offline write failure"); } });
  let completion;
  const render = done => InvoicePrepCard({
    title: "Synthetic invoice", invoiceLineNames: [], amount: "10000", parsedAmount: 10000,
    done, paymentMethod: "cash", sendEmail: false, dueDate: "2026-11-11", invoiceBusy: false,
    customerEmail: "synthetic@example.invalid", onAmountChange() {}, onPaymentMethodChange() {},
    onSendEmailChange() {}, onCreateInvoice() {},
    onManualComplete: () => { completion = f.markManualInvoice("labor"); },
  });
  function nodes(value) {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== "object") return [];
    return [value, ...nodes(value.props?.children)];
  }
  const manualCheckbox = tree => {
    const label = nodes(tree).find(node => node.type === "label" &&
      JSON.stringify(node.props?.children).includes("Kézi számlázás"));
    return label && nodes(label).find(node => node.type === "input" && node.props.type === "checkbox");
  };
  const checkbox = manualCheckbox(render(false));
  assert.ok(checkbox);
  assert.equal(checkbox.props.checked, false, "manual completion must be controlled by saved state");
  checkbox.props.onChange({ target: { checked: true } });
  await completion;
  assert.equal(f.state.messages.at(-1).tone, "error");
  assert.equal(manualCheckbox(render(false)).props.checked, false);
  assert.equal(manualCheckbox(render(true)), undefined, "completed invoices must not offer another manual completion");
});
