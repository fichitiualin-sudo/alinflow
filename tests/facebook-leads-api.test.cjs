const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { harness, database } = require("./helpers.cjs");
const workspaceId = "10000000-0000-4000-8000-000000000001";
const secondWorkspaceId = "20000000-0000-4000-8000-000000000001";
const config = { workspaceId, pageId: "111", formIds: ["222", "223"], adClimateMap: { "333": "Polar Prime" } };
function graphLead(id = "444", form_id = "222") {
  return { id, form_id, ad_id: "333", created_time: "2026-10-05T10:25:00+0200", field_data: [
    { name: "full_name", values: ["Teszt Éva"] }, { name: "phone_number", values: ["+36301234567"] },
    { name: "település", values: ["Tápiószele"] }] };
}
function event(leads = ["444"], pageId = "111", formId = "222") {
  return { object: "page", entry: [{ id: pageId, changes: leads.map(id => ({ field: "leadgen", value: { page_id: pageId, form_id: formId, leadgen_id: id } })) }] };
}
function setup(options = {}) {
  const env = { META_APP_SECRET: "test-app-secret", META_WEBHOOK_VERIFY_TOKEN: "test-verify-token", META_PAGE_ACCESS_TOKEN: "test-page-token",
    META_LEADS_CONFIG: JSON.stringify(config), SUPABASE_SERVICE_ROLE_KEY: "test-service-role", NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-public-key", ...options.env };
  const requests = [], commits = [], queries = [], saved = new Map();
  const db = database(op => {
    queries.push(op);
    if (op.table === "workspace_members") return { data: options.denied ? null : { workspace_id: workspaceId } };
    throw Error("Unexpected authorized query");
  });
  db.auth = { getUser: async () => options.expired ? { data: {}, error: Error("expired") } : { data: { user: { id: "user" } } } };
  const service = {
    from(table) {
      const filters = {};
      let ids;
      const query = { select: () => query, eq: (key, value) => { filters[key] = value; return query; },
        in: (key, value) => { assert.equal(key, "lead_id"); ids = value; return query; },
        abortSignal: () => query, then: resolve => resolve({ data: ids.filter(id => saved.has(id)).map(lead_id => ({ lead_id })) }) };
      queries.push({ table, filters });
      return query;
    },
    rpc(name, args) {
      assert.equal(name, "import_facebook_lead");
      const query = { abortSignal: () => query, then: async (resolve, reject) => {
        try {
          if (options.commit) await options.commit(args);
          const duplicate = saved.has(args.p_lead_id);
          const data = { status: options.status || "created", duplicate };
          saved.set(args.p_lead_id, data); commits.push(args); return resolve({ data });
        } catch (e) { return reject(e); }
      } };
      return query;
    },
  };
  const h = harness({ process: { env }, AbortSignal: options.AbortSignal || AbortSignal, fetch: async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, init });
    assert.equal(url.origin, "https://graph.facebook.com");
    assert.match(url.pathname, /^\/v26\.0\//);
    assert.equal(init.headers.Authorization, "Bearer test-page-token");
    assert.equal(url.searchParams.has("access_token"), false);
    assert.equal(init.redirect, "error");
    if (options.graph) return options.graph(url, init);
    if (url.pathname.endsWith("/leads")) return Response.json({ data: [graphLead("444", url.pathname.split("/")[2])] });
    if (url.pathname.endsWith("/222") || url.pathname.endsWith("/223")) return Response.json({ id: url.pathname.split("/").pop(), page: { id: "111" } });
    return Response.json(graphLead(url.pathname.split("/").pop()));
  } }, { "node:crypto": crypto, "@supabase/supabase-js": { createClient: (_url, key) => key === "test-service-role" ? service : db } });
  const route = name => h.load(`src/app/api/facebook-leads/${name}/route.ts`);
  const request = (body, { signature = true, token = "user-token", ...overrides } = {}) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return new Request("https://test.invalid/api", { method: "POST", body: raw, headers: {
      "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(signature ? { "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", env.META_APP_SECRET || "").update(raw).digest("hex") } : {}),
      ...overrides,
    } });
  };
  return { env, route, request, requests, commits, queries, saved };
}

