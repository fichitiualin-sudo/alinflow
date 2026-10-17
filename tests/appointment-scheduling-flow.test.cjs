const assert = require("node:assert/strict");
const test = require("node:test");
const { harness, noop } = require("./helpers.cjs");
const h = harness();
const appointments = h.load("src/lib/alinflow/appointments.ts");
const schedule = h.load("src/lib/alinflow/schedule.ts");
const products = h.load("src/lib/alinflow/products.ts");
const constants = h.load("src/lib/alinflow/constants.ts");
const selection = h.load("src/lib/alinflow/maintenance-selection.ts");
const plain = value => JSON.parse(JSON.stringify(value));
const date = "2026-11-10";
const device = quantity => ({ isManual: true, customName: "Synthetic climate", quantity, customPrice: 100000 });
const person = extra => ({ id: "customer", name: "Synthetic Customer", email: "synthetic@example.invalid",
  phone: "", city: "Synthetic city", address: "Synthetic street", need: "", notes: "", source: "Test",
  status: "Időpont foglalva", appointmentType: "installation", quoteItems: [device(1)], ...extra });
const booked = extra => person({ id: "other-customer", activeAppointmentId: "other-appointment", date,
  time: "08:00", ...extra });

function fixture(options = {}) {
  const desiredType = options.type || "installation";
  const selected = person({ appointmentType: desiredType, ...options.selected });
  const items = options.items || [device(1)];
  const state = { selected, persisted: [], emails: [], deliveries: [], logs: [], links: [], messages: [],
    navigation: [], stock: [], dialogs: [], pending: new Set() };
  let actions;
  const installations = options.installations || [person({ activeAppointmentId: "previous-installation", date: "2025-01-01", time: "08:00", status: "Lezárva" })];
  const draft = { appointmentType: desiredType, customerMode: options.quickExisting ? "existing" : "new",
    date: options.date ?? date, time: options.time ?? "08:00", name: "Synthetic New Customer", email: "synthetic@example.invalid",
    city: "Synthetic City", postalCode: "", phone: "", address: "Synthetic street", notes: "", quoteItems: items,
    sendQuoteEmail: true, sendAppointmentEmail: true,
    maintenanceInstallationIds: installations.map(work => work.activeAppointmentId), ...options.quick };
  const context = { ...appointments, ...schedule, ...products, ...constants, ...selection,
    selected, quoteItems: items, scheduleDate: options.date ?? date, scheduleTime: options.time ?? "08:00",
    normalizedScheduleAppointmentType: desiredType, allWorkCustomers: options.works || [],
    EMPTY_QUOTE_ITEMS: [], pendingActionsRef: { current: state.pending }, maintenanceReturnRef: { current: null },
    appointmentAliasesRef: { current: null }, currentWorkspaceId: () => "workspace",
    workHistoryByCustomer: { [selected.id]: installations },
    beginAction: key => { if (state.pending.has(key)) return false; state.pending.add(key); return true; },
    endAction: key => state.pending.delete(key),
    setMessage: (message, tone) => state.messages.push({ message, tone }),
    persistCustomerToDb: async value => { actions.ensureAppointmentDurationAvailable(value); state.persisted.push(plain(value)); return {
      appointmentId: value.activeAppointmentId || "new-appointment", quoteId: "saved-quote" }; },
    promoteCustomerWork: noop, setSelected: value => { state.selected = value; },
    clearCustomerDraft: noop, readCustomerDraft: () => null, setDraftNotice: noop,
    replaceView: view => state.navigation.push(view), sendAppointmentNotice: true,
    sendAppointmentEmailFor: async value => { state.emails.push(plain(value)); return true; },
    logDocument: async (...args) => state.logs.push(args),
    appointmentBookedDocumentType: type => `${type}_booked`,
    saveMaintenanceAppointmentLinks: async (...args) => state.links.push(args),
    quickAppointment: draft, quickAppointmentSavingRef: { current: false }, quickAppointmentDeliveryRef: { current: null },
    quickAppointmentSelectedCustomer: () => options.quickExisting ? selected : undefined,
    setQuickAppointment: value => state.dialogs.push(value), setQuickAppointmentSaving: noop,
    setQuickAppointmentSaveWarning: noop, setQuickAppointmentEmailPrompt: noop,
    setQuoteItems: noop, setScheduleDate: noop, setScheduleTime: noop, setScheduleAppointmentType: noop,
    createCalendarEmailDelivery: value => { state.deliveries.push(plain(value)); return { customer: value }; },
    quotePayload: value => value, sendQuickAppointmentEmail: async delivery => state.emails.push(plain(delivery.customer)),
    loadCustomerDetailData: async () => {}, workResourceEditLocked: false, allowWorkResourceEdit: true,
    materials: [], materialOverrides: {}, setAllowWorkResourceEdit: noop,
    stockMaterialQuantities: (...args) => state.stock.push(args),
  };
  actions = h.functions(["saveSchedule", "saveQuickAppointment", "saveWorkChanges", "quickAppointmentQuoteItems", "ensureAppointmentDurationAvailable",
    "currentAppointmentAliases", "canonicalMaintenanceIds", "customerInstallationWorks", "maintenanceSelectionIsAvailable",
    "maintenanceQuoteItemsForInstallationIds", "maintenanceInstallationSummariesForIds"], context);
  return { ...actions, state, draft, context };
}

