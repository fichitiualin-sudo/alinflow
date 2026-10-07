const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const workspaceId = "10000000-1111-4000-8000-000000000001";
const customerId = "20000000-1111-4000-8000-000000000001";
const appointmentId = "30000000-1111-4000-8000-000000000001";
const start = Date.parse("2026-10-07T10:00:00.000Z");

function customer(overrides = {}) {
  return {
    id: customerId, activeAppointmentId: appointmentId, name: "Mesterséges Teszt",
    city: "Budapest", phone: "", email: "synthetic@example.test", address: "Teszt utca 1.",
    source: "Teszt", status: "Időpont egyeztetve", need: "", date: "2026-10-15", time: "08:00",
    appointmentType: "installation", quoteItems: [{ productId: "", customName: "Teszt klíma", quantity: 1 }],
    ...overrides,
  };
}

function fixture(person = customer(), payload = { items: [{ name: "Teszt klíma", quantity: 1 }] }) {
  let now = start;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const api = harness({ Date: Clock }).load("src/lib/alinflow/calendar-email-delivery.ts");
  const job = api.createCalendarEmailDelivery(person, payload, workspaceId);
  return { ...api, job, advance(ms) { now += ms; } };
}

const kinds = job => Array.from(job.steps, step => step.kind);
const states = job => Array.from(job.steps, step => ({ kind: step.kind, sentAt: step.sentAt, logged: step.logged, error: step.error }));