test("webhook handshake echoes plain challenge only for the configured verify token", async () => {
  const f = setup();
  const good = f.route("webhook").GET(new Request("https://test.invalid?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=123"));
  assert.equal(good.status, 200); assert.equal(await good.text(), "123");
  const bad = f.route("webhook").GET(new Request("https://test.invalid?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123"));
  assert.equal(bad.status, 403); assert.equal(f.requests.length, 0);
});

test("missing, changed, or malformed signature cannot fetch or write leads", async () => {
  for (const header of [null, "sha256=bad", "sha256=" + "0".repeat(64)]) {
    const f = setup();
    const request = f.request(event(), { signature: false });
    if (header) request.headers.set("x-hub-signature-256", header);
    assert.equal((await f.route("webhook").POST(request)).status, 403);
    assert.equal(f.requests.length, 0); assert.equal(f.commits.length, 0);
  }
});

test("a signed webhook imports canonical Graph data and exact climate only after form verification", async () => {
  const f = setup();
  const response = await f.route("webhook").POST(f.request(event()));
  assert.equal(response.status, 200); assert.equal(f.commits.length, 1);
  const args = f.commits[0];
  assert.equal(args.p_workspace_id, workspaceId); assert.equal(args.p_page_id, "111"); assert.equal(args.p_lead_id, "444");
  assert.equal(args.p_payload.city, "Tápiószele"); assert.equal(args.p_payload.climate_name, "Polar Prime");
  assert.deepEqual(f.requests.map(x => x.url.pathname), ["/v26.0/444", "/v26.0/222"]);
  assert.equal((await f.route("webhook").POST(f.request(event()))).status, 200);
  assert.equal(f.requests.length, 2); assert.equal(f.commits.length, 1);
});

test("foreign pages and unconfigured forms are acknowledged without network or database access", async () => {
  for (const body of [event(["444"], "999"), event(["444"], "111", "999")]) {
    const f = setup();
    assert.equal((await f.route("webhook").POST(f.request(body))).status, 200);
    assert.equal(f.requests.length, 0); assert.equal(f.queries.length, 0); assert.equal(f.commits.length, 0);
  }
});

test("cross-page form and changed canonical form prevent commits", async () => {
  for (const foreignLead of [false, true]) {
    const f = setup({ graph: async url => url.pathname.endsWith("/444")
      ? Response.json({ ...graphLead(), ...(foreignLead ? { form_id: "223" } : {}) })
      : Response.json({ id: "222", page: { id: "999" } }) });
    assert.equal((await f.route("webhook").POST(f.request(event()))).status, 502);
    assert.equal(f.commits.length, 0);
  }
});

test("webhook ACK waits for durable import and partial retries skip already committed leads", async () => {
  let fail = true;
  const f = setup({ commit: async args => { if (args.p_lead_id === "445" && fail) throw Error("secret raw database error"); } });
  const first = await f.route("webhook").POST(f.request(event(["444", "445"])));
  assert.equal(first.status, 500); assert.doesNotMatch(await first.text(), /secret raw/);
  assert.equal(f.commits.length, 1);
  fail = false;
  assert.equal((await f.route("webhook").POST(f.request(event(["444", "445"])))).status, 200);
  assert.equal(f.commits.length, 2);
  assert.equal(f.requests.filter(x => x.url.pathname === "/v26.0/444").length, 1);
});

test("webhook success is not returned while the database commit is pending", async () => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { started = resolve; });
  const f = setup({ commit: async () => { started(); await gate; } });
  let finished = false;
  const response = f.route("webhook").POST(f.request(event())).then(value => { finished = true; return value; });
  await reached;
  assert.equal(finished, false); assert.equal(f.commits.length, 0);
  release(); assert.equal((await response).status, 200); assert.equal(f.commits.length, 1);
});

test("bad JSON, content type, and oversized bodies reject before Graph requests", async () => {
  for (const [body, options, status] of [["not json", {}, 400], [event(), { "content-type": "text/plain" }, 415], ["x".repeat(262145), {}, 413]]) {
    const f = setup(); const response = await f.route("webhook").POST(f.request(body, options));
    assert.equal(response.status, status); assert.equal(f.requests.length, 0); assert.equal(f.commits.length, 0);
  }
});

