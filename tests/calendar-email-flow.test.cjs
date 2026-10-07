const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, noop } = require("./helpers.cjs");

const workspaceId = "10000000-1111-4000-8000-000000000001";
const customerId = "20000000-1111-4000-8000-000000000001";
const appointmentId = "30000000-1111-4000-8000-000000000001";
const quoteId = "40000000-1111-4000-8000-000000000001";
const oldAppointmentId = "30000000-1111-4000-8000-000000000002";
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(options = {}) {
  const h = harness();
  const products = h.load("src/lib/alinflow/products.ts");
  const appointments = h.load("src/lib/alinflow/appointments.ts");
  const documents = h.load("src/lib/alinflow/documents.ts");
  const delivery = h.load("src/lib/alinflow/calendar-email-delivery.ts");
  products.setActiveProducts([{ id: "synthetic-ac", name: "Synthetic AC", price: 320000, installPrice: 80000 }]);
  const settings = h.load("src/lib/alinflow/workspace-settings.ts").defaultWorkspaceSettings(null);
  const existing = options.existing;
  const draft = {
    date: "2026-11-10", time: "10:30", appointmentType: "installation",
    customerMode: existing ? "existing" : "new", name: "Synthetic calendar customer", phone: "",
    email: "calendar@example.invalid", city: "Synthetic city", postalCode: "0000", address: "Synthetic street",
    notes: "Synthetic appointment note", productId: "synthetic-ac", quantity: 2, price: 310000,
    maintenanceInstallationIds: existing ? [oldAppointmentId] : [], ...options.draft,
  };
  const unrelated = {
    id: "20000000-1111-4000-8000-000000000009", activeAppointmentId: oldAppointmentId,
    name: "Unrelated selected customer", email: "unrelated@example.invalid", status: "Ajánlat elküldve",
    quoteItems: [{ customName: "Unrelated AC", quantity: 1, customPrice: 999999 }],
  };
  const state = {
    workspaceId, persist: [], requests: [], logs: [], warnings: [], messages: [],
    selected: [], promoted: [], dialogs: [], saving: [], prompts: [], links: [],
  };
  const savingRef = { current: false };
  const deliveryRef = { current: null };
  const context = {
    ...products, ...appointments, ...documents, ...delivery,
    quickAppointment: draft, quickAppointmentSavingRef: savingRef, quickAppointmentDeliveryRef: deliveryRef,
    selected: unrelated, quoteItems: unrelated.quoteItems, quoteIssuedAt: "", workspaceSettings: settings,
    allWorkCustomers: [], EMPTY_QUOTE_ITEMS: [], currentWorkspaceId: () => state.workspaceId,
    quickAppointmentSelectedCustomer: () => existing,
    customerInstallationWorks: () => existing ? [existing] : [],
    maintenanceInstallationSummariesForIds: () => [],
    appointmentTimeAvailable: () => true,
    persistCustomerToDb: async customer => {
      state.persist.push(plain(customer));
      return options.persist ? options.persist(customer) : { appointmentId, quoteId };
    },
    logDocument: async (...args) => {
      state.logs.push(args);
      if (options.log) await options.log(...args);
    },
    authenticatedFetch: async (url, init, expectedWorkspaceId) => {
      const request = { url, body: JSON.parse(init.body), expectedWorkspaceId };
      state.requests.push(request);
      return options.send ? options.send(request, state) : Response.json({ ok: true, id: "synthetic-only" });
    },
    saveMaintenanceAppointmentLinks: async (customer, ids) => state.links.push({ customer, ids }),
    setQuickAppointment: value => state.dialogs.push(value),
    setQuickAppointmentSaving: value => state.saving.push(value),
    setQuickAppointmentSaveWarning: value => state.warnings.push(value),
    setQuickAppointmentEmailPrompt: value => state.prompts.push(value),
    setMessage: value => state.messages.push(value),
    setSelected: value => state.selected.push(value),
    promoteCustomerWork: value => state.promoted.push(value),
    setQuoteItems: noop, setScheduleDate: noop, setScheduleTime: noop, setScheduleAppointmentType: noop,
    loadCustomerDetailData: async () => {}, setAppointmentEmailBusy: noop,
  };
  const f = h.functions([
    "saveQuickAppointment", "quickAppointmentQuoteItems", "sendQuickAppointmentEmail",
    "skipQuickAppointmentEmail", "quotePayload", "brandedAppointmentDocumentTitle", "sendAppointmentEmailFor",
  ], context);
  return { ...f, h, products, appointments, documents, delivery, state, draft, unrelated, settings, savingRef, deliveryRef };
}

