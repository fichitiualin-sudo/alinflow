const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");

function fixture(options = {}) {
  const h = harness();
  const { isInstallationAppointment } = h.load("src/lib/alinflow/appointments.ts");
  const customer = {
    id: "synthetic-customer",
    activeAppointmentId: "synthetic-appointment",
    appointmentType: options.appointmentType || "installation",
    status: "Szerelés kész – admin folyamatban",
    email: "synthetic@example.invalid",
    quoteItems: [],
  };
  const saved = { ...customer, status: "Lezárva", stockDeducted: true };
  const state = { events: [], messages: [], emailCalls: [], saved: [], documents: [] };
  const f = h.functions(["closeWork"], {
    selected: customer,
    quoteItems: customer.quoteItems,
    isInstallationAppointment,
    stockErrorMessage: () => options.stockError || "",
    checklistReady: options.checklistReady !== false,
    missingChecklist: ["NKVH"],
    completeInstallation: async (status) => {
      state.events.push("save-start");
      assert.equal(status, "Lezárva");
      if (options.complete) await options.complete();
      state.saved.push(saved);
      state.events.push("save-complete");
      return saved;
    },
    persistCustomerToDb: async (value) => { state.saved.push(value); },
    logDocument: async (...args) => { state.documents.push(args); },
    setSelected: () => {},
    promoteCustomerWork: () => {},
    setAllowWorkResourceEdit: () => {},
    setMessage: (message) => { state.messages.push(message); },
    returnToLastMenu: () => { state.events.push("return-to-menu"); },
    sendThankYouEmailFor: async (...args) => {
      state.emailCalls.push(args);
      state.events.push("email");
    },
  });
  return { ...f, state, saved };
}

test("opting out closes the installation and returns to the menu without sending a thank-you email", async () => {
  const f = fixture();
  await f.closeWork(false);
  assert.equal(f.state.saved.length, 1);
  assert.equal(f.state.saved[0].status, "Lezárva");
  assert.equal(f.state.emailCalls.length, 0);
  assert.deepEqual(f.state.events, ["save-start", "save-complete", "return-to-menu"]);
  assert.match(f.state.messages.at(-1), /Köszönő email nem indult/);
});

test("opting in sends once with the persisted installation only after closure succeeds", async () => {
  let releaseSave;
  const pendingSave = new Promise((resolve) => { releaseSave = resolve; });
  const f = fixture({ complete: () => pendingSave });
  const closing = f.closeWork(true);
  assert.deepEqual(f.state.events, ["save-start"]);
  assert.equal(f.state.emailCalls.length, 0, "No email may start while the closure is still saving");
  releaseSave();
  await closing;
  assert.equal(f.state.emailCalls.length, 1);
  assert.strictEqual(f.state.emailCalls[0][0], f.saved);
  assert.equal(f.state.emailCalls[0][1], true, "Keep the existing automatic-send error reporting");
  assert.deepEqual(f.state.events, ["save-start", "save-complete", "return-to-menu", "email"]);
});

test("a failed closure never sends the requested thank-you email or reports success", async () => {
  const f = fixture({ complete: async () => { throw Error("Synthetic persistence failure"); } });
  await f.closeWork(true);
  assert.equal(f.state.emailCalls.length, 0);
  assert.equal(f.state.saved.length, 0);
  assert.deepEqual(f.state.events, ["save-start"]);
  assert.match(f.state.messages.at(-1), /Mentési hiba: Synthetic persistence failure/);
});

test("an incomplete checklist blocks both closure and the requested email", async () => {
  const f = fixture({ checklistReady: false });
  await f.closeWork(true);
  assert.equal(f.state.emailCalls.length, 0);
  assert.equal(f.state.saved.length, 0);
  assert.deepEqual(f.state.events, []);
  assert.match(f.state.messages.at(-1), /Nem zárható teljesen.*NKVH/);
});

test("insufficient stock blocks both closure and the requested email", async () => {
  const f = fixture({ stockError: "Synthetic stock shortage" });
  await f.closeWork(true);
  assert.equal(f.state.emailCalls.length, 0);
  assert.equal(f.state.saved.length, 0);
  assert.deepEqual(f.state.events, []);
  assert.equal(f.state.messages.at(-1), "Synthetic stock shortage");
});

test("maintenance closure never sends an installation thank-you email even when requested", async () => {
  const f = fixture({ appointmentType: "maintenance" });
  await f.closeWork(true);
  assert.equal(f.state.saved.length, 1);
  assert.equal(f.state.saved[0].status, "Lezárva");
  assert.equal(f.state.documents.length, 1);
  assert.equal(f.state.documents[0][1], "work_closed");
  assert.equal(f.state.emailCalls.length, 0);
  assert.deepEqual(f.state.events, ["return-to-menu"]);
});
