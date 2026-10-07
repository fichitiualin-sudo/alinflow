const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database } = require("./helpers.cjs");

const workspaceId = "10000000-0000-4000-8000-000000000001";
const customerId = "20000000-0000-4000-8000-000000000001";
const appointmentId = "30000000-0000-4000-8000-000000000001";
const deliveryId = "40000000-0000-4000-8000-000000000001";
const createdAt = "2026-10-07T10:00:00.000Z";
const initialNow = Date.parse(createdAt);

function fixture({ type = "installation", workspace = workspaceId, appointment = appointmentId, denied = false } = {}) {
  const state = { now: initialNow, name: "Stored <customer>", email: "stored@example.invalid" };
  const outgoing = [];
  const accepted = new Map();
  const db = database(op => {
    if (denied || op.filters.workspace_id !== workspace) return { data: null };
    if (op.table === "workspace_members") return { data: { workspace_id: workspace } };
    if (op.table === "customers" && op.filters.id === customerId) return { data: {
      id: customerId, name: state.name, email: state.email, phone: "06000000000",
      city: "Tesztváros", postal_code: "0000", address: "Mentett ügyfélcím",
    } };
    if (op.table === "appointments" && op.filters.id === appointment && op.filters.customer_id === customerId) {
      return { data: { id: appointment, customer_id: customerId, workspace_id: workspace,
        appointment_type: type, address: "Mentett munkacím", scheduled_date: "2026-10-09", scheduled_time: "10:00" } };
    }
    return { data: null };
  });
  db.auth = { getUser: async () => ({ data: { user: { id: "synthetic-user" } } }) };
  class ControlledDate extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])); }
    static now() { return state.now; }
  }
  const h = harness({ Date: ControlledDate, process: { env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public",
    RESEND_API_KEY: "synthetic-mail-key", EMAIL_FROM: "Test <test@example.invalid>",
  } }, fetch: async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    outgoing.push({ url, options });
    const key = options.headers["Idempotency-Key"];
    if (key && accepted.has(key)) {
      const original = accepted.get(key);
      if (original.body !== options.body) return Response.json({ message: "PRIVATE PROVIDER CONFLICT synthetic-mail-key" }, { status: 409 });
      return Response.json({ id: original.id });
    }
    const id = `synthetic-send-${outgoing.length}`;
    if (key) accepted.set(key, { body: options.body, id });
    return Response.json({ id });
  } }, { "@supabase/supabase-js": { createClient: () => db } });
  const body = { workspaceId: workspace, customer: { id: customerId, activeAppointmentId: appointment,
    name: "UNTRUSTED NAME", email: "stored@example.invalid", address: "UNTRUSTED ADDRESS" },
    items: [{ name: "Synthetic climate", quantity: 1, unitPrice: 250000, totalPrice: 250000 }],
    totalAmount: 250000, calendarEmailDelivery: { id: deliveryId, createdAt } };
  const post = (kind, patch = {}) => h.load(`src/app/api/send-${kind}/route.ts`).POST(new Request("https://test.invalid/api", {
    method: "POST", headers: { Authorization: "Bearer synthetic-token", "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, ...patch }),
  }));
  return { h, state, outgoing, body, post };
}

for (const kind of ["quote", "appointment"]) test(`calendar ${kind} retries use the same provider key and exact frozen body`, async () => {
  const f = fixture();
  const first = await f.post(kind);
  assert.equal(first.status, 200);
  f.state.now += 10 * 60 * 1000;
  const second = await f.post(kind);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).id, (await first.json()).id);
  const [a, b] = f.outgoing.map(item => item.options);
  assert.equal(a.headers["Idempotency-Key"], `alinflow-calendar/${workspaceId}/${appointmentId}/${kind}/${deliveryId}`);
  assert.equal(a.headers["Idempotency-Key"], b.headers["Idempotency-Key"]);
  assert.equal(a.body, b.body);
  const payload = JSON.parse(a.body);
  assert.equal(payload.headers["X-Entity-Ref-ID"], a.headers["Idempotency-Key"]);
  assert.deepEqual(payload.to, ["stored@example.invalid"]);
  assert.match(payload.html, /Stored &lt;customer&gt;/);
  assert.match(payload.html, /Mentett munkacím/);
  assert.doesNotMatch(payload.html, /UNTRUSTED/);
});

test("calendar delivery keys separate kind, workspace, appointment and logical send", async () => {
  const f = fixture();
  const otherWorkspace = fixture({ workspace: "10000000-0000-4000-8000-000000000002" });
  const otherAppointment = fixture({ appointment: "30000000-0000-4000-8000-000000000002" });
  await f.post("quote");
  await f.post("appointment");
  await f.post("quote", { calendarEmailDelivery: { id: "40000000-0000-4000-8000-000000000002", createdAt } });
  await otherWorkspace.post("quote");
  await otherAppointment.post("quote");
  const keys = [...f.outgoing, ...otherWorkspace.outgoing, ...otherAppointment.outgoing]
    .map(item => item.options.headers["Idempotency-Key"]);
  assert.equal(new Set(keys).size, 5);
});

