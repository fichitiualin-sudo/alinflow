const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { harness } = require("./helpers.cjs");

const workspaceId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const email = "calendar-owner@example.test";
const appUrl = "https://app.example.test";
const scope = "https://www.googleapis.com/auth/calendar.events.owned";
const environment = () => ({
  GOOGLE_CALENDAR_CLIENT_ID: "client-fixture", GOOGLE_CALENDAR_CLIENT_SECRET: "secret-fixture",
  GOOGLE_CALENDAR_TOKEN_KEY: Buffer.alloc(32, 19).toString("base64"), GOOGLE_CALENDAR_APP_URL: appUrl,
  NEXT_PUBLIC_SUPABASE_URL: "https://database.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-fixture",
  SUPABASE_SERVICE_ROLE_KEY: "service-fixture", GOOGLE_CALENDAR_CRON_SECRET: "cron-fixture-with-more-than-32-characters",
});

function fixture(options = {}) {
  const queries = [], rpcs = [], googleCalls = [], syncCalls = [];
  const env = { ...environment(), ...options.env };
  let pending = null;
  const client = {
    auth: { getUser: async (token) => ({ data: { user: token === "user-token-fixture" && options.signedIn !== false ? { id: userId } : null }, error: null }) },
    from(table) {
      const operation = { table, method: "select", filters: {} };
      const query = {
        select(columns) { operation.columns = columns; return query; },
        eq(key, value) { operation.filters[key] = value; return query; },
        lt(key, value) { operation.lt = { [key]: value }; return query; },
        maybeSingle() { return query; },
        insert(value) { operation.method = "insert"; operation.value = value; return query; },
        update(value) { operation.method = "update"; operation.value = value; return query; },
        delete() { operation.method = "delete"; return query; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            queries.push(operation);
            if (table === "workspace_members") return { data: options.member === false ? null : { role: options.role || "owner" }, error: null };
            if (table === "workspaces") return { data: options.active === false ? null : { id: workspaceId }, error: null };
            if (table === "google_calendar_connections") return { data: options.connection || null, error: null };
            if (table === "google_calendar_oauth_states") {
              if (operation.method === "insert") pending = operation.value;
              return { data: null, error: null };
            }
            throw Error(`Unexpected database table: ${table}`);
          }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, args) {
      rpcs.push({ name, args });
      if (name === "consume_google_calendar_oauth_state") {
        const found = options.expired || !pending || pending.state_hash !== args.p_state_hash ? null : pending;
        pending = null;
        return { data: found ? [found] : [], error: null };
      }
      if (name === "complete_google_calendar_connection") return { data: options.completeRejected ? false : true, error: null };
      if (name === "google_calendar_sync_status") return { data: { pending_count: 2, managed_appointment_ids: ["managed-appointment"] }, error: null };
      throw Error(`Unexpected database RPC: ${name}`);
    },
  };
  const loader = harness({
    process: { env }, URLSearchParams, AbortSignal,
    fetch: async (url, init) => {
      googleCalls.push({ url, init });
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "access-token-fixture", refresh_token: "refresh-token-fixture", scope: `openid email ${scope}`, ...options.tokens }, { status: options.tokenStatus || 200 });
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") return Response.json({ sub: "subject-fixture", email, email_verified: true, ...options.identity });
      if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/")) return Response.json({ accessRole: "owner", ...options.calendar }, { status: options.calendarStatus || 200 });
      throw Error(`Unexpected Google request: ${url}`);
    },
  }, {
    "node:crypto": crypto,
    "@supabase/supabase-js": { createClient: () => client },
    "@/lib/alinflow/google-calendar-sync": { runGoogleCalendarSync: async (id) => { syncCalls.push(id); return { processed: 1, synced: 1, failed: 0 }; } },
  });
  const routes = Object.fromEntries(["connect", "callback", "status", "disconnect", "sync", "cron"].map((name) => [name, loader.load(`src/app/api/google-calendar/${name}/route.ts`)]));
  const auth = loader.load("src/lib/alinflow/google-calendar-auth.ts");
  const post = (path, body = { workspaceId, email }, headers = {}) => new Request(`${appUrl}/api/google-calendar/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer user-token-fixture", Origin: appUrl, ...headers }, body: JSON.stringify(body),
  });
  async function begin() {
    const response = await routes.connect.POST(post("connect"));
    assert.equal(response.status, 200);
    const destination = new URL((await response.json()).url);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const url = new URL(`${appUrl}/api/google-calendar/callback`);
    url.searchParams.set("state", destination.searchParams.get("state"));
    url.searchParams.set("code", "authorization-code-fixture");
    return { destination, cookie, url, response, pending: { ...pending } };
  }
  return { routes, auth, queries, rpcs, googleCalls, syncCalls, env, post, begin, options };
}

function outcome(response) {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  return new URL(response.headers.get("location")).searchParams.get("googleCalendar");
}

test("connect prepares owned-calendar consent with a browser-bound cookie and encrypted PKCE verifier", async () => {
  const f = fixture();
  const { destination, response, pending } = await f.begin();
  assert.equal(destination.origin, "https://accounts.google.com");
  assert.equal(destination.searchParams.get("scope"), `openid email ${scope}`);
  assert.equal(destination.searchParams.get("access_type"), "offline");
  assert.equal(destination.searchParams.get("prompt"), "consent");
  assert.equal(destination.searchParams.get("login_hint"), email);
  assert.equal(destination.searchParams.get("redirect_uri"), `${appUrl}/api/google-calendar/callback`);
  const verifier = f.auth.decryptCalendarToken(pending.code_verifier, pending.state_hash);
  assert.equal(destination.searchParams.get("code_challenge"), crypto.createHash("sha256").update(verifier).digest("base64url"));
  assert.equal(destination.searchParams.get("code_challenge_method"), "S256");
  assert.equal(pending.workspace_id, workspaceId);
  assert.equal(pending.user_id, userId);
  assert.equal(pending.expected_email, email);
  assert.ok(!JSON.stringify(pending).includes(verifier));
  assert.ok(!destination.href.includes(f.env.GOOGLE_CALENDAR_CLIENT_SECRET));
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=600"]) assert.ok(response.headers.get("set-cookie").includes(flag));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(f.googleCalls.length, 0);
});

test("connect refuses nonowners, foreign origins and replacing an existing calendar account before storing state", async () => {
  for (const [options, headers, expected] of [
    [{ role: "member" }, {}, 403],
    [{}, { Origin: "https://foreign.example.test" }, 403],
    [{ connection: { google_email: "different@example.test" } }, {}, 409],
  ]) {
    const f = fixture(options);
    const response = await f.routes.connect.POST(f.post("connect", { workspaceId, email }, headers));
    assert.equal(response.status, expected);
    assert.equal(f.queries.filter((query) => query.method === "insert").length, 0);
    assert.equal(f.googleCalls.length, 0);
  }
});

test("callback with an invalid browser cookie never consumes state or contacts Google", async () => {
  const f = fixture();
  const { url } = await f.begin();
  const response = await f.routes.callback.GET(new Request(url, { headers: { cookie: "invalid=cookie" } }));
  assert.equal(outcome(response), "expired");
  assert.equal(f.rpcs.length, 0);
  assert.equal(f.googleCalls.length, 0);
});

test("expired or already-consumed OAuth state cannot exchange an authorization code", async () => {
  const expired = fixture({ expired: true });
  const first = await expired.begin();
  assert.equal(outcome(await expired.routes.callback.GET(new Request(first.url, { headers: { cookie: first.cookie } }))), "expired");
  assert.equal(expired.googleCalls.length, 0);
  const replay = fixture();
  const second = await replay.begin();
  second.url.searchParams.set("error", "access_denied");
  const request = () => new Request(second.url, { headers: { cookie: second.cookie } });
  assert.equal(outcome(await replay.routes.callback.GET(request())), "denied");
  second.url.searchParams.delete("error");
  assert.equal(outcome(await replay.routes.callback.GET(request())), "expired");
  assert.equal(replay.googleCalls.length, 0);
});

test("membership is rechecked after Google consent before exchanging credentials", async () => {
  const f = fixture();
  const { url, cookie } = await f.begin();
  f.options.role = "member";
  assert.equal(outcome(await f.routes.callback.GET(new Request(url, { headers: { cookie } }))), "failed");
  assert.equal(f.googleCalls.length, 0);
});

for (const [label, identity] of [["different account", { email: "wrong@example.test" }], ["unverified account", { email_verified: false }]]) {
  test(`callback rejects a ${label} without storing a calendar connection`, async () => {
    const f = fixture({ identity });
    const { url, cookie } = await f.begin();
    assert.equal(outcome(await f.routes.callback.GET(new Request(url, { headers: { cookie } }))), "wrong_account");
    assert.equal(f.googleCalls.length, 2);
    assert.equal(f.rpcs.some((call) => call.name === "complete_google_calendar_connection"), false);
  });
}

for (const rejectedScope of ["openid email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"]) {
  test(`callback refuses a token that lacks owned-event permission: ${rejectedScope}`, async () => {
    const f = fixture({ tokens: { scope: rejectedScope } });
    const { url, cookie } = await f.begin();
    assert.equal(outcome(await f.routes.callback.GET(new Request(url, { headers: { cookie } }))), "failed");
    assert.equal(f.googleCalls.length, 1);
    assert.equal(f.rpcs.some((call) => call.name === "complete_google_calendar_connection"), false);
  });
}

for (const [label, options] of [["disabled Calendar API", { calendarStatus: 403 }], ["calendar without ownership", { calendar: { accessRole: "writer" } }]]) {
  test(`callback refuses ${label} before completing the connection`, async () => {
    const f = fixture(options);
    const { url, cookie } = await f.begin();
    assert.equal(outcome(await f.routes.callback.GET(new Request(url, { headers: { cookie } }))), "failed");
    assert.equal(f.googleCalls.length, 3);
    assert.equal(f.rpcs.some((call) => call.name === "complete_google_calendar_connection"), false);
  });
}

test("valid callback probes only calendar ownership and stores a workspace-bound encrypted credential", async () => {
  const f = fixture();
  const { url, cookie, pending } = await f.begin();
  const response = await f.routes.callback.GET(new Request(url, { headers: { cookie } }));
  assert.equal(outcome(response), "connected");
  const tokenRequest = f.googleCalls[0];
  assert.equal(tokenRequest.init.body.get("code_verifier"), f.auth.decryptCalendarToken(pending.code_verifier, pending.state_hash));
  assert.equal(tokenRequest.init.body.get("redirect_uri"), `${appUrl}/api/google-calendar/callback`);
  const probe = new URL(f.googleCalls[2].url);
  assert.equal(probe.searchParams.get("maxResults"), "1");
  assert.equal(probe.searchParams.get("fields"), "accessRole");
  assert.ok(probe.pathname.includes(encodeURIComponent(email)));
  const stored = f.rpcs.find((call) => call.name === "complete_google_calendar_connection").args;
  assert.equal(stored.p_workspace_id, workspaceId);
  assert.equal(stored.p_user_id, userId);
  assert.equal(stored.p_google_subject, "subject-fixture");
  assert.equal(stored.p_google_email, email);
  assert.equal(stored.p_calendar_id, email);
  assert.equal(f.auth.decryptCalendarToken(stored.p_refresh_token_encrypted, workspaceId), "refresh-token-fixture");
  assert.ok(!JSON.stringify(stored).includes("refresh-token-fixture"));
  assert.throws(() => f.auth.decryptCalendarToken(stored.p_refresh_token_encrypted, "different-workspace"));
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("location"), `${appUrl}/?googleCalendar=connected`);
});

test("status exposes sync information but never refresh tokens or service credentials", async () => {
  const f = fixture({ role: "member", connection: {
    status: "connected", google_email: email, sync_from: "2026-10-09T10:00:00Z",
    refresh_token_encrypted: "secret-encrypted-fixture", access_token: "secret-access-fixture",
  } });
  const response = await f.routes.status.GET(new Request(`${appUrl}/api/google-calendar/status?workspaceId=${workspaceId}`, { headers: { Authorization: "Bearer user-token-fixture" } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  assert.ok(!/secret|token|service-fixture/.test(text));
  const body = JSON.parse(text);
  assert.equal(body.canManage, false);
  assert.equal(body.pending, 2);
  assert.deepEqual(body.managedAppointmentIds, ["managed-appointment"]);
  const query = f.queries.find((item) => item.table === "google_calendar_connections");
  assert.equal(query.filters.workspace_id, workspaceId);
  assert.equal(query.columns, "status,google_email,sync_from,last_error");
});

test("disconnect requires management permission and only pauses its own workspace connection", async () => {
  const denied = fixture({ role: "member" });
  assert.equal((await denied.routes.disconnect.POST(denied.post("disconnect"))).status, 403);
  assert.equal(denied.queries.some((query) => query.method === "update"), false);
  const f = fixture();
  assert.equal((await f.routes.disconnect.POST(f.post("disconnect"))).status, 200);
  const writes = f.queries.filter((query) => query.method !== "select");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, "google_calendar_connections");
  assert.equal(writes[0].filters.workspace_id, workspaceId);
  assert.equal(writes[0].value.status, "paused");
  assert.deepEqual(Object.keys(writes[0].value).sort(), ["status", "updated_at"]);
  assert.equal(f.googleCalls.length, 0);
});

test("unauthorized sync and cron requests cannot invoke the calendar worker", async () => {
  const f = fixture();
  for (const authorization of ["", "Bearer wrong-token"]) {
    assert.equal((await f.routes.sync.POST(f.post("sync", { workspaceId }, { Authorization: authorization }))).status, 401);
    assert.equal((await f.routes.cron.POST(f.post("cron", {}, { Authorization: authorization }))).status, 401);
  }
  assert.equal(f.syncCalls.length, 0);
  assert.equal((await f.routes.sync.POST(f.post("sync", { workspaceId }))).status, 200);
  assert.deepEqual(f.syncCalls, [workspaceId]);
  assert.equal((await f.routes.cron.POST(f.post("cron", {}, { Authorization: `Bearer ${f.env.GOOGLE_CALENDAR_CRON_SECRET}` }))).status, 200);
  assert.deepEqual(f.syncCalls, [workspaceId, undefined]);
});
