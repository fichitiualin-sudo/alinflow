const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database } = require("./helpers.cjs");
const routes = ["send-quote", "send-appointment", "send-work-report", "send-thank-you", "create-invoice"];
const workspaceId = "10000000-0000-0000-0000-000000000001";
const customerId = "20000000-0000-0000-0000-000000000001";
function apiHarness(failure) {
  const outgoing = [];
  const invoiceRpcCalls = [];
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-public-key",
    SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
    RESEND_API_KEY: "fake-mail-key", EMAIL_FROM: "Test <test@example.invalid>",
    SZAMLAZZ_LABOR_AGENT_KEY: "fake-invoice-key", SZAMLAZZ_WORKSPACE_ID: workspaceId,
  };
  const db = database(op => {
    if (op.table === failure) return { data: null, error: null };
    if (op.table === "workspace_members") return { data: { workspace_id: workspaceId } };
    if (op.table === "workspaces") return { data: { id: workspaceId, name: "Test", slug: "test" } };
    if (op.table === "workspace_settings") return { data: null };
    if (op.table === "customers") return { data: { id: customerId, name: "Stored Customer",
      email: "stored@example.invalid", phone: "06000000000", city: "Test", postal_code: "0000", address: "Stored street" } };
    if (op.table === "appointments") return { data: { id: "appointment", customer_id: customerId, appointment_type: "maintenance" } };
    throw Error("Unexpected query " + op.table);
  });
  db.auth = { getUser: async () => failure === "auth" ? { data: {}, error: Error("invalid") } : { data: { user: { id: "user" } } } };
  db.rpc = async name => {
    invoiceRpcCalls.push(name);
    return name === "claim_invoice_delivery"
    ? { data: { status: "send", claim_token: "synthetic-invoice-claim" } }
    : name === "finish_invoice_delivery" ? { data: { status: "confirmed" } }
    : { error: { message: "Unexpected RPC" } };
  };
  const h = harness({ process: { env }, fetch: async (url, options) => {
    outgoing.push({ url: String(url), options });
    if (String(url).includes("szamlazz.hu")) return new Response("<valasz><sikeres>true</sikeres><szamlaszam>TEST-ONLY</szamlaszam></valasz>");
    return Response.json({ id: "TEST-ONLY" });
  } }, {
    "@supabase/supabase-js": { createClient: () => db },
    // Authentication must finish before document queries or font/PDF work starts.
    "@/lib/alinflow/document-pdf-data": { loadSavedPdfBundle: async () => { throw Error("PDF source accessed before authentication"); } },
    "@/lib/alinflow/document-pdf-render": { createSavedPdfAttachments: async () => { throw Error("PDF generated before authentication"); } },
  });
  const body = { workspaceId, customer: { id: customerId, name: "Supplied Customer",
    email: "STORED@example.invalid", activeAppointmentId: "appointment" }, kind: "maintenance", amount: 12000,
    items: [], quoteItems: [], report: {} };
  const request = (token = "test-token", patch = {}) => new Request("https://test.invalid/api", {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify({ ...body, ...patch }) });
  return { h, env, request, outgoing, invoiceRpcCalls };
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
  const h = harness({ AbortSignal, fetch: async (url, init) => { sent = { url, init }; return Response.json({}); } });
  const f = h.functions(["authenticatedFetch"], { currentWorkspaceId: () => workspaceId,
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "fake-token" } } }) } } });
  await f.authenticatedFetch("/api/send-quote", { method: "POST", body: JSON.stringify({ customer: { id: customerId } }) });
  assert.equal(sent.init.headers.get("Authorization"), "Bearer fake-token");
  assert.equal(JSON.parse(sent.init.body).workspaceId, workspaceId);
});

const otherInvoiceWorkspace = "10000000-0000-0000-0000-000000000002";
function invoiceHarness(config = {}, failure) {
  const fixture = apiHarness(failure);
  Object.assign(fixture.env, {
    SZAMLAZZ_DEVICE_AGENT_KEY: "synthetic-device-key",
    SZAMLAZZ_LABOR_AGENT_KEY: "synthetic-labor-key",
    SZAMLAZZ_COMBINED_AGENT_KEY: "synthetic-combined-key",
    ...config,
  });
  return fixture;
}
const postInvoice = (fixture, kind) => fixture.h.load("src/app/api/create-invoice/route.ts")
  .POST(fixture.request("test-token", { kind }));
