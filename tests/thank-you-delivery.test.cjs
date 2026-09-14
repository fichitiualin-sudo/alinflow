const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const scope = { workspaceId: "10000000-0000-4000-8000-000000000001", customerId: "20000000-0000-4000-8000-000000000001", appointmentId: "30000000-0000-4000-8000-000000000001" };
const stamp = "2026-09-14T12:00:00Z";
class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
const load = () => harness({}, { "@/lib/alinflow/server-auth": { ApiError } }).load("src/lib/alinflow/thank-you-delivery.ts").sendInstallationThankYouOnce;
const payload = { from: "AlinFlow <mail@example.test>", to: ["customer@example.test"], html: "<p>Köszönjük!</p>" };

function fixture() {
  const calls = [], requests = [];
  let row = null, attempt = 0, reply = () => Response.json({ id: "provider-one" });
  let finishError = false, claimError = false, mutateClaim = value => value;
  const client = { async rpc(name, args) {
    calls.push({ name, args });
    if (name === "claim_installation_thank_you") {
      if (claimError) return { error: { message: "offline" } };
      if (row?.state === "sent") return { data: { status: "already_sent", provider_id: row.id, sent_at: stamp } };
      if (row?.state === "sending") return { data: { status: "busy" } };
      if (row?.state === "old") return { data: { status: "needs_review" } };
      const resuming = row?.state === "uncertain";
      if (!resuming) row = { payload_text: args.p_payload_text, payload_signature: args.p_payload_signature,
        idempotency_key: `alinflow-thank-you/${scope.workspaceId}/${scope.appointmentId}/${++attempt}` };
      row.state = "sending";
      row.claim_token = `claim-${calls.length}`;
      return { data: mutateClaim({ ...row, status: "send", resuming: !!resuming }) };
    }
    if (finishError) return { error: { message: "connection lost" } };
    assert.equal(args.p_claim_token, row.claim_token);
    row.state = args.p_outcome;
    row.id = args.p_provider_id;
    return { data: { sent_at: args.p_outcome === "sent" ? stamp : null } };
  } };
  const send = (overrides = {}) => load()({ client, ...scope, apiKey: "test-only-key", payload,
    fetchImpl: async (url, init) => { requests.push({ url, ...init }); return reply(); }, ...overrides });
  return { send, calls, requests, get row() { return row; }, set row(value) { row = value; },
    set reply(value) { reply = value; }, set finishError(value) { finishError = value; }, set claimError(value) { claimError = value; },
    set mutateClaim(value) { mutateClaim = value; } };
}

test("successful send logs the exact appointment then permanently suppresses a repeated request", async () => {
  const f = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(await f.send())), { ok: true, id: "provider-one", alreadySent: false, sentAt: stamp });
  assert.equal((await f.send()).alreadySent, true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls[1].args.p_appointment_id, scope.appointmentId);
  assert.equal(f.calls[1].args.p_workspace_id, scope.workspaceId);
  assert.equal(f.calls[1].args.p_customer_id, scope.customerId);
  assert.equal(f.calls[1].args.p_outcome, "sent");
});

test("parallel request is rejected while a provider request is still in flight", async () => {
  const f = fixture();
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  f.reply = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const first = f.send(); await waiting;
  await assert.rejects(f.send(), error => error.status === 409 && /folyamatban/.test(error.message));
  release(Response.json({ id: "single" })); await first;
  assert.equal(f.requests.length, 1);
});

test("lost provider response retries the identical signed body and key after settings change", async () => {
  const f = fixture(); f.reply = () => { throw new Error("lost response"); };
  await assert.rejects(f.send(), /bizonytalan/);
  assert.equal(f.row.state, "uncertain");
  f.reply = () => Response.json({ id: "accepted-first-time" });
  await f.send({ payload: { ...payload, html: "Changed template" } });
  assert.equal(f.requests[0].body, f.requests[1].body);
  assert.equal(f.requests[0].headers["Idempotency-Key"], f.requests[1].headers["Idempotency-Key"]);
  assert.equal(f.row.id, "accepted-first-time");
});

test("definitive first rejection permits a corrected payload with a new key", async () => {
  const f = fixture(); f.reply = () => Response.json({ message: "validation" }, { status: 422 });
  await assert.rejects(f.send(), /elutasította/);
  assert.equal(f.row.state, "failed");
  f.reply = () => Response.json({ id: "corrected" });
  await f.send({ payload: { ...payload, html: "corrected" } });
  assert.notEqual(f.requests[0].body, f.requests[1].body);
  assert.notEqual(f.requests[0].headers["Idempotency-Key"], f.requests[1].headers["Idempotency-Key"]);
});

test("HTTP rejection after an uncertain attempt cannot remove duplicate protection", async () => {
  const f = fixture(); f.reply = () => { throw new Error("timeout"); };
  await assert.rejects(f.send());
  f.reply = () => Response.json({ message: "rotated credentials" }, { status: 401 });
  await assert.rejects(f.send(), /bizonytalan/);
  assert.equal(f.row.state, "uncertain");
  assert.equal(f.requests[0].headers["Idempotency-Key"], f.requests[1].headers["Idempotency-Key"]);
});