test("creation detaches and freezes customer and request snapshots with a stable delivery identity", () => {
  const person = customer();
  const payload = { customer: { email: person.email }, settings: { senderName: "Teszt" },
    items: [{ name: "Teszt klíma" }], calendarEmailDelivery: { id: "old" }, workspaceId: "wrong" };
  const { job } = fixture(person, payload);
  assert.match(job.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(job.createdAt, new Date(start).toISOString());
  assert.equal(job.payload.calendarEmailDelivery.id, job.id);
  assert.equal(job.payload.calendarEmailDelivery.createdAt, job.createdAt);
  assert.equal(job.payload.workspaceId, workspaceId);
  assert.equal(job.workspaceId, workspaceId);
  assert.deepEqual(kinds(job), ["quote", "appointment"]);
  assert.equal(job.busy, false);
  person.email = "changed@example.test";
  person.quoteItems[0].customName = "Changed climate";
  payload.items[0].name = "Changed request";
  payload.settings.senderName = "Changed company";
  assert.equal(job.customer.email, "synthetic@example.test");
  assert.equal(job.customer.quoteItems[0].customName, "Teszt klíma");
  assert.equal(job.payload.items[0].name, "Teszt klíma");
  assert.equal(job.payload.settings.senderName, "Teszt");
  for (const value of [job.customer, job.customer.quoteItems, job.customer.quoteItems[0],
    job.payload, job.payload.settings, job.payload.items, job.payload.items[0], job.payload.calendarEmailDelivery]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(Object.isFrozen(person), false);
  assert.equal(Object.isFrozen(payload), false);
});

test("creation requires saved customer, appointment and workspace identities", () => {
  const { createCalendarEmailDelivery: create } = fixture();
  for (const value of ["", "local-draft", undefined]) {
    assert.throws(() => create(customer({ id: value }), {}, workspaceId), /mentsd el az ügyfelet és az időpontot/);
    assert.throws(() => create(customer({ activeAppointmentId: value }), {}, workspaceId), /mentsd el az ügyfelet és az időpontot/);
    assert.throws(() => create(customer(), {}, value), /munkaterületet/);
  }
});

test("survey, maintenance and installations without a filled quote need only the appointment email", () => {
  for (const overrides of [{ appointmentType: "survey" }, { appointmentType: "maintenance" },
    { quoteItems: [] }, { quoteItems: [{ productId: "", quantity: 1, customName: "  " }] }]) {
    assert.deepEqual(kinds(fixture(customer(overrides)).job), ["appointment"]);
  }
  assert.deepEqual(kinds(fixture(customer({ appointmentType: undefined })).job), ["quote", "appointment"]);
  assert.deepEqual(kinds(fixture(customer({ quoteItems: [{ productId: "old", productName: "Mentett klíma", quantity: 1 }] })).job), ["quote", "appointment"]);
});

test("both successful emails are sent and recorded in order, with acceptance saved before logging", async () => {
  const f = fixture();
  const calls = [], changes = [];
  const actions = {
    async send(kind, job) { assert.equal(job, f.job); calls.push(`send:${kind}`); f.advance(1000); },
    async record(kind, sentAt, job) {
      assert.equal(job, f.job);
      assert.equal(job.steps.find(step => step.kind === kind).sentAt, sentAt);
      calls.push(`record:${kind}`);
    },
    onChange() { changes.push({ busy: f.job.busy, steps: states(f.job) }); },
  };
  await f.runCalendarEmailDelivery(f.job, actions);
  assert.deepEqual(calls, ["send:quote", "record:quote", "send:appointment", "record:appointment"]);
  assert.ok(f.job.steps.every(step => step.sentAt && step.logged && !step.error));
  assert.equal(f.job.steps[0].sentAt, new Date(start + 1000).toISOString());
  assert.equal(f.job.steps[1].sentAt, new Date(start + 2000).toISOString());
  assert.equal(changes[0].busy, true);
  assert.equal(changes.at(-1).busy, false);
  assert.ok(changes.some(change => change.steps[0].sentAt && !change.steps[0].logged));
  await f.runCalendarEmailDelivery(f.job, actions);
  assert.equal(calls.length, 4, "fully completed jobs cannot resend or relog");
});

for (const failedKind of ["quote", "appointment"]) {
  test(`a failed ${failedKind} send does not block the other step and retries only the failed send`, async () => {
    const f = fixture(), calls = [];
    let first = true;
    const actions = {
      async send(kind) { calls.push(`send:${kind}`); if (kind === failedKind && first) throw Error("Synthetic send failure"); },
      async record(kind) { calls.push(`record:${kind}`); },
    };
    await f.runCalendarEmailDelivery(f.job, actions);
    const failed = f.job.steps.find(step => step.kind === failedKind);
    const successful = f.job.steps.find(step => step.kind !== failedKind);
    assert.equal(failed.sentAt, undefined);
    assert.equal(failed.logged, false);
    assert.equal(failed.error, "Synthetic send failure");
    assert.ok(successful.sentAt && successful.logged);
    assert.equal(f.job.busy, false);
    first = false;
    const previousCalls = calls.length;
    await f.runCalendarEmailDelivery(f.job, actions);
    assert.deepEqual(calls.slice(previousCalls), [`send:${failedKind}`, `record:${failedKind}`]);
    assert.ok(f.job.steps.every(step => step.sentAt && step.logged && !step.error));
  });
}

test("failed logging retains sentAt and retries only the record with its original timestamp", async () => {
  const f = fixture(), calls = [];
  let first = true;
  const actions = {
    async send(kind) { calls.push(`send:${kind}`); },
    async record(kind, sentAt) {
      calls.push(`record:${kind}:${sentAt}`);
      if (kind === "quote" && first) throw Error("Synthetic record failure");
    },
  };
  await f.runCalendarEmailDelivery(f.job, actions);
  const sentAt = f.job.steps[0].sentAt;
  assert.ok(sentAt);
  assert.equal(f.job.steps[0].logged, false);
  assert.equal(f.job.steps[0].error, "Synthetic record failure");
  assert.equal(f.job.steps[1].logged, true);
  first = false;
  f.advance(60_000);
  const count = calls.length;
  await f.runCalendarEmailDelivery(f.job, actions);
  assert.deepEqual(calls.slice(count), [`record:quote:${sentAt}`]);
  assert.equal(f.job.steps[0].sentAt, sentAt);
  assert.equal(f.job.steps[0].logged, true);
  assert.equal(f.job.steps[0].error, undefined);
});

test("a synchronous guard blocks double clicks and reentrant observer calls while a send is pending", async () => {
  const f = fixture(), calls = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let reentered = false;
  const actions = {
    async send(kind) { calls.push(`send:${kind}`); if (kind === "quote") await pending; },
    async record(kind) { calls.push(`record:${kind}`); },
    onChange() {
      if (f.job.busy && !reentered) {
        reentered = true;
        void f.runCalendarEmailDelivery(f.job, actions);
      }
    },
  };
  const first = f.runCalendarEmailDelivery(f.job, actions);
  assert.equal(f.job.busy, true);
  await f.runCalendarEmailDelivery(f.job, actions);
  assert.deepEqual(calls, ["send:quote"]);
  release();
  await first;
  assert.deepEqual(calls, ["send:quote", "record:quote", "send:appointment", "record:appointment"]);
  assert.equal(f.job.busy, false);
});

test("missing customer email reports an actionable error without sending or recording", async () => {
  for (const email of ["", "  ", undefined]) {
    const f = fixture(customer({ email }));
    await f.runCalendarEmailDelivery(f.job, {
      async send() { assert.fail("must not send"); },
      async record() { assert.fail("must not record"); },
    });
    assert.ok(f.job.steps.every(step => !step.sentAt && !step.logged && /email címét/.test(step.error)));
    assert.equal(f.job.busy, false);
  }
});

test("at 23 hours unsent steps stop while an already accepted email may still finish logging", async () => {
  const f = fixture(), calls = [];
  await f.runCalendarEmailDelivery(f.job, {
    async send(kind) { if (kind === "appointment") throw Error("Synthetic uncertain result"); },
    async record() { throw Error("Synthetic record failure"); },
  });
  const sentAt = f.job.steps[0].sentAt;
  f.advance(23 * 60 * 60 * 1000);
  await f.runCalendarEmailDelivery(f.job, {
    async send(kind) { calls.push(`send:${kind}`); },
    async record(kind, at) { calls.push(`record:${kind}:${at}`); },
  });
  assert.deepEqual(calls, [`record:quote:${sentAt}`]);
  assert.equal(f.job.steps[0].logged, true);
  assert.equal(f.job.steps[0].error, undefined);
  assert.equal(f.job.steps[1].sentAt, undefined);
  assert.match(f.job.steps[1].error, /23 órás/);
  assert.equal(f.job.busy, false);
});

test("expiry is rechecked before each send and allows a request just inside the retry window", async () => {
  const f = fixture(), calls = [];
  f.advance(23 * 60 * 60 * 1000 - 1);
  await f.runCalendarEmailDelivery(f.job, {
    async send(kind) { calls.push(`send:${kind}`); f.advance(1); },
    async record(kind) { calls.push(`record:${kind}`); },
  });
  assert.deepEqual(calls, ["send:quote", "record:quote"]);
  assert.equal(f.job.steps[0].logged, true);
  assert.match(f.job.steps[1].error, /23 órás/);
});

test("observer exceptions and non-Error callback failures cannot strand the busy guard or block the second step", async () => {
  const f = fixture(), calls = [];
  await f.runCalendarEmailDelivery(f.job, {
    async send(kind) { calls.push(`send:${kind}`); if (kind === "quote") throw null; },
    async record(kind) { calls.push(`record:${kind}`); throw "synthetic failure"; },
    onChange() { throw Error("Synthetic detached view"); },
  });
  assert.deepEqual(calls, ["send:quote", "send:appointment", "record:appointment"]);
  assert.match(f.job.steps[0].error, /elküldeni/);
  assert.match(f.job.steps[1].error, /naplózása/);
  assert.equal(f.job.busy, false);
});