async function assertInvoiceKey(fixture, response, expectedKey) {
  assert.equal(response.status, 200);
  assert.equal(fixture.outgoing.length, 1);
  const xml = await fixture.outgoing[0].options.body.get("action-xmlagentxmlfile").text();
  assert.equal(/<szamlaagentkulcs>([^<]+)<\/szamlaagentkulcs>/.exec(xml)?.[1], expectedKey);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-[a-z-]+-key/);
  return xml;
}

for (const [kind, expected] of [["device", "device"], ["labor", "labor"], ["maintenance", "labor"], ["combined", "combined"]]) {
  test(`billing workspace: legacy workspace retains ${kind} invoice access and issuer`, async () => {
    const fixture = invoiceHarness({ SZAMLAZZ_WORKSPACE_ID: `  ${workspaceId}  `,
      SZAMLAZZ_COMBINED_WORKSPACE_IDS: otherInvoiceWorkspace });
    await assertInvoiceKey(fixture, await postInvoice(fixture, kind), `synthetic-${expected}-key`);
  });
}

for (const dedicated of [true, false]) {
  test(`billing workspace: exact extra workspace permits combined with ${dedicated ? "dedicated" : "device fallback"} issuer`, async () => {
    const fixture = invoiceHarness({ SZAMLAZZ_WORKSPACE_ID: otherInvoiceWorkspace,
      SZAMLAZZ_COMBINED_WORKSPACE_IDS: ` , ${otherInvoiceWorkspace},\n ${workspaceId} , `,
      SZAMLAZZ_COMBINED_AGENT_KEY: dedicated ? "synthetic-combined-key" : "" });
    await assertInvoiceKey(fixture, await postInvoice(fixture, "combined"), `synthetic-${dedicated ? "combined" : "device"}-key`);
  });
}

for (const kind of ["device", "labor", "maintenance"]) {
  test(`billing workspace: combined allowlist does not authorize ${kind} invoices`, async () => {
    const fixture = invoiceHarness({ SZAMLAZZ_WORKSPACE_ID: otherInvoiceWorkspace,
      SZAMLAZZ_COMBINED_WORKSPACE_IDS: workspaceId });
    assert.equal((await postInvoice(fixture, kind)).status, 403);
    assert.equal(fixture.outgoing.length, 0);
  });
}

test("billing workspace: combined invoice never falls back to the labor issuer", async () => {
  const fixture = invoiceHarness({ SZAMLAZZ_WORKSPACE_ID: otherInvoiceWorkspace,
    SZAMLAZZ_COMBINED_WORKSPACE_IDS: workspaceId,
    SZAMLAZZ_COMBINED_AGENT_KEY: "", SZAMLAZZ_DEVICE_AGENT_KEY: "" });
  const response = await postInvoice(fixture, "combined");
  assert.equal(response.status, 500);
  assert.equal((await response.json()).ok, false);
  assert.equal(fixture.outgoing.length, 0);
});

test("billing workspace: missing legacy binding permits only explicitly listed combined invoices", async () => {
  for (const kind of ["device", "labor", "maintenance", "combined"]) {
    const fixture = invoiceHarness({ SZAMLAZZ_WORKSPACE_ID: undefined,
      SZAMLAZZ_COMBINED_WORKSPACE_IDS: workspaceId });
    const response = await postInvoice(fixture, kind);
    if (kind === "combined") await assertInvoiceKey(fixture, response, "synthetic-combined-key");
    else {
      assert.equal(response.status, 403);
      assert.equal(fixture.outgoing.length, 0);
    }
  }
});

test("billing workspace: absent or blank configuration grants no workspace access", async () => {
  for (const empty of [undefined, "", " , , "]) {
    for (const kind of ["device", "labor", "maintenance", "combined"]) {
      const fixture = invoiceHarness({ SZAMLAZZ_WORKSPACE_ID: undefined,
        SZAMLAZZ_COMBINED_WORKSPACE_IDS: empty });
      assert.equal((await postInvoice(fixture, kind)).status, 403);
      assert.equal(fixture.outgoing.length, 0);
    }
  }
});

