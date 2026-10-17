const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database } = require("./helpers.cjs");

const workspaceId = "10000000-0000-4000-8000-000000000001";
const customerId = "20000000-0000-4000-8000-000000000001";
const appointmentId = "30000000-0000-4000-8000-000000000001";

function fixture(customerFields = {}, appointmentAddress, missingTable) {
  const requests = [], queries = [];
  const customer = { id: customerId, workspace_id: workspaceId, name: "Synthetic stored customer",
    email: "saved@example.invalid", phone: "06000000000", city: "", postal_code: "",
    address: "1162 Budapest, Minta utca 4.", ...customerFields };
  const db = database(op => {
    queries.push(op);
    if (op.table === missingTable) return { data: null, error: null };
    if (op.table === "workspace_members") {
      assert.deepEqual(op.filters, { workspace_id: workspaceId, user_id: "synthetic-user", active: true });
      return { data: { workspace_id: workspaceId } };
    }
    if (op.table === "customers") {
      assert.deepEqual(op.filters, { id: customerId, workspace_id: workspaceId });
      return { data: customer };
    }
    if (op.table === "appointments") {
      assert.deepEqual(op.filters, { id: appointmentId, customer_id: customerId, workspace_id: workspaceId });
      return { data: { id: appointmentId, appointment_type: "maintenance", address: appointmentAddress } };
    }
    throw Error("Unexpected query: " + op.table);
  });
  db.auth = { getUser: async token => {
    assert.equal(token, "synthetic-token");
    return { data: { user: { id: "synthetic-user" } } };
  } };
  db.rpc = async name => {
    if (name === "claim_invoice_delivery") return { data: { status: "send", claim_token: "synthetic-claim" } };
    if (name === "finish_invoice_delivery") return { data: { status: "confirmed" } };
    throw Error("Unexpected RPC: " + name);
  };
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", SZAMLAZZ_WORKSPACE_ID: workspaceId,
    SZAMLAZZ_LABOR_AGENT_KEY: "synthetic-invoice" };
  const h = harness({ process: { env }, fetch: async (url, init) => {
    assert.equal(String(url), "https://www.szamlazz.hu/szamla/");
    requests.push(await init.body.get("action-xmlagentxmlfile").text());
    return new Response("<reply><sikeres>true</sikeres><szamlaszam>SYNTHETIC-ONLY</szamlaszam></reply>");
  } }, { "@supabase/supabase-js": { createClient: () => db } });
  const body = { workspaceId, kind: "maintenance", amount: 12000, sendEmail: true,
    customer: { id: customerId, name: "Untrusted name", city: "Untrusted city", postalCode: "9999",
      address: "Untrusted street", email: "SAVED@example.invalid", phone: "untrusted-phone",
      ...(appointmentAddress === undefined ? {} : { activeAppointmentId: appointmentId }) } };
  const request = (patch = {}) => new Request("https://example.invalid/api/create-invoice", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-token" },
    body: JSON.stringify({ ...body, ...patch }),
  });
  return { h, customer, body, request, requests, queries,
    post: patch => h.load("src/app/api/create-invoice/route.ts").POST(request(patch)) };
}

const fullAddressCases = [
  ["1162 Budapest, Minta utca 4.", "1162", "Budapest", "Minta utca 4."],
  [" 1162, Budapest. Minta utca 4. ", "1162", "Budapest", "Minta utca 4."],
  ["1162Budapest, Minta utca 4.", "1162", "Budapest", "Minta utca 4."],
  ["2030 Erd, Minta utca 4.", "2030", "Érd", "Minta utca 4."],
  ["3053 Ecseg; Minta utca 4.", "3053", "Ecseg", "Minta utca 4."],
  ["3053 Kozárd: Minta utca 4.", "3053", "Kozárd", "Minta utca 4."],
  ["2131 Göd(Alsógöd), Minta utca 4.", "2131", "Göd", "(Alsógöd), Minta utca 4."],
  ["2030 E\u0301rd; Minta utca 4.", "2030", "Érd", "Minta utca 4."],
];

