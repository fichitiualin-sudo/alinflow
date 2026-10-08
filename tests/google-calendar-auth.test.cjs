const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { harness, database } = require("./helpers.cjs");

const workspace = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const environment = () => ({ GOOGLE_CALENDAR_CLIENT_ID: "client.example", GOOGLE_CALENDAR_CLIENT_SECRET: "synthetic-client-secret",
  GOOGLE_CALENDAR_TOKEN_KEY: Buffer.alloc(32, 17).toString("base64"), GOOGLE_CALENDAR_APP_URL: "https://app.example",
  NEXT_PUBLIC_SUPABASE_URL: "https://database.example", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key", GOOGLE_CALENDAR_CRON_SECRET: "synthetic-cron-secret-32-characters-minimum" });

function fixture({ env = environment(), fetch, role = "owner", member = true, active = true, signedIn = true } = {}) {
  const queries = [];
  const client = database(op => {
    queries.push(op);
    return { data: op.table === "workspace_members" ? (member ? { role } : null) : (active ? { id: workspace } : null), error: null };
  });
  client.auth = { getUser: async () => ({ data: { user: signedIn ? { id: userId } : null }, error: null }) };
  const loader = harness({ process: { env }, URLSearchParams, AbortSignal, ...(fetch ? { fetch } : {}) }, {
    "node:crypto": crypto, "@supabase/supabase-js": { createClient: () => client },
  });
  return { api: loader.load("src/lib/alinflow/google-calendar-auth.ts"), queries, env };
}

test("calendar setup refuses incomplete configuration and noncanonical callback origins", () => {
  for (const patch of [{ GOOGLE_CALENDAR_CLIENT_SECRET: "" }, { GOOGLE_CALENDAR_TOKEN_KEY: "short" },
    { GOOGLE_CALENDAR_APP_URL: "http://app.example" }, { GOOGLE_CALENDAR_APP_URL: "https://evil.example/path" },
    { GOOGLE_CALENDAR_APP_URL: "https://user:pass@app.example" }, { SUPABASE_SERVICE_ROLE_KEY: "" }]) {
    assert.equal(fixture({ env: { ...environment(), ...patch } }).api.googleCalendarConfigured(), false);
  }
  assert.equal(fixture().api.googleCalendarConfigured(), true);
});

test("calendar refresh credentials are authenticated, randomized and bound to their workspace", () => {
  const { api } = fixture();
  const first = api.encryptCalendarToken("synthetic-refresh-token", workspace);
  const second = api.encryptCalendarToken("synthetic-refresh-token", workspace);
  assert.notEqual(first, second);
  assert.ok(!first.includes("synthetic-refresh-token"));
  assert.equal(api.decryptCalendarToken(first, workspace), "synthetic-refresh-token");
  assert.throws(() => api.decryptCalendarToken(first, "another-workspace"));
  const parts = first.split("."); parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  assert.throws(() => api.decryptCalendarToken(parts.join("."), workspace));
  assert.throws(() => api.decryptCalendarToken(first + ".extra", workspace));
});

test("OAuth state requires the browser-bound hash cookie and rejects malformed or unicode values", () => {
  const { api } = fixture();
  const state = crypto.randomBytes(32).toString("base64url");
  const hash = api.calendarHash(state);
  assert.equal(api.calendarStateMatches(state, `${api.CALENDAR_OAUTH_COOKIE}=${hash}`), true);
  for (const cookie of [null, `${api.CALENDAR_OAUTH_COOKIE}=${"0".repeat(64)}`, `${api.CALENDAR_OAUTH_COOKIE}=${"é".repeat(64)}`]) {
    assert.equal(api.calendarStateMatches(state, cookie), false);
  }
  assert.equal(api.calendarStateMatches("bad", `${api.CALENDAR_OAUTH_COOKIE}=${hash}`), false);
  const cookie = api.calendarOAuthCookie(hash);
  for (const expected of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=600"]) assert.ok(cookie.includes(expected));
});

test("calendar status/sync require a real user and active workspace membership; management also requires owner/admin", async () => {
  const request = new Request("https://app.example/api", { headers: { Authorization: "Bearer synthetic-user-token" } });
  const f = fixture();
  const scope = await f.api.authorizeCalendarWorkspace(request, workspace, true);
  assert.equal(scope.workspaceId, workspace); assert.equal(scope.userId, userId); assert.equal(scope.canManage, true);
  assert.ok(f.queries.every(q => q.filters.workspace_id === workspace || q.filters.id === workspace));
  await assert.rejects(() => fixture().api.authorizeCalendarWorkspace(new Request("https://app.example"), workspace), /jelentkezz/);
  await assert.rejects(() => fixture({ signedIn: false }).api.authorizeCalendarWorkspace(request, workspace), /lejárt/);
  await assert.rejects(() => fixture({ member: false }).api.authorizeCalendarWorkspace(request, workspace), /hozzáférés/);
  await assert.rejects(() => fixture({ active: false }).api.authorizeCalendarWorkspace(request, workspace), /hozzáférés/);
  await assert.rejects(() => fixture({ role: "member" }).api.authorizeCalendarWorkspace(request, workspace, true), /tulajdonosa/);
  assert.equal((await fixture({ role: "member" }).api.authorizeCalendarWorkspace(request, workspace)).canManage, false);
});

test("calendar mutation origin and cron authorization cannot be supplied by another origin or guessed token", () => {
  const { api, env } = fixture();
  assert.doesNotThrow(() => api.assertCalendarOrigin(new Request("https://app.example", { headers: { Origin: "https://app.example" } })));
  assert.throws(() => api.assertCalendarOrigin(new Request("https://app.example", { headers: { Origin: "https://elsewhere.example" } })));
  assert.equal(api.calendarCronAuthorized(new Request("https://app.example", { headers: { Authorization: `Bearer ${env.GOOGLE_CALENDAR_CRON_SECRET}` } })), true);
  assert.equal(api.calendarCronAuthorized(new Request("https://app.example")), false);
  assert.equal(api.calendarCronAuthorized(new Request("https://app.example", { headers: { Authorization: "Bearer wrong" } })), false);
});

test("refresh grants go only to Google and reuse a short-lived access token without exposing credentials", async () => {
  const calls = [];
  const { api } = fixture({ fetch: async (url, options) => { calls.push({ url, options }); return Response.json({ access_token: "access", expires_in: 3600 }); } });
  const connection = { workspace_id: workspace, refresh_token_encrypted: api.encryptCalendarToken("refresh", workspace) };
  assert.equal(await api.calendarAccessToken(connection), "access");
  assert.equal(await api.calendarAccessToken(connection), "access");
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(calls[0].options.body.get("refresh_token"), "refresh");
  assert.equal(calls[0].options.body.get("grant_type"), "refresh_token");
});

test("revoked Google grants require reconnect and upstream secrets are never included in error responses", async () => {
  const { api } = fixture({ fetch: async () => Response.json({ error: "invalid_grant", error_description: "PRIVATE TOKEN" }, { status: 400 }) });
  const connection = { workspace_id: workspace, refresh_token_encrypted: api.encryptCalendarToken("refresh", workspace) };
  await assert.rejects(() => api.calendarAccessToken(connection), error => error instanceof api.GoogleCalendarAuthError && !error.message.includes("PRIVATE"));
  const response = api.calendarApiError(new Error("PRIVATE TOKEN"));
  assert.equal(response.status, 500); assert.ok(!(await response.text()).includes("PRIVATE"));
});

test("calendar API rejects oversized and nonobject JSON bodies", async () => {
  const { api } = fixture();
  const request = body => new Request("https://app.example/api", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  assert.equal((await api.readCalendarBody(request('{"workspaceId":"demo"}'))).workspaceId, "demo");
  for (const body of ["[]", "null", "broken"]) await assert.rejects(() => api.readCalendarBody(request(body)), /Hibás/);
  await assert.rejects(() => api.readCalendarBody(request(JSON.stringify({ large: "x".repeat(5000) }))), /túl nagy/);
});