function assertNothingSaved(f) {
  assert.equal(f.state.persisted.length, 0);
  assert.equal(f.state.emails.length, 0);
  assert.equal(f.state.deliveries.length, 0);
  assert.equal(f.state.logs.length, 0);
  assert.equal(f.state.links.length, 0);
  assert.equal(f.state.navigation.length, 0);
  assert.ok(f.state.messages.length, "rejection gives visible feedback");
  assert.equal(f.state.pending.size, 0);
}

for (const method of ["saveSchedule", "saveQuickAppointment"]) {
  for (const quantity of [2, 3]) {
    test(`${method}: ${quantity}-climate existing installation blocks its full duration before persistence or email`, async () => {
      const f = fixture({ time: quantity === 2 ? "12:00" : "16:00", works: [booked({ quoteItems: [device(quantity)] })] });
      await f[method]();
      assertNothingSaved(f);
    });

    test(`${method}: proposed ${quantity}-climate duration cannot extend into the following work`, async () => {
      const f = fixture({ time: "08:00", items: [device(quantity)], works: [booked({ time: quantity === 2 ? "12:00" : "16:00" })] });
      await f[method]();
      assertNothingSaved(f);
    });
  }

  for (const time of ["18:30", "23:99", ""]) {
    test(`${method}: invalid or after-midnight six-hour visit (${JSON.stringify(time)}) never saves or emails`, async () => {
      const f = fixture({ time, items: [device(2)] });
      await f[method]();
      assertNothingSaved(f);
    });
  }

  test(`${method}: back-to-back appointment at the actual six-hour end is accepted`, async () => {
    const f = fixture({ time: "14:00", works: [booked({ quoteItems: [device(2)] })] });
    await f[method]();
    assert.equal(f.state.persisted.length, 1, f.state.messages.map(item => item.message).join("; "));
    assert.equal(f.state.persisted[0].time, "14:00");
    assert.equal(f.state.emails.length, 1);
  });

  test(`${method}: large extra-item quantities do not make a single-climate visit longer`, async () => {
    const f = fixture({ items: [device(1), { ...device(50), itemType: "extra", customName: "Synthetic installation material" }],
      works: [booked({ time: "11:00", appointmentType: "survey" })] });
    await f[method]();
    assert.equal(f.state.persisted.length, 1, f.state.messages.map(item => item.message).join("; "));
    assert.equal(f.state.emails.length, 1);
  });
}

test("editing the same saved appointment excludes only its own old interval", async () => {
  const selected = booked({ id: "customer", activeAppointmentId: "own-appointment" });
  const f = fixture({ selected, works: [selected], time: "09:00" });
  await f.saveSchedule();
  assert.equal(f.state.persisted.length, 1);
  assert.equal(f.state.persisted[0].activeAppointmentId, "own-appointment");
  assert.equal(f.state.emails.length, 1);
});