function existingCustomer(overrides = {}) {
  return {
    id: customerId, activeAppointmentId: oldAppointmentId, activeQuoteId: "old-quote", activeWorkReportId: "old-report",
    name: "Synthetic existing customer", email: "existing@example.invalid", city: "Synthetic city",
    phone: "", address: "Synthetic address", source: "Test", status: "Lezárva", need: "",
    date: "2025-01-01", time: "08:00", appointmentType: "installation", stockDeducted: true,
    quoteItems: [{ customName: "Previously installed AC", quantity: 1, customPrice: 250000 }], ...overrides,
  };
}

test("calendar installation saves once and automatically sends two emails for the saved work", async () => {
  const f = fixture({ send: async (request, state) => {
    assert.deepEqual(state.dialogs, [null], "creation is closed before any email starts");
    return Response.json({ ok: true });
  } });
  await f.saveQuickAppointment();
  assert.equal(f.state.persist.length, 1);
  assert.deepEqual(f.state.requests.map(r => r.url), ["/api/send-quote", "/api/send-appointment"]);
  for (const request of f.state.requests) {
    assert.equal(request.body.customer.id, f.state.persist[0].id);
    assert.equal(request.body.customer.activeAppointmentId, appointmentId);
    assert.equal(request.body.customer.email, "calendar@example.invalid");
    assert.equal(request.body.customer.date, f.draft.date);
    assert.equal(request.body.customer.time, f.draft.time);
    assert.equal(request.body.items[0].name, "Synthetic AC");
    assert.equal(request.body.totalAmount, 620000);
    assert.equal(request.expectedWorkspaceId, workspaceId);
  }
  assert.equal(f.deliveryRef.current.customer.status, "Időpont foglalva");
  assert.equal(f.deliveryRef.current.customer.activeQuoteId, quoteId);
  assert.equal(f.state.selected.length, 1, "sending never replaces or downgrades selected work");
  assert.ok(f.state.logs.every(([customer]) => customer.activeAppointmentId === appointmentId));
  assert.deepEqual(f.state.logs.map(([, type]) => type), [
    f.documents.appointmentBookedDocumentType("installation"), "quote_email",
    f.documents.appointmentEmailDocumentType("installation"),
  ]);
  assert.ok(f.deliveryRef.current.steps.every(step => step.sentAt && step.logged));
  assert.equal(f.savingRef.current, false);
});

test("same-tick calendar save calls create only one work while persistence is pending", async () => {
  const gate = deferred();
  const f = fixture({ persist: async () => { await gate.promise; return { appointmentId, quoteId }; } });
  const first = f.saveQuickAppointment();
  const second = f.saveQuickAppointment();
  assert.equal(f.savingRef.current, true);
  assert.equal(f.state.persist.length, 1);
  assert.equal(f.state.requests.length, 0);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(f.state.persist.length, 1);
  assert.equal(f.state.requests.length, 2);
  assert.deepEqual(f.state.saving, [true, false]);
});

test("booking-log failure preserves the saved work, closes creation, and still sends both emails", async () => {
  const f = fixture({ log: async (_customer, _type, _title, status) => {
    if (status === "Rögzítve") throw Error("Synthetic booking log failure");
  } });
  await f.saveQuickAppointment();
  assert.equal(f.state.persist.length, 1);
  assert.deepEqual(f.state.dialogs, [null]);
  assert.equal(f.state.promoted[0].activeAppointmentId, appointmentId);
  assert.equal(f.state.requests.length, 2);
  assert.match(f.state.warnings[0], /időpont mentve.*Synthetic booking log failure/);
  assert.ok(f.deliveryRef.current.steps.every(step => step.sentAt && step.logged));
});