test("billing workspace: allowlist requires exact entries, never wildcard or substring matches", async () => {
  for (const allowed of [otherInvoiceWorkspace, "*", `${workspaceId}*`, workspaceId.slice(0, -1),
    `prefix-${workspaceId}`, `${workspaceId}-suffix`, `${otherInvoiceWorkspace};${workspaceId}`]) {
    const fixture = invoiceHarness({ SZAMLAZZ_WORKSPACE_ID: otherInvoiceWorkspace,
      SZAMLAZZ_COMBINED_WORKSPACE_IDS: allowed });
    assert.equal((await postInvoice(fixture, "combined")).status, 403, `must reject ${allowed}`);
    assert.equal(fixture.outgoing.length, 0);
  }
});

test("billing workspace: combined issuer allowlist does not bypass workspace or customer authorization", async () => {
  for (const failure of ["workspace_members", "customers", "appointments"]) {
    const fixture = invoiceHarness({ SZAMLAZZ_WORKSPACE_ID: otherInvoiceWorkspace,
      SZAMLAZZ_COMBINED_WORKSPACE_IDS: workspaceId }, failure);
    assert.equal((await postInvoice(fixture, "combined")).status, 403);
    assert.equal(fixture.outgoing.length, 0);
  }
});

function splitInvoiceHarness(config = {}, failure) {
  return invoiceHarness({
    SZAMLAZZ_WORKSPACE_ID: otherInvoiceWorkspace,
    SZAMLAZZ_SPLIT_WORKSPACE_ID: `  ${workspaceId}  `,
    SZAMLAZZ_DEVICE_VAT_KEY: "27",
    SZAMLAZZ_DEVICE_INVOICE_PREFIX: "DEVICE",
    SZAMLAZZ_LABOR_VAT_KEY: "18",
    SZAMLAZZ_LABOR_INVOICE_PREFIX: "PRIMARY-EV",
    SZAMLAZZ_LABOR_COMMENT: "PRIMARY-PRIVATE-LABOR-COMMENT",
    SZAMLAZZ_MAINTENANCE_COMMENT: "PRIMARY-PRIVATE-MAINTENANCE-COMMENT",
    SZAMLAZZ_SPLIT_LABOR_AGENT_KEY: "synthetic-split-labor-key",
    SZAMLAZZ_SPLIT_LABOR_VAT_KEY: " AAM ",
    SZAMLAZZ_SPLIT_LABOR_INVOICE_PREFIX: " OWN-EV ",
    ...config,
  }, failure);
}

for (const kind of ["device", "labor", "maintenance"]) {
  test(`split billing: ${kind} selects its own issuer key, VAT and prefix as one configuration`, async () => {
    const fixture = splitInvoiceHarness();
    const isDevice = kind === "device";
    const xml = await assertInvoiceKey(fixture, await postInvoice(fixture, kind),
      isDevice ? "synthetic-device-key" : "synthetic-split-labor-key");
    assert.match(xml, isDevice ? /<afakulcs>27<\/afakulcs>/ : /<afakulcs>AAM<\/afakulcs>/);
    assert.match(xml, isDevice ? /<szamlaszamElotag>DEVICE<\/szamlaszamElotag>/
      : /<szamlaszamElotag>OWN-EV<\/szamlaszamElotag>/);
    assert.match(xml, /<bruttoErtek>12000<\/bruttoErtek>/);
    assert.match(xml, isDevice ? /<afaErtek>2551<\/afaErtek>/ : /<afaErtek>0<\/afaErtek>/);
    assert.doesNotMatch(xml, /synthetic-(?:labor|combined)-key|PRIMARY-EV|PRIMARY-PRIVATE/);
  });
}