test("editing cannot exclude another overlapping appointment belonging to the same customer", async () => {
  const selected = booked({ id: "customer", activeAppointmentId: "own-appointment" });
  const f = fixture({ selected, works: [selected, booked({ id: "customer", activeAppointmentId: "second-work", time: "11:00" })], time: "09:00" });
  await f.saveSchedule();
  assertNothingSaved(f);
});

test("starting maintenance from an installation never excludes the source installation interval", async () => {
  const selected = booked({ id: "customer", activeAppointmentId: "source-installation" });
  const f = fixture({ type: "maintenance", selected, installations: [selected], works: [selected], time: "09:00" });
  await f.saveSchedule();
  assertNothingSaved(f);
});

test("calendar creates a new maintenance and never excludes the existing customer's installation", async () => {
  const selected = booked({ id: "customer", activeAppointmentId: "source-installation" });
  const f = fixture({ type: "maintenance", selected, quickExisting: true, installations: [selected], works: [selected], time: "09:00" });
  await f.saveQuickAppointment();
  assertNothingSaved(f);
});

test("same customer with a new work has no automatic collision exemption in the calendar", async () => {
  const selected = booked({ id: "customer", activeAppointmentId: "source-installation" });
  const f = fixture({ selected, quickExisting: true, works: [selected], time: "09:00" });
  await f.saveQuickAppointment();
  assertNothingSaved(f);
});

test("cancelled appointments do not block saving, but a completed appointment keeps its occupied interval", async () => {
  for (const status of ["Lemondva", "Lezárva"]) {
    const f = fixture({ time: "09:00", works: [booked({ status, quoteItems: [device(2)] })] });
    await f.saveSchedule();
    if (status === "Lemondva") assert.equal(f.state.persisted.length, 1);
    else assertNothingSaved(f);
  }
});

test("WorkPage quantity increase cannot extend a saved installation into another appointment", async () => {
  const selected = booked({ id: "customer", activeAppointmentId: "own-appointment" });
  const f = fixture({ selected, items: [device(2)], works: [selected, booked({ time: "12:00", appointmentType: "survey" })] });
  await f.saveWorkChanges();
  assertNothingSaved(f);
  assert.equal(f.state.stock.length, 0);
});

for (const quantity of [1, 2]) {
  test(`WorkPage ${quantity === 2 ? "price-only" : "quantity-reduction"} edit does not block an unchanged historical overlap`, async () => {
    const selected = booked({ id: "customer", activeAppointmentId: "own-appointment", quoteItems: [device(2)] });
    const f = fixture({ selected, items: [{ ...device(quantity), customPrice: 120000 }],
      works: [selected, booked({ time: "12:00", appointmentType: "survey" })] });
    await f.saveWorkChanges();
    assert.equal(f.state.persisted.length, 1, f.state.messages.map(item => item.message).join("; "));
    assert.equal(f.state.persisted[0].activeAppointmentId, "own-appointment");
    assert.equal(f.state.persisted[0].quoteItems[0].quantity, quantity);
    assert.equal(f.state.persisted[0].quoteItems[0].customPrice, 120000);
  });
}

test("shared persistence preflight rejects an extending quantity before any caller writes or sends", () => {
  const selected = booked({ id: "customer", activeAppointmentId: "own-appointment" });
  const f = fixture({ selected, works: [selected, booked({ time: "12:00", appointmentType: "survey" })] });
  assert.throws(() => f.ensureAppointmentDurationAvailable({ ...selected, quoteItems: [device(2)] }));
  assert.equal(f.state.persisted.length, 0);
  assert.equal(f.state.emails.length, 0);
  assert.doesNotThrow(() => f.ensureAppointmentDurationAvailable({ ...selected, quoteItems: [{ ...device(1), customPrice: 90000 }] }));
});

test("shared persistence preflight permits a valid extension ending exactly at the next appointment", () => {
  const selected = booked({ id: "customer", activeAppointmentId: "own-appointment" });
  const f = fixture({ selected, works: [selected, booked({ time: "14:00", appointmentType: "survey" })] });
  assert.doesNotThrow(() => f.ensureAppointmentDurationAvailable({ ...selected, quoteItems: [device(2)] }));
});