for (const type of ["survey", "maintenance"]) {
  test(`calendar ${type} with old climate items sends only its appointment email and preserves earlier work`, async () => {
    const existing = existingCustomer();
    const before = plain(existing);
    const f = fixture({ existing, draft: { appointmentType: type } });
    await f.saveQuickAppointment();
    assert.deepEqual(existing, before);
    assert.equal(f.state.persist.length, 1);
    assert.equal(f.state.persist[0].id, existing.id);
    assert.equal(f.state.persist[0].activeAppointmentId, undefined);
    assert.equal(f.state.persist[0].activeQuoteId, undefined);
    assert.equal(f.state.persist[0].activeWorkReportId, undefined);
    assert.deepEqual(f.state.requests.map(r => r.url), ["/api/send-appointment"]);
    assert.equal(f.state.requests[0].body.customer.activeAppointmentId, appointmentId);
    assert.equal(f.state.requests[0].body.customer.appointmentType, type);
    assert.ok(f.state.logs.every(([, documentType]) => documentType !== "quote_email"));
    if (type === "maintenance") {
      assert.equal(f.state.logs.length, 0, "maintenance confirmation is not a permanent document");
      assert.equal(f.state.links[0].customer.activeAppointmentId, appointmentId);
      assert.deepEqual(f.state.links[0].ids, [oldAppointmentId]);
    }
  });
}

test("a calendar work without an email is saved without invoking either email endpoint", async () => {
  const f = fixture({ draft: { email: "" } });
  await f.saveQuickAppointment();
  assert.equal(f.state.persist.length, 1);
  assert.deepEqual(f.state.dialogs, [null]);
  assert.equal(f.state.requests.length, 0);
  assert.ok(f.deliveryRef.current.steps.every(step => !step.sentAt && /email címét/.test(step.error)));
});

test("failed persistence or missing saved appointment identity never starts email delivery", async () => {
  for (const persist of [async () => { throw Error("Synthetic save failure"); }, async () => ({ quoteId })]) {
    const f = fixture({ persist });
    await f.saveQuickAppointment();
    assert.equal(f.state.requests.length, 0);
    assert.equal(f.state.logs.length, 0);
    assert.equal(f.state.dialogs.length, 0);
    assert.equal(f.deliveryRef.current, null);
    assert.equal(f.savingRef.current, false);
    assert.match(f.state.messages.at(-1), /Mentési hiba/);
  }
});

test("partial delivery retries only the failed endpoint with its original payload and no appointment writes", async () => {
  let rejectAppointment = true;
  const f = fixture({ send: async request => request.url === "/api/send-appointment" && rejectAppointment
    ? Response.json({ error: "Synthetic appointment failure" }, { status: 502 }) : Response.json({ ok: true }) });
  await f.saveQuickAppointment();
  const job = f.deliveryRef.current;
  const originalCustomer = plain(job.customer);
  const originalPayload = plain(job.payload);
  assert.ok(job.steps[0].sentAt && job.steps[0].logged);
  assert.equal(job.steps[1].sentAt, undefined);
  assert.equal(job.steps[1].error, "Synthetic appointment failure");
  f.unrelated.email = "changed-global@example.invalid";
  f.draft.email = "changed-draft@example.invalid";
  f.settings.companyProfile.displayName = "Changed company";
  rejectAppointment = false;
  await f.sendQuickAppointmentEmail();
  assert.deepEqual(f.state.requests.map(r => r.url), ["/api/send-quote", "/api/send-appointment", "/api/send-appointment"]);
  assert.deepEqual(f.state.requests[2].body, f.state.requests[1].body);
  assert.deepEqual(plain(job.customer), originalCustomer);
  assert.deepEqual(plain(job.payload), originalPayload);
  assert.equal(f.state.persist.length, 1);
  assert.equal(f.state.selected.length, 1);
  assert.ok(job.steps.every(step => step.sentAt && step.logged && !step.error));
});