for (const [address, postalCode, city, street] of fullAddressCases) {
  test(`invoice location: imported full address ${address} supplies provider fields`, async () => {
    const f = fixture({ address });
    const response = await f.post();
    assert.equal(response.status, 200);
    assert.equal(f.requests.length, 1);
    const xml = f.requests[0];
    assert.ok(xml.includes(`<irsz>${postalCode}</irsz>`));
    assert.ok(xml.includes(`<telepules>${city}</telepules>`));
    assert.ok(xml.includes(`<cim>${street}</cim>`));
    assert.ok(xml.includes("<nev>Synthetic stored customer</nev>"));
    assert.ok(xml.includes("<email>saved@example.invalid</email>"));
    assert.doesNotMatch(xml, /Untrusted|untrusted-phone/);
    assert.equal(f.customer.address, address);
    assert.equal(f.customer.city, "");
    assert.ok(f.queries.every(query => query.method === "select"));
  });
}

test("invoice location: selected authorized work address determines postcode and city together", async () => {
  const f = fixture({ city: "Budapest", postal_code: "1162", address: "Canonical utca 4." }, "2030 Érd, Munka utca 8.");
  const response = await f.post();
  assert.equal(response.status, 200);
  assert.ok(f.requests[0].includes("<irsz>2030</irsz>"));
  assert.ok(f.requests[0].includes("<telepules>Érd</telepules>"));
  assert.ok(f.requests[0].includes("<cim>Munka utca 8.</cim>"));
  assert.doesNotMatch(f.requests[0], /Budapest|Canonical utca/);
  assert.equal(f.customer.city, "Budapest");
  assert.equal(f.customer.postal_code, "1162");
});

for (const address of ["Budapest utca 4.", "1162 Budapesti út 4.", "11620 Budapest, Minta utca 4.", "Minta utca 4., 1162 Budapest"]) {
  test(`invoice location: street text is preserved without an exact full prefix: ${address}`, async () => {
    const f = fixture({ city: "Budapest", postal_code: "1162", address });
    assert.equal((await f.post()).status, 200);
    assert.ok(f.requests[0].includes(`<cim>${address}</cim>`));
  });
}

test("authorized location: unique saved postcode fills a blank city while retaining street and recipient", async () => {
  const f = fixture({ city: "", postal_code: "2030", address: "Minta utca 4." });
  await f.h.load("src/lib/alinflow/server-auth.ts").authorizeCustomerRequest(f.request(), f.body);
  assert.equal(f.body.customer.city, "Érd");
  assert.equal(f.body.customer.postalCode, "2030");
  assert.equal(f.body.customer.address, "Minta utca 4.");
  assert.equal(f.body.customer.email, "saved@example.invalid");
  assert.equal(f.requests.length, 0);
});

test("authorized location: ambiguous saved postcode leaves a missing city unresolved", async () => {
  const f = fixture({ city: "", postal_code: "2066", address: "Minta utca 4." });
  await f.h.load("src/lib/alinflow/server-auth.ts").authorizeCustomerRequest(f.request(), f.body);
  assert.equal(f.body.customer.city, "");
  assert.equal(f.body.customer.postalCode, "2066");
  assert.equal(f.body.customer.address, "Minta utca 4.");
  assert.equal(f.requests.length, 0);
});

for (const missingTable of ["workspace_members", "customers", "appointments"]) {
  test(`invoice location: ${missingTable} authorization still precedes provider access`, async () => {
    const f = fixture({}, "2030 Érd, Munka utca 8.", missingTable);
    assert.equal((await f.post()).status, 403);
    assert.equal(f.requests.length, 0);
  });
}

test("invoice location: changed request recipient still requires saving first", async () => {
  const f = fixture();
  assert.equal((await f.post({ customer: { ...f.body.customer, email: "changed@example.invalid" } })).status, 409);
  assert.equal(f.requests.length, 0);
});