test("Meta authentication failures are retryable and never echo provider/token details", async () => {
  const f = setup({ graph: async () => Response.json({ error: { message: "test-page-token" } }, { status: 401 }) });
  const response = await f.route("webhook").POST(f.request(event()));
  assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /test-page-token/); assert.equal(f.commits.length, 0);
});

test("Graph timeout and malformed lead data stop import with a retryable response", async () => {
  for (const graph of [async (_url, init) => { assert.ok(init.signal instanceof AbortSignal); throw new DOMException("timeout", "TimeoutError"); },
    async () => Response.json({ ...graphLead(), field_data: "invalid" })]) {
    const f = setup({ graph });
    assert.equal((await f.route("webhook").POST(f.request(event()))).status, 502);
    assert.equal(f.commits.length, 0);
  }
});

test("oversized Graph responses cannot be imported even without a Content-Length header", async () => {
  for (const declared of [false, true]) {
    const f = setup({ graph: async () => new Response(declared ? "{}" : "x".repeat(2 * 1024 * 1024 + 1),
      { headers: declared ? { "content-length": String(2 * 1024 * 1024 + 1) } : {} }) });
    assert.equal((await f.route("webhook").POST(f.request(event()))).status, 502);
    assert.equal(f.commits.length, 0);
  }
});

test("Graph response body reading obeys the fetch deadline and cancels a stalled stream", async () => {
  let signalNumber = 0, abortGraph, graphStarted;
  const reached = new Promise(resolve => { graphStarted = resolve; });
  const bodySignal = new AbortController().signal;
  const graphController = new AbortController();
  let cancelled = false;
  const f = setup({ AbortSignal: { timeout: () => {
    signalNumber++;
    // Request body, prequery, then first Graph fetch.
    if (signalNumber === 3) { abortGraph = () => graphController.abort(); return graphController.signal; }
    return bodySignal;
  } }, graph: async () => {
    graphStarted(); return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  } });
  const request = f.route("webhook").POST(f.request(event()));
  await reached; abortGraph();
  assert.equal((await request).status, 502); assert.equal(cancelled, true); assert.equal(f.commits.length, 0);
});

test("slow request bodies are cancelled with no Graph or database access", async () => {
  let expire;
  const controller = new AbortController();
  const f = setup({ AbortSignal: { timeout: () => { expire = () => controller.abort(); return controller.signal; } } });
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const request = new Request("https://test.invalid/api", { method: "POST", body: stream, duplex: "half", headers: { "content-type": "application/json" } });
  const response = f.route("webhook").POST(request);
  expire();
  assert.equal((await response).status, 408); assert.equal(cancelled, true);
  assert.equal(f.requests.length, 0); assert.equal(f.queries.length, 0);
});

for (const name of ["status", "sync"]) test(`${name} requires authentication and active workspace membership`, async () => {
  for (const options of [{ noToken: true }, { expired: true }, { denied: true }]) {
    const f = setup(options);
    const response = await f.route(name).POST(f.request({ workspaceId }, { token: options.noToken ? "" : "user-token" }));
    assert.equal(response.status, options.denied ? 403 : 401); assert.equal(f.requests.length, 0); assert.equal(f.commits.length, 0);
  }
});

test("status exposes only readiness and climate names, including missing and mismatched configuration", async () => {
  const f = setup(); const response = await f.route("status").POST(f.request({ workspaceId }));
  const data = await response.json(); assert.equal(data.ready, true); assert.equal(data.configured, true);
  assert.deepEqual(data.climateNames, ["Polar Prime"]); assert.doesNotMatch(JSON.stringify(data), /test-app-secret|test-page-token|test-service-role|test-verify-token/);
  f.env.META_PAGE_ACCESS_TOKEN = "";
  assert.equal((await (await f.route("status").POST(f.request({ workspaceId }))).json()).ready, false);
  const other = await (await f.route("status").POST(f.request({ workspaceId: secondWorkspaceId }))).json();
  assert.equal(other.configured, false); assert.deepEqual(other.climateNames, []); assert.equal(f.requests.length, 0);
});

