const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const routes = ["quote", "appointment", "work-report"];

function fixture(reply) {
  const requests = [];
  const timeouts = [];
  const externals = {
    "@supabase/supabase-js": { createClient() { throw Error("Unexpected database access"); } },
    "@/lib/alinflow/document-pdf-data": { async loadSavedPdfBundle() {
      return { includeWorkReport: true, report: { id: "saved-report", appointment_type: "installation" }, declarations: [] };
    } },
    "@/lib/alinflow/document-pdf-render": { async createSavedPdfAttachments() {
      return [{ filename: "test.pdf", content: "synthetic-pdf", content_type: "application/pdf" }];
    } },
  };
  const h = harness({
    process: { env: { RESEND_API_KEY: "synthetic-provider-key" } },
    AbortSignal: { timeout(ms) { timeouts.push(ms); return "synthetic-timeout-signal"; } },
    fetch: async (url, options) => { requests.push({ url, options }); return reply(); },
  }, externals);
  const auth = h.load("src/lib/alinflow/server-auth.ts");
  externals["@/lib/alinflow/server-auth"] = {
    ...auth,
    async authorizeCustomerRequest(_request, body) {
      body.customer = { ...body.customer, id: "saved-customer", email: "saved@example.invalid" };
      return { client: {}, workspaceId: "workspace", appointment: { id: "appointment" } };
    },
  };
  const post = kind => h.load(`src/app/api/send-${kind}/route.ts`).POST(new Request("https://test.invalid/api", {
    method: "POST",
    body: JSON.stringify({ customer: { email: "saved@example.invalid", date: "2026-10-08", time: "10:00" } }),
  }));
  return { requests, timeouts, post };
}

for (const kind of routes) {
  test(`${kind}: provider acceptance needs a delivery id and retains its existing success contract`, async () => {
    const f = fixture(() => Response.json({ id: "synthetic-accepted-id" }));
    const response = await f.post(kind);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.id, "synthetic-accepted-id");
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, "https://api.resend.com/emails");
    assert.equal(f.requests[0].options.signal, "synthetic-timeout-signal");
    assert.deepEqual(f.timeouts, [15_000]);
    assert.deepEqual(JSON.parse(f.requests[0].options.body).to, ["saved@example.invalid"]);
  });

  test(`${kind}: empty, invalid and non-JSON provider success cannot report the email as sent`, async () => {
    for (const reply of [
      () => Response.json({}),
      () => Response.json({ id: " " }),
      () => Response.json({ id: 123 }),
      () => Response.json(null),
      () => new Response("upstream gateway body"),
    ]) {
      const f = fixture(reply);
      const response = await f.post(kind);
      assert.equal(response.status, 502);
      const result = await response.json();
      assert.equal(result.ok, false);
      assert.match(result.error, /nem igazolható vissza/);
      assert.match(result.error, /már elindulhatott/);
      assert.equal(f.requests.length, 1, "uncertain acceptance must not automatically resend");
    }
  });

  test(`${kind}: network failures return an actionable uncertain outcome without a retry`, async () => {
    const f = fixture(() => { throw Error("PRIVATE PROVIDER NETWORK DETAIL"); });
    const response = await f.post(kind);
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.match(result.error, /ellenőrizd a korábbi küldés eredményét/);
    assert.doesNotMatch(result.error, /PRIVATE/);
    assert.equal(f.requests.length, 1);
  });

  test(`${kind}: provider rejection and rate limits stay separate from app authentication failures`, async () => {
    for (const [providerStatus, expectedStatus, message] of [
      [401, 502, /elutasította/],
      [403, 502, /elutasította/],
      [422, 502, /elutasította/],
      [429, 429, /korlátozza/],
      [500, 502, /nem igazolható vissza/],
    ]) {
      const f = fixture(() => Response.json({ message: "PRIVATE PROVIDER DETAIL synthetic-provider-key" }, { status: providerStatus }));
      const response = await f.post(kind);
      assert.equal(response.status, expectedStatus);
      const result = await response.json();
      assert.equal(result.ok, false);
      assert.match(result.error, message);
      assert.doesNotMatch(result.error, /PRIVATE|synthetic-provider-key/);
      assert.equal(f.requests.length, 1);
    }
  });
}