for (const kind of ["labor", "maintenance"]) {
  test(`split billing: unset own ${kind} prefix is omitted instead of inheriting the primary issuer prefix`, async () => {
    for (const prefix of [undefined, "", "   "]) {
      const fixture = splitInvoiceHarness({ SZAMLAZZ_SPLIT_LABOR_INVOICE_PREFIX: prefix });
      const xml = await assertInvoiceKey(fixture, await postInvoice(fixture, kind), "synthetic-split-labor-key");
      assert.doesNotMatch(xml, /szamlaszamElotag|PRIMARY-EV|PRIMARY-PRIVATE/);
    }
  });
}

for (const field of ["SZAMLAZZ_SPLIT_LABOR_AGENT_KEY", "SZAMLAZZ_SPLIT_LABOR_VAT_KEY"]) {
  test(`split billing: missing ${field} stops labor and maintenance before contacting any issuer`, async () => {
    for (const missing of [undefined, "", "   "]) {
      for (const kind of ["labor", "maintenance"]) {
        const fixture = splitInvoiceHarness({ [field]: missing });
        const response = await postInvoice(fixture, kind);
        assert.equal(response.status, 500);
        const result = await response.json();
        assert.equal(result.ok, false);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-[a-z-]+-key/);
        assert.equal(fixture.outgoing.length, 0);
      }
    }
  });
}

test("split billing: device never falls back to either labor issuer when its key is missing", async () => {
  const fixture = splitInvoiceHarness({ SZAMLAZZ_DEVICE_AGENT_KEY: "" });
  assert.equal((await postInvoice(fixture, "device")).status, 500);
  assert.equal(fixture.outgoing.length, 0);
});

test("split billing: combined invoices are denied even if the previous combined allowlist still contains the workspace", async () => {
  const fixture = splitInvoiceHarness({ SZAMLAZZ_COMBINED_WORKSPACE_IDS: workspaceId });
  assert.equal((await postInvoice(fixture, "combined")).status, 403);
  assert.equal(fixture.outgoing.length, 0);
});

test("split billing: configured access requires one exact workspace ID", async () => {
  for (const configured of [undefined, "", "   ", otherInvoiceWorkspace, "*", `${workspaceId}*`,
    `prefix-${workspaceId}`, `${workspaceId},${otherInvoiceWorkspace}`]) {
    for (const kind of ["device", "labor", "maintenance", "combined"]) {
      const fixture = splitInvoiceHarness({ SZAMLAZZ_SPLIT_WORKSPACE_ID: configured });
      assert.equal((await postInvoice(fixture, kind)).status, 403, `${kind} must reject ${configured}`);
      assert.equal(fixture.outgoing.length, 0);
    }
  }
});

test("split billing: conflicting primary and split bindings fail closed for every invoice type", async () => {
  for (const kind of ["device", "labor", "maintenance", "combined"]) {
    const fixture = splitInvoiceHarness({ SZAMLAZZ_WORKSPACE_ID: workspaceId,
      SZAMLAZZ_COMBINED_WORKSPACE_IDS: workspaceId });
    assert.equal((await postInvoice(fixture, kind)).status, 403);
    assert.equal(fixture.outgoing.length, 0);
  }
});

test("split billing: existing primary workspace keeps all four original issuer settings", async () => {
  for (const [kind, key, vat, prefix] of [["device", "device", "27", "DEVICE"],
    ["labor", "labor", "18", "PRIMARY-EV"], ["maintenance", "labor", "18", "PRIMARY-EV"],
    ["combined", "combined", "5", "COMBINED"]]) {
    const fixture = splitInvoiceHarness({ SZAMLAZZ_WORKSPACE_ID: workspaceId,
      SZAMLAZZ_SPLIT_WORKSPACE_ID: otherInvoiceWorkspace,
      SZAMLAZZ_COMBINED_VAT_KEY: "5", SZAMLAZZ_COMBINED_INVOICE_PREFIX: "COMBINED" });
    const xml = await assertInvoiceKey(fixture, await postInvoice(fixture, kind), `synthetic-${key}-key`);
    assert.ok(xml.includes(`<afakulcs>${vat}</afakulcs>`));
    assert.ok(xml.includes(`<szamlaszamElotag>${prefix}</szamlaszamElotag>`));
    assert.doesNotMatch(xml, /synthetic-split-labor-key|OWN-EV/);
  }
});

