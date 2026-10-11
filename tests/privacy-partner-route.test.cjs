const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database } = require("./helpers.cjs");

const workspaceId = "10000000-0000-4000-8000-000000000001";
const requesterId = "20000000-0000-4000-8000-000000000001";
const partnerUserId = "20000000-0000-4000-8000-000000000002";
const partnerWorkspaceId = "10000000-0000-4000-8000-000000000002";
const party = { legalName: "Minta Karbantartó EV", address: "1000 Teszt, Minta utca 1.", email: "partner@example.test", phone: "123", taxNumber: "test" };
const candidateRow = { user_id: partnerUserId, workspace_id: partnerWorkspaceId, workspace_name: "Minta Klíma", party };
const ids = { workspaceId, partnerUserId, partnerWorkspaceId };

function fixture(options = {}) {
  const calls = [], queries = [], rpcs = [];
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://database.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-fixture",
    SUPABASE_SERVICE_ROLE_KEY: "service-fixture", ...options.env,
  };
  const client = {
    ...database(op => {
      queries.push(op);
      if (op.table === "workspace_members") return { data: options.member === false ? null : { role: options.role || "owner" }, error: options.memberError || null };
      if (op.table === "workspaces") return { data: options.active === false ? null : { id: workspaceId }, error: options.workspaceError || null };
      throw Error("Unexpected table " + op.table);
    }),
    auth: { getUser: async token => {
      calls.push({ token });
      return { data: { user: token === "token-fixture" && options.signedIn !== false ? { id: requesterId } : null }, error: options.authError || null };
    } },
  };
  const admin = {
    rpc: async (name, args) => {
      rpcs.push({ name, args });
      if (options.throwRpc) throw Error("secret backend exception");
      return { data: options.rows === undefined ? [candidateRow] : options.rows, error: options.rpcError || null };
    },
  };
  const loader = harness({ process: { env } }, {
    "@supabase/supabase-js": { createClient(url, key, config) {
      calls.push({ url, key, config });
      if (key === "anon-fixture") return client;
      if (key === "service-fixture") return admin;
      throw Error("Unexpected key");
    } },
  });
  const route = loader.load("src/app/api/privacy-partner/route.ts");
  const request = (body = { workspaceId, email: "partner@example.test" }, headers = {}) => new Request("https://app.example.test/api/privacy-partner", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer token-fixture", ...headers }, body: JSON.stringify(body),
  });
  async function post(body, headers) {
    const response = await route.POST(request(body, headers));
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, body: await response.json() };
  }
  return { post, request, route, calls, queries, rpcs };
}

test("privacy partner exact-email lookup authorizes workspace before service-role RPC and exposes only candidate data", async () => {
  const f = fixture({ rows: [{ ...candidateRow, email: "private-login@example.test", raw_user_meta_data: { secret: "hidden" }, party: { ...party, secret: "hidden" } }] });
  const { status, body } = await f.post({ workspaceId: workspaceId.toUpperCase(), email: "  PARTNER@example.test  " });
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, candidates: [{ userId: partnerUserId, workspaceId: partnerWorkspaceId, workspaceName: "Minta Klíma", party, issues: [] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(f.rpcs)), [{ name: "lookup_privacy_partner", args: { p_email: "partner@example.test", p_user_id: null, p_workspace_id: null } }]);
  assert.deepEqual(f.queries.map(op => ({ table: op.table, filters: op.filters })), [
    { table: "workspace_members", filters: { workspace_id: workspaceId, user_id: requesterId, active: true } },
    { table: "workspaces", filters: { id: workspaceId, active: true } },
  ]);
  assert.deepEqual(f.queries.map(op => op.method), ["select", "select"]);
  assert.ok(f.calls.find(item => item.key === "anon-fixture").config.global.headers.Authorization.includes("token-fixture"));
  assert.equal(f.calls.find(item => item.key === "service-fixture").config.global, undefined);
});

test("privacy partner missing and expired authentication never uses privileged RPC", async () => {
  for (const options of [{ headers: { Authorization: "" } }, { signedIn: false }, { authError: { message: "private auth message" } }]) {
    const f = fixture(options);
    const result = await f.post(undefined, options.headers);
    assert.equal(result.status, 401);
    assert.equal(f.rpcs.length, 0);
    assert.equal(f.queries.length, 0);
    assert.equal(f.calls.some(call => call.key === "service-fixture"), false);
    assert.ok(!JSON.stringify(result.body).includes("private"));
  }
});