for (const status of [409, 500, 503, 200]) test(`provider ${status} without an accepted id remains uncertain`, async () => {
  const f = fixture(); f.reply = () => Response.json({}, { status });
  await assert.rejects(f.send(), /bizonytalan/);
  assert.equal(f.row.state, "uncertain");
});

test("accepted email with lost ledger response does not falsely report success or free its key", async () => {
  const f = fixture(); f.finishError = true;
  await assert.rejects(f.send(), /elfogadta/);
  assert.equal(f.row.state, "sending");
  f.row.state = "uncertain"; f.finishError = false;
  await f.send();
  assert.equal(f.requests[0].headers["Idempotency-Key"], f.requests[1].headers["Idempotency-Key"]);
  assert.deepEqual(f.calls.filter(c => c.name.startsWith("finish")).map(c => c.args.p_outcome), ["sent", "sent"]);
});

test("expired uncertainty needs review and never reaches the email provider", async () => {
  const f = fixture(); f.row = { state: "old" };
  await assert.rejects(f.send(), error => error.status === 409 && /ellenőrizni/.test(error.message));
  assert.equal(f.requests.length, 0);
});

test("missing ledger migration fails closed before provider access", async () => {
  const f = fixture(); f.claimError = true;
  await assert.rejects(f.send(), error => error.status === 503);
  assert.equal(f.requests.length, 0);
});

test("tampered frozen body, signature or appointment key cannot reach the provider", async () => {
  for (const mutate of [data => ({ ...data, payload_text: JSON.stringify({ ...payload, to: ["other@example.test"] }) }),
    data => ({ ...data, payload_signature: "0".repeat(64) }),
    data => ({ ...data, idempotency_key: "different-work" })]) {
    const f = fixture(); f.mutateClaim = mutate;
    await assert.rejects(f.send(), error => error.status === 409);
    assert.equal(f.requests.length, 0);
  }
});

test("recipient change after uncertain attempt does not resend to the earlier address", async () => {
  const f = fixture(); f.reply = () => { throw Error("timeout"); };
  await assert.rejects(f.send());
  await assert.rejects(f.send({ payload: { ...payload, to: ["changed@example.test"] } }), /email-cím/);
  assert.equal(f.requests.length, 1);
});

test("route allows only a persisted fully closed installation", async () => {
  for (const appointment of [null, { id: scope.appointmentId, appointment_type: "maintenance", status: "Lezárva" },
    { id: scope.appointmentId, appointment_type: "installation", status: "Szerelés kész – admin folyamatban" }]) {
    let sends = 0;
    const route = harness({ process: { env: { RESEND_API_KEY: "test" } } }, {
      "@/lib/alinflow/server-auth": { ApiError, authorizeCustomerRequest: async () => ({ appointment }),
        apiErrorResponse: error => Response.json({ error: error.message }, { status: error.status }) },
      "@/lib/alinflow/thank-you-delivery": { sendInstallationThankYouOnce: async () => { sends++; } },
    }).load("src/app/api/send-thank-you/route.ts");
    const response = await route.POST(new Request("https://example.test", { method: "POST", body: JSON.stringify({ customer: { status: "Lezárva" } }) }));
    assert.equal(response.status, 409);
    assert.equal(sends, 0);
  }
});

test("route passes the authorized saved identity and deterministic entity ref to the helper", async () => {
  let received;
  const route = harness({ process: { env: { RESEND_API_KEY: "test", EMAIL_FROM: "sender@example.test" } } }, {
    "@/lib/alinflow/server-auth": { ApiError, authorizeCustomerRequest: async (_request, body) => {
      body.customer = { id: scope.customerId, email: "saved@example.test", name: "Saved customer" };
      return { client: {}, workspaceId: scope.workspaceId, appointment: { id: scope.appointmentId, appointment_type: "installation", status: "Lezárva" } };
    }, apiErrorResponse: error => { throw error; } },
    "@/lib/alinflow/thank-you-delivery": { sendInstallationThankYouOnce: async options => {
      received = options; return { ok: true, id: "id", alreadySent: false, sentAt: stamp };
    } },
  }).load("src/app/api/send-thank-you/route.ts");
  const response = await route.POST(new Request("https://example.test", { method: "POST", body: JSON.stringify({ customer: { email: "spoof@example.test" } }) }));
  assert.equal(response.status, 200);
  assert.equal(received.customerId, scope.customerId);
  assert.equal(received.appointmentId, scope.appointmentId);
  assert.equal(received.payload.to[0], "saved@example.test");
  assert.equal(received.payload.headers["X-Entity-Ref-ID"], `alinflow-thank-you-${scope.workspaceId}-${scope.appointmentId}`);
});
