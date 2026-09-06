const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database } = require("./helpers.cjs");
const routes = ["send-quote", "send-appointment", "send-work-report", "send-thank-you", "create-invoice"];
const workspaceId = "10000000-0000-0000-0000-000000000001";
const customerId = "20000000-0000-0000-0000-000000000001";
function apiHarness(failure) {
  const outgoing = [];
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-public-key",
    RESEND_API_KEY: "fake-mail-key", EMAIL_FROM: "Test <test@example.invalid>",
    SZAMLAZZ_LABOR_AGENT_KEY: "fake-invoice-key", SZAMLAZZ_WORKSPACE_ID: workspaceId,
  };
  const db = database(op => {
    if (op.table === failure) return { data: null, error: null };
    if (op.table === "workspace_members") return { data: { workspace_id: workspaceId } };
    if (op.table === "customers") return { data: { id: customerId, name: "Stored Customer",
      email: "stored@example.invalid", phone: "06000000000", city: "Test", postal_code: "0000", address: "Stored street" } };
    if (op.table === "appointments") return { data: { id: "appointment", customer_id: customerId, appointment_type: "maintenance" } };
    throw Error("Unexpected query " + op.table);
  });
  db.auth = { getUser: async () => failure === "auth" ? { data: {}, error: Error("invalid") } : { data: { user: { id: "user" } } } };
  const h = harness({ process: { env }, fetch: async (url, options) => {
    outgoing.push({ url: String(url), options });
    if (String(url).includes("szamlazz.hu")) return new Response("<valasz><sikeres>true</sikeres><szamlaszam>TEST-ONLY</szamlaszam></valasz>");
    return Response.json({ id: "TEST-ONLY" });
  } }, { "@supabase/supabase-js": { createClient: () => db } });
  const body = { workspaceId, customer: { id: customerId, name: "Supplied Customer",
    email: "STORED@example.invalid", activeAppointmentId: "appointment" }, kind: "maintenance", amount: 12000,
    items: [], quoteItems: [], report: {} };
  const request = (token = "test-token", patch = {}) => new Request("https://test.invalid/api", {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify({ ...body, ...patch }) });
  return { h, env, request, outgoing };
}

for (const route of routes) test("A01: " + route + " rejects unauthenticated calls without external requests", async () => {
  const { h, request, outgoing } = apiHarness();
  const response = await h.load("src/app/api/" + route + "/route.ts").POST(request(""));
  assert.equal(response.status, 401);
  assert.equal(outgoing.length, 0);
});

for (const [failure, status] of [["auth", 401], ["workspace_members", 403], ["customers", 403], ["appointments", 403]]) {
  test("A01: reject unavailable " + failure + " before sending mail", async () => {
    const { h, request, outgoing } = apiHarness(failure);
    const response = await h.load("src/app/api/send-quote/route.ts").POST(request());
    assert.equal(response.status, status);
    assert.equal(outgoing.length, 0);
  });
}
test("A01: authorized request takes the recipient from the scoped database row", async () => {
  const { h, request, outgoing } = apiHarness();
  const response = await h.load("src/app/api/send-quote/route.ts").POST(request());
  assert.equal(response.status, 200);
  assert.equal(outgoing.length, 1);
  const payload = JSON.parse(outgoing[0].options.body);
  assert.match(JSON.stringify(payload.to), /stored@example.invalid/);
  assert.doesNotMatch(JSON.stringify(payload.to), /untrusted/);
});
test("R02: another workspace cannot use the global issuer key", async () => {
  const { h, request, outgoing, env } = apiHarness();
  env.SZAMLAZZ_WORKSPACE_ID = "another-workspace";
  const response = await h.load("src/app/api/create-invoice/route.ts").POST(request());
  assert.equal(response.status, 403);
  assert.equal(outgoing.length, 0);
});
test("A01: unsaved recipient changes stop sending instead of silently using the old address", async () => {
  const { h, request, outgoing } = apiHarness();
  const response = await h.load("src/app/api/send-quote/route.ts").POST(request("test-token", {
    customer: { id: customerId, email: "new@example.invalid" },
  }));
  assert.equal(response.status, 409);
  assert.equal(outgoing.length, 0);
});

test("R02: explicitly bound workspace reaches the invoice provider", async () => {
  const { h, request, outgoing } = apiHarness();
  const response = await h.load("src/app/api/create-invoice/route.ts").POST(request());
  assert.equal(response.status, 200);
  assert.equal(outgoing.length, 1);
  assert.match(outgoing[0].url, /szamlazz.hu/);
});
test("A01: client helper attaches workspace and bearer token to every protected request", async () => {
  let sent;
  const h = harness({ fetch: async (url, init) => { sent = { url, init }; return Response.json({}); } });
  const f = h.functions(["authenticatedFetch"], { currentWorkspaceId: () => workspaceId,
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "fake-token" } } }) } } });
  await f.authenticatedFetch("/api/send-quote", { method: "POST", body: JSON.stringify({ customer: { id: customerId } }) });
  assert.equal(sent.init.headers.get("Authorization"), "Bearer fake-token");
  assert.equal(JSON.parse(sent.init.body).workspaceId, workspaceId);
});