test("split billing: workspace membership, saved customer and appointment authorization remain required", async () => {
  for (const [failure, status] of [["auth", 401], ["workspace_members", 403], ["customers", 403], ["appointments", 403]]) {
    for (const kind of ["device", "labor", "maintenance"]) {
      const fixture = splitInvoiceHarness({}, failure);
      assert.equal((await postInvoice(fixture, kind)).status, status);
      assert.equal(fixture.outgoing.length, 0);
    }
  }
});

test("split billing: request-supplied issuer credentials and VAT cannot override the server binding", async () => {
  const fixture = splitInvoiceHarness();
  const response = await fixture.h.load("src/app/api/create-invoice/route.ts").POST(fixture.request("test-token", {
    kind: "labor", agentKey: "untrusted-agent-key", vatKey: "27", invoicePrefix: "UNTRUSTED",
    issuerConfig: { agentKey: "untrusted-agent-key", vatKey: "27", invoicePrefix: "UNTRUSTED" },
  }));
  const xml = await assertInvoiceKey(fixture, response, "synthetic-split-labor-key");
  assert.match(xml, /<afakulcs>AAM<\/afakulcs>/);
  assert.match(xml, /<szamlaszamElotag>OWN-EV<\/szamlaszamElotag>/);
  assert.doesNotMatch(xml, /untrusted-agent-key|UNTRUSTED/);
});

const thirdInvoiceWorkspace = "10000000-0000-0000-0000-000000000003";
function secondarySplitInvoiceHarness(config = {}, failure) {
  return splitInvoiceHarness({
    SZAMLAZZ_SPLIT_WORKSPACE_ID: thirdInvoiceWorkspace,
    SZAMLAZZ_SPLIT_LABOR_VAT_KEY: "5",
    SZAMLAZZ_SPLIT_SECONDARY_WORKSPACE_ID: `  ${workspaceId}  `,
    SZAMLAZZ_SPLIT_SECONDARY_LABOR_AGENT_KEY: " synthetic-secondary-split-labor-key ",
    SZAMLAZZ_SPLIT_SECONDARY_LABOR_VAT_KEY: " AAM ",
    SZAMLAZZ_SPLIT_SECONDARY_LABOR_INVOICE_PREFIX: " SECONDARY-EV ",
    ...config,
  }, failure);
}
function assertNoInvoiceAttempt(fixture) {
  assert.equal(fixture.outgoing.length, 0);
  assert.deepEqual(fixture.invoiceRpcCalls, []);
}

for (const kind of ["device", "labor", "maintenance"]) {
  test(`secondary split billing: ${kind} keeps its key, VAT and prefix together`, async () => {
    const fixture = secondarySplitInvoiceHarness();
    const isDevice = kind === "device";
    const xml = await assertInvoiceKey(fixture, await postInvoice(fixture, kind),
      isDevice ? "synthetic-device-key" : "synthetic-secondary-split-labor-key");
    assert.match(xml, isDevice ? /<afakulcs>27<\/afakulcs>/ : /<afakulcs>AAM<\/afakulcs>/);
    assert.match(xml, isDevice ? /<szamlaszamElotag>DEVICE<\/szamlaszamElotag>/
      : /<szamlaszamElotag>SECONDARY-EV<\/szamlaszamElotag>/);
    assert.match(xml, /<bruttoErtek>12000<\/bruttoErtek>/);
    assert.match(xml, isDevice ? /<afaErtek>2551<\/afaErtek>/ : /<afaErtek>0<\/afaErtek>/);
    assert.doesNotMatch(xml, /synthetic-(?:labor|combined|split-labor)-key|OWN-EV|PRIMARY-EV|PRIMARY-PRIVATE/);
    assert.deepEqual(fixture.invoiceRpcCalls, ["claim_invoice_delivery", "finish_invoice_delivery"]);
  });
}