for (const kind of ["quote", "appointment"]) test(`calendar ${kind} invalid or expired identities stop before provider calls`, async () => {
  const f = fixture();
  const timestamp = offset => new Date(initialNow + offset).toISOString();
  const cases = [
    [null, 400], [[], 400], [{}, 400], [{ id: "not-a-uuid", createdAt }, 400],
    [{ id: deliveryId, createdAt: "2026-10-07" }, 400],
    [{ id: deliveryId, createdAt: "2026-02-30T10:00:00Z" }, 400],
    [{ id: deliveryId, createdAt: timestamp(5 * 60 * 1000 + 1) }, 400],
    [{ id: deliveryId, createdAt: timestamp(-23 * 60 * 60 * 1000 - 1) }, 409],
  ];
  for (const [calendarEmailDelivery, expected] of cases) {
    assert.equal((await f.post(kind, { calendarEmailDelivery })).status, expected);
  }
  assert.equal(f.outgoing.length, 0);
});

test("calendar retry age and clock skew accept their exact safety boundaries", () => {
  const f = fixture();
  const { calendarEmailDeliveryForRequest } = f.h.load("src/lib/alinflow/calendar-email-idempotency.ts");
  const authorization = { workspaceId, appointment: { id: appointmentId, appointment_type: "installation" } };
  for (const offset of [-23 * 60 * 60 * 1000, 5 * 60 * 1000]) {
    assert.ok(calendarEmailDeliveryForRequest({ calendarEmailDelivery: {
      id: deliveryId.toUpperCase(), createdAt: new Date(initialNow + offset).toISOString(),
    } }, authorization, "quote", initialNow));
  }
});

for (const kind of ["quote", "appointment"]) test(`calendar ${kind} requires the customer's authorized saved appointment`, async () => {
  const f = fixture();
  assert.equal((await f.post(kind, { customer: { ...f.body.customer, activeAppointmentId: undefined } })).status, 400);
  assert.equal((await f.post(kind, { customer: { ...f.body.customer, activeAppointmentId: "another-appointment" } })).status, 403);
  assert.equal(f.outgoing.length, 0);
  const denied = fixture({ denied: true });
  assert.equal((await denied.post(kind)).status, 403);
  assert.equal(denied.outgoing.length, 0);
});

test("calendar quote is installation-only while appointment email supports survey and maintenance", async () => {
  for (const type of ["survey", "maintenance", "unknown", null]) {
    const f = fixture({ type });
    assert.equal((await f.post("quote")).status, 400);
    assert.equal(f.outgoing.length, 0);
    if (type === "survey" || type === "maintenance") {
      assert.equal((await f.post("appointment")).status, 200);
      const payload = JSON.parse(f.outgoing[0].options.body);
      assert.match(payload.subject, type === "survey" ? /Felmérés/ : /Karbantartás/);
    }
  }
});

for (const kind of ["quote", "appointment"]) test(`calendar ${kind} surfaces changed authorized content as a safe provider conflict`, async () => {
  const f = fixture();
  assert.equal((await f.post(kind)).status, 200);
  f.state.name = "Updated stored customer";
  const retry = await f.post(kind);
  assert.equal(retry.status, 409);
  const error = (await retry.json()).error;
  assert.match(error, /korábbi naptáras emailküldés/);
  assert.doesNotMatch(error, /PRIVATE|synthetic-mail-key/);
  assert.equal(f.outgoing.length, 2);
  assert.equal(f.outgoing[0].options.headers["Idempotency-Key"], f.outgoing[1].options.headers["Idempotency-Key"]);
});

for (const kind of ["quote", "appointment"]) test(`ordinary ${kind} emails retain their prior behavior without calendar constraints`, async () => {
  const f = fixture({ type: "maintenance" });
  const patch = { calendarEmailDelivery: undefined, customer: { ...f.body.customer, activeAppointmentId: undefined } };
  assert.equal((await f.post(kind, patch)).status, 200);
  f.state.now += 1000;
  assert.equal((await f.post(kind, patch)).status, 200);
  const payloads = f.outgoing.map(item => JSON.parse(item.options.body));
  assert.ok(f.outgoing.every(item => !Object.hasOwn(item.options.headers, "Idempotency-Key")));
  assert.match(payloads[0].headers["X-Entity-Ref-ID"], new RegExp(`^alinflow-${kind}-`));
  assert.notEqual(payloads[0].headers["X-Entity-Ref-ID"], payloads[1].headers["X-Entity-Ref-ID"]);
});