test("sync counts outcomes and performs bounded page import", async () => {
  const f = setup({ status: "matched" });
  const response = await f.route("sync").POST(f.request({ workspaceId }));
  assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.matched, 1); assert.equal(result.imported, 0);
  assert.equal(result.nextFormId, "223"); assert.equal(result.nextCursor, null); assert.equal(result.hasMore, true);
  assert.equal(f.requests[1].url.searchParams.get("limit"), "20");
  const repeated = await (await f.route("sync").POST(f.request({ workspaceId }))).json();
  assert.equal(repeated.duplicates, 1); assert.equal(repeated.matched, 0);
  assert.equal(f.commits.length, 1);
});

test("a partial sync retry skips committed rows and progresses to the next form", async () => {
  let fail = true;
  const f = setup({ commit: async args => { if (fail && args.p_lead_id === "445") throw Error("retry"); },
    graph: async url => url.pathname.endsWith("/leads") ? Response.json({ data: [graphLead("444"), graphLead("445")] }) : Response.json({ id: "222", page_id: "111" }) });
  assert.equal((await f.route("sync").POST(f.request({ workspaceId }))).status, 500);
  assert.equal(f.commits.length, 1);
  fail = false;
  const response = await (await f.route("sync").POST(f.request({ workspaceId }))).json();
  assert.equal(response.duplicates, 1); assert.equal(response.imported, 1); assert.equal(response.nextFormId, "223");
  assert.equal(f.commits.length, 2);
});

test("sync signed cursors stay bound to form/page/workspace and never follow paging.next", async () => {
  const f = setup({ graph: async url => {
    const form = url.pathname.split("/")[2];
    if (!url.pathname.endsWith("/leads")) return Response.json({ id: form, page_id: "111" });
    return Response.json({ data: [graphLead(url.searchParams.has("after") ? "445" : "444", form)],
      ...(!url.searchParams.has("after") ? { paging: { next: "https://attacker.invalid/?access_token=secret", cursors: { after: "cursor-two" } } } : {}) });
  } });
  const first = await (await f.route("sync").POST(f.request({ workspaceId }))).json();
  assert.equal(first.nextFormId, "222"); assert.ok(first.nextCursor);
  const before = f.requests.length;
  assert.equal((await f.route("sync").POST(f.request({ workspaceId, formId: "223", cursor: first.nextCursor }))).status, 400);
  assert.equal(f.requests.length, before);
  assert.equal((await f.route("sync").POST(f.request({ workspaceId, cursor: first.nextCursor + "x" }))).status, 400);
  const second = await (await f.route("sync").POST(f.request({ workspaceId, formId: first.nextFormId, cursor: first.nextCursor }))).json();
  assert.equal(second.nextFormId, "223"); assert.equal(second.nextCursor, null);
  assert.equal(f.requests.at(-1).url.searchParams.get("after"), "cursor-two");
  const third = await (await f.route("sync").POST(f.request({ workspaceId, formId: "223" }))).json();
  const fourth = await (await f.route("sync").POST(f.request({ workspaceId, formId: third.nextFormId, cursor: third.nextCursor }))).json();
  assert.equal(fourth.hasMore, false); assert.equal(fourth.nextFormId, null); assert.equal(fourth.nextCursor, null);
});

test("sync rejects another workspace or unconfigured form before Graph or service role access", async () => {
  for (const body of [{ workspaceId: secondWorkspaceId }, { workspaceId, formId: "999" }]) {
    const f = setup(); const response = await f.route("sync").POST(f.request(body));
    assert.ok(response.status >= 400); assert.equal(f.requests.length, 0); assert.equal(f.commits.length, 0);
  }
});

test("sync rejects invalid pagination and mixed-form pages before any commit", async () => {
  for (const page of [{ data: [graphLead()], paging: { next: "https://graph.facebook.com/next" } },
    { data: [graphLead("444", "223")] }, { data: Array.from({ length: 21 }, (_, i) => graphLead(String(i))) }]) {
    const f = setup({ graph: async url => url.pathname.endsWith("/leads") ? Response.json(page) : Response.json({ id: "222", page_id: "111" }) });
    assert.equal((await f.route("sync").POST(f.request({ workspaceId }))).status, 502);
    assert.equal(f.commits.length, 0);
  }
});