test("secondary split billing: original split binding retains its own issuer settings", async () => {
  for (const [kind, key, vat, prefix] of [["device", "device", "27", "DEVICE"],
    ["labor", "split-labor", "5", "OWN-EV"], ["maintenance", "split-labor", "5", "OWN-EV"]]) {
    const fixture = secondarySplitInvoiceHarness({ SZAMLAZZ_SPLIT_WORKSPACE_ID: workspaceId,
      SZAMLAZZ_SPLIT_SECONDARY_WORKSPACE_ID: thirdInvoiceWorkspace });
    const xml = await assertInvoiceKey(fixture, await postInvoice(fixture, kind), `synthetic-${key}-key`);
    assert.ok(xml.includes(`<afakulcs>${vat}</afakulcs>`));
    assert.ok(xml.includes(`<szamlaszamElotag>${prefix}</szamlaszamElotag>`));
    assert.doesNotMatch(xml, /synthetic-secondary-split-labor-key|SECONDARY-EV|PRIMARY-EV/);
  }
});

test("secondary split billing: primary binding retains all four issuer settings with both split slots configured", async () => {
  for (const [kind, key, vat, prefix] of [["device", "device", "27", "DEVICE"],
    ["labor", "labor", "18", "PRIMARY-EV"], ["maintenance", "labor", "18", "PRIMARY-EV"],
    ["combined", "combined", "9", "COMBINED"]]) {
    const fixture = secondarySplitInvoiceHarness({ SZAMLAZZ_WORKSPACE_ID: workspaceId,
      SZAMLAZZ_SPLIT_SECONDARY_WORKSPACE_ID: otherInvoiceWorkspace,
      SZAMLAZZ_COMBINED_VAT_KEY: "9", SZAMLAZZ_COMBINED_INVOICE_PREFIX: "COMBINED" });
    const xml = await assertInvoiceKey(fixture, await postInvoice(fixture, kind), `synthetic-${key}-key`);
    assert.ok(xml.includes(`<afakulcs>${vat}</afakulcs>`));
    assert.ok(xml.includes(`<szamlaszamElotag>${prefix}</szamlaszamElotag>`));
    assert.doesNotMatch(xml, /synthetic-(?:secondary-split-labor|split-labor)-key|SECONDARY-EV|OWN-EV/);
  }
});

for (const field of ["SZAMLAZZ_SPLIT_SECONDARY_LABOR_AGENT_KEY", "SZAMLAZZ_SPLIT_SECONDARY_LABOR_VAT_KEY"]) {
  test(`secondary split billing: missing ${field} stops before claiming or contacting any issuer`, async () => {
    for (const missing of [undefined, "", "   "]) {
      for (const kind of ["labor", "maintenance"]) {
        const fixture = secondarySplitInvoiceHarness({ [field]: missing });
        const response = await postInvoice(fixture, kind);
        assert.equal(response.status, 500);
        const result = await response.json();
        assert.equal(result.ok, false);
        assert.doesNotMatch(JSON.stringify(result), /synthetic-[a-z-]+-key/);
        assertNoInvoiceAttempt(fixture);
      }
    }
    const deviceFixture = secondarySplitInvoiceHarness({ [field]: undefined });
    await assertInvoiceKey(deviceFixture, await postInvoice(deviceFixture, "device"), "synthetic-device-key");
  });
}

test("secondary split billing: blank own prefix is omitted and never inherited from another issuer", async () => {
  for (const prefix of [undefined, "", "   "]) {
    for (const kind of ["labor", "maintenance"]) {
      const fixture = secondarySplitInvoiceHarness({ SZAMLAZZ_SPLIT_SECONDARY_LABOR_INVOICE_PREFIX: prefix });
      const xml = await assertInvoiceKey(fixture, await postInvoice(fixture, kind), "synthetic-secondary-split-labor-key");
      assert.doesNotMatch(xml, /szamlaszamElotag|OWN-EV|PRIMARY-EV/);
    }
  }
});

test("secondary split billing: a missing device key never uses any labor issuer", async () => {
  const fixture = secondarySplitInvoiceHarness({ SZAMLAZZ_DEVICE_AGENT_KEY: "" });
  assert.equal((await postInvoice(fixture, "device")).status, 500);
  assertNoInvoiceAttempt(fixture);
});

