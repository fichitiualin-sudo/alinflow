const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { harness } = require("./helpers.cjs");
const workspaceId = "10000000-0000-4000-8000-000000000001", userId = "20000000-0000-4000-8000-000000000001";
const appUrl = "https://app.example.test", email = "contacts-owner@example.test";
function fixture(options = {}) {
  const env = { GOOGLE_CONTACTS_ENABLED: "true", GOOGLE_CALENDAR_CLIENT_ID: "fixture-client", GOOGLE_CALENDAR_CLIENT_SECRET: "fixture-secret",
    GOOGLE_CALENDAR_TOKEN_KEY: Buffer.alloc(32, 21).toString("base64"), GOOGLE_CALENDAR_APP_URL: appUrl,
    NEXT_PUBLIC_SUPABASE_URL: "https://database.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", ...options.env };
  const queries = [], rpcs = [], calls = []; let pending;
  const client = { auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) }, from(table) {
    const op = { table, method: "select", filters: {} }, q = {
      select(columns) { op.columns = columns; return q; }, eq(k,v) { op.filters[k] = v; return q; }, lt() { return q; }, in() { return q; }, maybeSingle() { return q; }, order(column) { op.order = column; return q; }, range(from,to) { op.range = [from,to]; return q; },
      insert(value) { op.method = "insert"; op.value = value; return q; }, delete() { op.method = "delete"; return q; }, update(value) { op.method = "update"; op.value = value; return q; },
      then(resolve,reject) { return Promise.resolve().then(() => {
        queries.push(op);
        if (table === "workspace_members") return { data: { role: options.role || "owner" }, error: null };
        if (table === "workspaces") return { data: { id: workspaceId }, error: null };
        if (table === "google_contacts_connections") return { data: options.connection || null, error: null };
        if (table === "google_contacts_oauth_states") { if (op.method === "insert") pending = op.value; return { data: null, error: null }; }
        if (table === "google_contacts_link_members") return { data: options.members || [], error: null };
        if (table === "google_contacts_links") return { data: null, count: 2, error: null };
        throw Error("Unexpected table " + table);
      }).then(resolve,reject); },
    }; return q;
  }, async rpc(name,args) {
    rpcs.push({ name,args });
    if (name === "consume_google_contacts_oauth_state") { const found = pending?.state_hash === args.p_state_hash ? pending : null; pending = null; return { data: found ? [found] : [], error: null }; }
    if (name === "complete_google_contacts_connection") return { data: !options.rejectCompletion, error: null };
    throw Error("Unexpected RPC " + name);
  } };
  const loader = harness({ process: { env }, URLSearchParams, AbortSignal, fetch: async (url, init) => {
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fixture-access", refresh_token: "fixture-refresh", scope: "openid email https://www.googleapis.com/auth/contacts", ...options.tokens });
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") return Response.json({ sub: "fixture-subject", email, email_verified: true, ...options.identity });
    throw Error("Unexpected outbound request " + url);
  } }, { "node:crypto": crypto, "@supabase/supabase-js": { createClient: () => client } });
  const auth = loader.load("src/lib/alinflow/google-contacts-auth.ts"), calendar = loader.load("src/lib/alinflow/google-calendar-auth.ts");
  const routes = Object.fromEntries(["connect","callback","status","disconnect"].map(name => [name,loader.load(`src/app/api/google-contacts/${name}/route.ts`)]));
  const post = (name, body = { workspaceId,email }, origin = appUrl) => new Request(`${appUrl}/api/google-contacts/${name}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer fixture-user", Origin: origin }, body: JSON.stringify(body) });
  const begin = async () => {
    const response = await routes.connect.POST(post("connect")); assert.equal(response.status,200);
    const url = new URL((await response.json()).url), cookie = response.headers.get("set-cookie").split(";")[0];
    const callback = new URL(`${appUrl}/api/google-contacts/callback`); callback.searchParams.set("state",url.searchParams.get("state")); callback.searchParams.set("code","fixture-code");
    return { url, cookie, callback, pending: { ...pending } };
  };
  return { auth,calendar,routes,post,begin,queries,rpcs,calls,options };
}
const outcome = response => new URL(response.headers.get("location")).searchParams.get("googleContacts");
test("Contacts tokens and cookies cannot be substituted for Calendar credentials", () => {
  const f = fixture(), encrypted = f.auth.encryptContactsToken("fixture-refresh",workspaceId);
  assert.equal(f.auth.decryptContactsToken(encrypted,workspaceId),"fixture-refresh");
  assert.throws(() => f.calendar.decryptCalendarToken(encrypted,workspaceId));
  assert.throws(() => f.auth.decryptContactsToken(f.calendar.encryptCalendarToken("fixture",workspaceId),workspaceId));
  assert.throws(() => f.auth.decryptContactsToken(encrypted,userId));
  const state = crypto.randomBytes(32).toString("base64url"), hash = f.auth.contactsHash(state);
  assert.equal(f.auth.contactsStateMatches(state, f.calendar.calendarOAuthCookie(hash)),false);
  assert.equal(f.auth.contactsStateMatches(state, f.auth.contactsOAuthCookie(hash)),true);
  assert.equal(fixture({ env: { GOOGLE_CONTACTS_ENABLED: "false" } }).auth.googleContactsConfigured(),false);
});
test("Contacts OAuth explicitly requests Contacts scope with PKCE and no calendar changes", async () => {
  const f = fixture(), flow = await f.begin();
  assert.equal(flow.url.searchParams.get("scope"),"openid email https://www.googleapis.com/auth/contacts");
  assert.equal(flow.url.searchParams.get("redirect_uri"), `${appUrl}/api/google-contacts/callback`);
  const verifier = f.auth.decryptContactsToken(flow.pending.code_verifier,flow.pending.state_hash);
  assert.equal(flow.url.searchParams.get("code_challenge"),crypto.createHash("sha256").update(verifier).digest("base64url"));
  const result = await f.routes.callback.GET(new Request(flow.callback,{ headers: { cookie: flow.cookie } }));
  assert.equal(outcome(result),"connected");
  assert.equal(new URL(result.headers.get("location")).searchParams.get("googleContactsWorkspace"),workspaceId);
  assert.equal(f.calls.length,2); // Token + identity only. Connecting does not read or write contacts.
  const stored = f.rpcs.find(r => r.name === "complete_google_contacts_connection").args;
  assert.equal(f.auth.decryptContactsToken(stored.p_refresh_token_encrypted,workspaceId),"fixture-refresh");
  assert.equal(f.queries.some(q => q.table.startsWith("google_calendar")),false);
  assert.equal(outcome(await f.routes.callback.GET(new Request(flow.callback,{ headers: { cookie: flow.cookie } }))),"expired");
});
test("Contact management rejects non-admins, changed Google identity, missing scope, foreign origin and revoked membership", async () => {
  for (const name of ["status","connect","disconnect"]) {
    const f = fixture({ role: "member" }); assert.equal((await f.routes[name].POST(f.post(name))).status,403);
  }
  const foreign = fixture(); assert.equal((await foreign.routes.connect.POST(foreign.post("connect",{workspaceId,email},"https://foreign.example"))).status,403);
  for (const [options,expected] of [[{ identity: { email: "other@example.test" } },"wrong_account"],[{ identity: { email_verified:false } },"wrong_account"],[{ tokens: { scope:"openid email https://www.googleapis.com/auth/calendar.events.owned" } },"permissions_missing"]]) {
    const f = fixture(options), flow = await f.begin();
    assert.equal(outcome(await f.routes.callback.GET(new Request(flow.callback,{ headers: { cookie: flow.cookie } }))),expected);
    assert.equal(f.rpcs.some(r => r.name === "complete_google_contacts_connection"),false);
  }
  const f = fixture(), flow = await f.begin(); f.options.role = "member";
  assert.equal(outcome(await f.routes.callback.GET(new Request(flow.callback,{ headers: { cookie: flow.cookie } }))),"failed"); assert.equal(f.calls.length,0);
});
test("status omits secrets; pause keeps mappings and does not revoke the Calendar grant", async () => {
  const f = fixture({ connection: { status:"active", google_email:email, last_synced_at:null, last_error:null, refresh_token_encrypted:"sensitive-fixture" },
    members: [{ customer_id:"member-one",anchor_customer_id:"member-one" }, { customer_id:"member-two",anchor_customer_id:"member-one" }] });
  const response = await f.routes.status.POST(f.post("status")); const body = await response.json();
  assert.equal(response.status,200); assert.equal(body.email,email); assert.equal(body.linkedCount,2); assert.equal(body.coveredCustomerCount,3); assert.equal(JSON.stringify(body).includes("sensitive"),false);
  const membershipRead = f.queries.find(q => q.table === "google_contacts_link_members");
  assert.equal(membershipRead.filters.workspace_id,workspaceId); assert.equal(membershipRead.order,"customer_id");
  assert.deepEqual(membershipRead.range,[0,999]);
  assert.equal(JSON.stringify(body).includes("member-one"),false);
  await f.routes.disconnect.POST(f.post("disconnect"));
  const writes = f.queries.filter(q => q.method !== "select"); assert.equal(writes.length,1); assert.equal(writes[0].value.status,"paused");
  assert.equal(writes[0].filters.workspace_id,workspaceId); assert.equal(f.calls.length,0);
});