test("privacy partner foreign, inactive and non-admin source workspaces are denied", async () => {
  for (const options of [{ member: false }, { role: "member" }, { active: false }, { memberError: { message: "secret" } }, { workspaceError: { message: "secret" } }]) {
    const f = fixture(options);
    const result = await f.post();
    assert.equal(result.status, 403);
    assert.equal(f.rpcs.length, 0);
    assert.equal(f.calls.some(call => call.key === "service-fixture"), false);
  }
  assert.equal((await fixture({ role: "admin" }).post()).status, 200);
});

test("privacy partner request validates lookup mode and bounded email without directory search", async () => {
  const invalid = [
    {}, [], null, { workspaceId, email: "" }, { workspaceId, email: "part" }, { workspaceId, email: "%" },
    { workspaceId, email: "x".repeat(255) + "@example.test" }, { workspaceId, email: "x\u0000@example.test" },
    { workspaceId: "invalid", email: "partner@example.test" }, { workspaceId, email: null },
    { workspaceId, email: "partner@example.test", partnerUserId }, { ...ids, email: "partner@example.test" },
    { workspaceId, partnerUserId }, { workspaceId, partnerWorkspaceId }, { ...ids, partnerUserId: "invalid" },
    { ...ids, partnerWorkspaceId: "invalid" }, { workspaceId, email: "partner@example.test", limit: 1000 },
  ];
  for (const input of invalid) {
    const f = fixture();
    assert.equal((await f.post(input)).status, 400, JSON.stringify(input));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture({ rows: [] });
  const result = await f.post({ workspaceId, email: "part%@example.test" });
  assert.equal(result.status, 200);
  assert.equal(f.rpcs[0].args.p_email, "part%@example.test", "Wildcard-like input is passed to exact equality only");
});

test("privacy partner body rejects non-JSON, malformed, absent and oversized streams before lookup", async () => {
  const f = fixture();
  assert.equal((await f.post(undefined, { "Content-Type": "text/plain" })).status, 415);
  for (const body of ["{", "", "[]", '"string"']) {
    const response = await f.route.POST(new Request("https://app.example.test/api/privacy-partner", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
    assert.equal(response.status, 400);
  }
  assert.equal((await f.post({ workspaceId, email: "x".repeat(5000) })).status, 413);
  assert.equal(f.rpcs.length, 0);
});

test("privacy partner revalidation accepts only the exact live user/workspace pair", async () => {
  const f = fixture();
  const result = await f.post(ids);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, candidate: { userId: partnerUserId, workspaceId: partnerWorkspaceId, workspaceName: "Minta Klíma", party, issues: [] } });
  assert.deepEqual(JSON.parse(JSON.stringify(f.rpcs[0].args)), { p_email: null, p_user_id: partnerUserId, p_workspace_id: partnerWorkspaceId });
  for (const rows of [[], [{ ...candidateRow, user_id: requesterId }], [{ ...candidateRow, workspace_id: workspaceId }]]) {
    assert.equal((await fixture({ rows }).post(ids)).status, 404);
  }
});

test("privacy partner incomplete or invalid business details remain visible with issues but cannot be confirmed", async () => {
  for (const badParty of [null, {}, { ...party, legalName: "" }, { ...party, address: "" }, { ...party, email: "not-email" },
    { ...party, legalName: "x".repeat(301) }, { ...party, address: "x".repeat(1001) },
    { ...party, email: "a".repeat(250) + "@test.hu" }, { ...party, phone: "x".repeat(81) },
    { ...party, taxNumber: "x".repeat(81) }, { ...party, legalName: "Test\u0001 EV" }]) {
    const f = fixture({ rows: [{ ...candidateRow, party: badParty }] });
    const lookup = await f.post();
    assert.equal(lookup.status, 200);
    assert.ok(lookup.body.candidates[0].issues.length > 0);
    assert.equal((await f.post(ids)).status, 409);
  }
});

test("privacy partner trims legal identity, caps results and does not leak malformed backend responses", async () => {
  const f = fixture({ rows: Array.from({ length: 12 }, () => ({ ...candidateRow, party: { ...party, legalName: "  Minta EV  " } })) });
  const result = await f.post();
  assert.equal(result.body.candidates.length, 10);
  assert.equal(result.body.candidates[0].party.legalName, "Minta EV");
  for (const options of [{ rows: null }, { rows: [{}] }, { rpcError: { message: "database secret", hint: "secret" } }, { throwRpc: true }]) {
    const outcome = await fixture(options).post();
    assert.ok([500, 503].includes(outcome.status));
    assert.ok(!JSON.stringify(outcome.body).includes("secret"));
  }
});

test("privacy partner missing server settings is a controlled failure without exposing credentials", async () => {
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const f = fixture({ env: { [key]: "" } });
    const result = await f.post();
    assert.equal(result.status, 503);
    assert.equal(f.rpcs.length, 0);
  }
});