test("secondary split billing: combined invoices remain denied despite the older allowlist", async () => {
  const fixture = secondarySplitInvoiceHarness({ SZAMLAZZ_COMBINED_WORKSPACE_IDS: workspaceId });
  assert.equal((await postInvoice(fixture, "combined")).status, 403);
  assertNoInvoiceAttempt(fixture);
});

test("secondary split billing: only a single exact workspace ID enables the binding", async () => {
  for (const configured of [undefined, "", "   ", thirdInvoiceWorkspace, "*", `${workspaceId}*`,
    `prefix-${workspaceId}`, `${workspaceId},${otherInvoiceWorkspace}`]) {
    for (const kind of ["device", "labor", "maintenance", "combined"]) {
      const fixture = secondarySplitInvoiceHarness({ SZAMLAZZ_SPLIT_SECONDARY_WORKSPACE_ID: configured });
      assert.equal((await postInvoice(fixture, kind)).status, 403, `${kind} must reject ${configured}`);
      assertNoInvoiceAttempt(fixture);
    }
  }
});

test("secondary split billing: every conflicting binding denies every kind before an invoice claim", async () => {
  for (const collision of [
    { SZAMLAZZ_WORKSPACE_ID: workspaceId },
    { SZAMLAZZ_SPLIT_WORKSPACE_ID: workspaceId },
    { SZAMLAZZ_WORKSPACE_ID: workspaceId, SZAMLAZZ_SPLIT_WORKSPACE_ID: workspaceId },
  ]) {
    for (const kind of ["device", "labor", "maintenance", "combined"]) {
      const fixture = secondarySplitInvoiceHarness({ ...collision, SZAMLAZZ_COMBINED_WORKSPACE_IDS: workspaceId });
      const response = await postInvoice(fixture, kind);
      assert.equal(response.status, 403);
      assert.match((await response.json()).error, /ütköznek/);
      assertNoInvoiceAttempt(fixture);
    }
  }
});

test("secondary split billing: a collision in another workspace does not disable an unambiguous binding", async () => {
  for (const [config, key] of [
    [{ SZAMLAZZ_SPLIT_WORKSPACE_ID: otherInvoiceWorkspace }, "secondary-split-labor"],
    [{ SZAMLAZZ_WORKSPACE_ID: workspaceId, SZAMLAZZ_SPLIT_SECONDARY_WORKSPACE_ID: thirdInvoiceWorkspace }, "labor"],
    [{ SZAMLAZZ_SPLIT_WORKSPACE_ID: workspaceId, SZAMLAZZ_SPLIT_SECONDARY_WORKSPACE_ID: otherInvoiceWorkspace }, "split-labor"],
  ]) {
    const fixture = secondarySplitInvoiceHarness(config);
    await assertInvoiceKey(fixture, await postInvoice(fixture, "labor"), `synthetic-${key}-key`);
  }
});

test("secondary split billing: all types still require authenticated membership, customer and appointment scope", async () => {
  for (const [failure, status] of [["auth", 401], ["workspace_members", 403], ["customers", 403], ["appointments", 403]]) {
    for (const kind of ["device", "labor", "maintenance"]) {
      const fixture = secondarySplitInvoiceHarness({}, failure);
      assert.equal((await postInvoice(fixture, kind)).status, status);
      assertNoInvoiceAttempt(fixture);
    }
  }
});

test("secondary split billing: client-supplied issuer fields cannot change the server's own binding", async () => {
  const fixture = secondarySplitInvoiceHarness();
  const response = await fixture.h.load("src/app/api/create-invoice/route.ts").POST(fixture.request("test-token", {
    kind: "labor", agentKey: "untrusted-agent-key", vatKey: "27", invoicePrefix: "UNTRUSTED",
    issuerConfig: { agentKey: "untrusted-agent-key", vatKey: "27", invoicePrefix: "UNTRUSTED" },
  }));
  const xml = await assertInvoiceKey(fixture, response, "synthetic-secondary-split-labor-key");
  assert.match(xml, /<afakulcs>AAM<\/afakulcs>/);
  assert.match(xml, /<szamlaszamElotag>SECONDARY-EV<\/szamlaszamElotag>/);
  assert.doesNotMatch(xml, /untrusted-agent-key|UNTRUSTED/);
});