test("a failed sent-document write retries logging without resending an accepted email", async () => {
  let fail = true;
  const f = fixture({ log: async (_customer, type) => {
    if (type === "quote_email" && fail) throw Error("Synthetic sent-log failure");
  } });
  await f.saveQuickAppointment();
  const job = f.deliveryRef.current;
  const sentAt = job.steps[0].sentAt;
  assert.ok(sentAt);
  assert.equal(job.steps[0].logged, false);
  assert.ok(job.steps[1].logged);
  fail = false;
  const beforeLogs = f.state.logs.length;
  await f.sendQuickAppointmentEmail();
  assert.equal(f.state.requests.length, 2);
  assert.equal(f.state.persist.length, 1);
  assert.equal(f.state.logs.length, beforeLogs + 1);
  assert.equal(f.state.logs.at(-1)[1], "quote_email");
  assert.equal(f.state.logs.at(-1)[4], sentAt);
  assert.ok(job.steps[0].logged);
});

test("concurrent retry and close calls cannot duplicate or detach a delivery in progress", async () => {
  const gate = deferred();
  const f = fixture({ send: async request => {
    if (request.url === "/api/send-quote") await gate.promise;
    return Response.json({ ok: true });
  } });
  const customer = existingCustomer({ activeAppointmentId: appointmentId, status: "Időpont foglalva" });
  const job = f.delivery.createCalendarEmailDelivery(customer, f.quotePayload(customer, customer.quoteItems), workspaceId);
  f.deliveryRef.current = job;
  const first = f.sendQuickAppointmentEmail();
  const second = f.sendQuickAppointmentEmail();
  f.skipQuickAppointmentEmail();
  assert.equal(f.deliveryRef.current, job);
  assert.equal(f.state.requests.length, 1);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(f.state.requests.length, 2);
  f.skipQuickAppointmentEmail();
  assert.equal(f.deliveryRef.current, null);
  assert.equal(f.state.prompts.at(-1), null);
});

test("a delivery cannot send or log under a different current workspace", async () => {
  const f = fixture();
  const customer = existingCustomer({ activeAppointmentId: appointmentId });
  const job = f.delivery.createCalendarEmailDelivery(customer, f.quotePayload(customer, customer.quoteItems), workspaceId);
  f.deliveryRef.current = job;
  f.state.workspaceId = "10000000-1111-4000-8000-000000000002";
  await f.sendQuickAppointmentEmail();
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.logs.length, 0);
  assert.ok(job.steps.every(step => !step.sentAt && /munkaterület megváltozott/.test(step.error)));
});

for (const type of ["installation", "survey", "maintenance"]) {
  test(`manual ${type} appointment email does not log a quote as sent`, async () => {
    const f = fixture();
    const result = await f.sendAppointmentEmailFor(existingCustomer({ appointmentType: type }));
    assert.equal(result, true);
    assert.deepEqual(f.state.requests.map(r => r.url), ["/api/send-appointment"]);
    assert.deepEqual(f.state.logs.map(([, documentType]) => documentType), type === "maintenance" ? []
      : [f.documents.appointmentEmailDocumentType(type)]);
  });
}

test("quote sent markers require a real quote log or quote status, not an appointment confirmation", () => {
  const h = harness();
  const documents = h.load("src/lib/alinflow/documents.ts");
  let quoteDoc;
  const appointmentDoc = { status: "Elküldve", sentAt: "2026-10-01T10:00:00.000Z" };
  const lookups = [];
  const f = h.functions(["quoteSentAtFor", "customerHasSentQuote", "sentDocumentTimestamp"], {
    statusMeansSent: documents.statusMeansSent, normalizeStatus: value => value,
    docFor: (_customer, type) => { lookups.push(type); return type === "quote_email" ? quoteDoc : appointmentDoc; },
  });
  const customer = existingCustomer({ status: "Időpont foglalva", quoteSentAt: "2020-01-01T10:00:00.000Z" });
  assert.equal(f.quoteSentAtFor(customer), undefined);
  assert.equal(f.customerHasSentQuote(customer), false);
  assert.ok(lookups.every(type => type === "quote_email"));
  quoteDoc = { status: "Elküldve", sentAt: "2026-10-07T10:00:00.000Z" };
  assert.equal(f.quoteSentAtFor(customer), quoteDoc.sentAt);
  assert.equal(f.customerHasSentQuote(customer), true);
  quoteDoc = undefined;
  customer.status = "Ajánlat elküldve";
  assert.equal(f.customerHasSentQuote(customer), true);
  assert.equal(f.quoteSentAtFor(customer), customer.quoteSentAt);
});
