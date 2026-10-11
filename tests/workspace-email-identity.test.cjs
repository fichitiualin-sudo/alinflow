const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database } = require("./helpers.cjs");

const workspaceId = "10000000-0000-4000-8000-000000000001";
const customerId = "20000000-0000-4000-8000-000000000001";
const appointmentId = "30000000-0000-4000-8000-000000000001";
const routes = ["quote", "appointment", "thank-you", "work-report"];
const facebookUrl = "https://www.facebook.com/profile.php?id=100094506956317&sk=reviews";

function fixture({ legacy = false, missingSettings = false, missingWorkspace = false, failedTable } = {}) {
  const queries = [], outgoing = [];
  const state = {
    workspace: { id: workspaceId, name: legacy ? "KLIMAlin" : "Urbán Klíma", slug: legacy ? "alinflow-existing" : "urban" },
    settings: missingSettings ? null : { workspace_id: workspaceId,
      company_profile: { displayName: "Urbán Klíma", email: "urban@example.invalid", website: "urban.example.invalid" },
      email_settings: { senderName: "Urbán Klíma", googleReviewUrl: "", facebookReviewUrl: "", customReviewUrl: "" } },
    providerStatus: 200, delivery: null,
  };
  const db = database(op => {
    queries.push(op);
    if (op.table === failedTable) return { error: { message: "PRIVATE DATABASE FAILURE" }, data: null };
    if (op.table === "workspaces") {
      assert.equal(op.filters.id, workspaceId);
      assert.equal(op.filters.active, true);
      return { data: missingWorkspace ? null : state.workspace };
    }
    assert.equal(op.filters.workspace_id, workspaceId);
    if (op.table === "workspace_settings") return { data: state.settings };
    if (op.table === "workspace_members") return { data: { workspace_id: workspaceId } };
    if (op.table === "customers") return { data: { id: customerId, email: "saved@example.invalid", name: "Saved customer", city: "Tesztváros" } };
    if (op.table === "appointments") return { data: { id: appointmentId, appointment_type: "installation", status: "Lezárva", scheduled_date: "2026-10-11", scheduled_time: "08:00" } };
    throw Error(`Unexpected query: ${op.table}`);
  });
  db.auth = { getUser: async () => ({ data: { user: { id: "test-user" } } }) };
  db.rpc = async (name, args) => {
    assert.equal(args.p_workspace_id, workspaceId);
    assert.equal(args.p_customer_id, customerId);
    assert.equal(args.p_appointment_id, appointmentId);
    if (name === "claim_installation_thank_you") {
      const resuming = !!state.delivery;
      state.delivery ||= { payload_text: args.p_payload_text, payload_signature: args.p_payload_signature,
        idempotency_key: `alinflow-thank-you/${workspaceId}/${appointmentId}/test` };
      return { data: { ...state.delivery, status: "send", claim_token: "test-claim", resuming } };
    }
    assert.equal(name, "finish_installation_thank_you");
    return { data: { sent_at: args.p_outcome === "sent" ? "2026-10-11T08:00:00Z" : null } };
  };
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public",
    RESEND_API_KEY: "synthetic-provider", EMAIL_FROM: "KLIMAlin <verified@example.invalid>", EMAIL_REPLY_TO: "legacy@example.invalid" };
  const h = harness({ process: { env }, fetch: async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    outgoing.push({ options, payload: JSON.parse(options.body) });
    return Response.json({ id: "synthetic-accepted" }, { status: state.providerStatus });
  } }, {
    "@supabase/supabase-js": { createClient: () => db },
    "@/lib/alinflow/document-pdf-data": { loadSavedPdfBundle: async () => ({ report: { id: "report", appointment_type: "installation" }, includeWorkReport: true, declarations: [] }) },
    "@/lib/alinflow/document-pdf-render": { createSavedPdfAttachments: async (_bundle, _customer, settings) => {
      state.pdfSettings = settings;
      return [{ filename: "test.pdf", content: "synthetic", content_type: "application/pdf" }];
    } },
  });
  const post = (kind, patch = {}) => h.load(`src/app/api/send-${kind}/route.ts`).POST(new Request("https://test.invalid/api", {
    method: "POST", headers: { Authorization: "Bearer synthetic-token", "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, customer: { id: customerId, activeAppointmentId: appointmentId, email: "saved@example.invalid" },
      settings: { companyProfile: { displayName: "FORGED COMPANY", email: "forged@example.invalid" },
        emailSettings: { senderName: "FORGED SENDER", googleReviewUrl: "https://forged.example.invalid/review" } },
      items: [{ name: "Test climate", quantity: 1 }], ...patch }),
  }));
  return { h, env, state, db, queries, outgoing, post };
}

for (const kind of routes) test(`${kind}: saved workspace brand and reply address replace the global name and untrusted settings`, async () => {
  const f = fixture();
  const response = await f.post(kind);
  assert.equal(response.status, 200);
  const payload = f.outgoing[0].payload;
  assert.equal(payload.from, '"Urbán Klíma" <verified@example.invalid>');
  assert.equal(payload.reply_to, "urban@example.invalid");
  assert.match(payload.subject, /Urbán Klíma/);
  assert.doesNotMatch(JSON.stringify(payload), /KLIMAlin|klimalin|FORGED|forged|legacy@example/);
  assert.equal(f.queries.filter(q => q.table === "workspaces").length, 1);
  assert.equal(f.queries.filter(q => q.table === "workspace_settings").length, 1);
  if (kind === "work-report") assert.equal(f.state.pdfSettings.companyProfile.displayName, "Urbán Klíma");
});

for (const kind of routes) test(`${kind}: absent saved settings use the known workspace and never legacy contacts`, async () => {
  const f = fixture({ missingSettings: true });
  assert.equal((await f.post(kind)).status, 200);
  const payload = f.outgoing[0].payload;
  assert.equal(payload.from, '"Urbán Klíma" <verified@example.invalid>');
  assert.equal(payload.reply_to, "verified@example.invalid");
  assert.doesNotMatch(JSON.stringify(payload), /KLIMAlin|klimalin|legacy@example|100094506956317|g\.page/);
});

for (const kind of routes) for (const failedTable of ["workspaces", "workspace_settings"]) {
  test(`${kind}: ${failedTable} errors stop before provider calls`, async () => {
    const f = fixture({ failedTable });
    const response = await f.post(kind);
    assert.equal(response.status, 503);
    assert.doesNotMatch(JSON.stringify(await response.json()), /PRIVATE/);
    assert.equal(f.outgoing.length, 0);
  });
}

test("unavailable or mismatched workspace/settings identity never sends", async () => {
  for (const field of ["missing", "workspace", "settings"]) {
    const f = fixture({ missingWorkspace: field === "missing" });
    if (field === "workspace") f.state.workspace.id = "other-workspace";
    if (field === "settings") f.state.settings.workspace_id = "other-workspace";
    assert.equal((await f.post("quote")).status, 403);
    assert.equal(f.outgoing.length, 0);
  }
});

test("a known workspace without a slug gets generic defaults with its own name", async () => {
  const f = fixture({ missingSettings: true });
  delete f.state.workspace.slug;
  assert.equal((await f.post("thank-you")).status, 200);
  assert.doesNotMatch(f.outgoing[0].payload.html, /KLIMAlin|klimalin|100094506956317/);
});

test("explicitly blank review links stay removed, including legacy workspace saves", async () => {
  const f = fixture({ legacy: true });
  f.state.settings.company_profile = {};
  f.state.settings.email_settings.senderName = "KLIMAlin";
  assert.equal((await f.post("thank-you")).status, 200);
  assert.doesNotMatch(f.outgoing[0].payload.html, /Google értékelés|Facebook értékelés|Értékelnének minket|g\.page|facebook\.com/);
  const { normalizeWorkspaceSettings, workspaceSettingsToRow, defaultWorkspaceSettings } = f.h.load("src/lib/alinflow/workspace-settings.ts");
  const saved = workspaceSettingsToRow(normalizeWorkspaceSettings({ emailSettings: { googleReviewUrl: "", facebookReviewUrl: "", customReviewUrl: "" } }, defaultWorkspaceSettings()), workspaceId);
  assert.equal(saved.email_settings.googleReviewUrl, "");
  assert.equal(saved.email_settings.facebookReviewUrl, "");
});

test("legacy defaults retain their own reviews and canonical Facebook query is HTML escaped", async () => {
  const f = fixture({ legacy: true, missingSettings: true });
  assert.equal((await f.post("thank-you")).status, 200);
  const payload = f.outgoing[0].payload;
  assert.equal(payload.from, '"KLIMAlin" <verified@example.invalid>');
  assert.match(payload.html, /href="https:\/\/www\.facebook\.com\/profile\.php\?id=100094506956317&amp;sk=reviews"/);
  assert.equal(f.h.load("src/lib/alinflow/workspace-settings.ts").defaultWorkspaceSettings().emailSettings.facebookReviewUrl, facebookUrl);
});

test("from preserves the verified mailbox, honors explicit sender name and sanitizes header text", () => {
  const f = fixture();
  const { workspaceEmailIdentity } = f.h.load("src/lib/alinflow/email-identity.ts");
  const settings = f.h.load("src/lib/alinflow/workspace-settings.ts").defaultWorkspaceSettings({ name: "Own company", slug: "own" });
  settings.emailSettings.senderName = 'Own "display"\r\nname';
  assert.equal(workspaceEmailIdentity(settings, "Old brand <verified@example.invalid>").from, '"Own \\"display\\" name" <verified@example.invalid>');
  assert.equal(workspaceEmailIdentity(settings, "bare@example.invalid").replyTo, "bare@example.invalid");
  for (const invalid of ["a@example.invalid,b@example.invalid", "a@example.invalid\r\nBcc: evil@example.invalid", "not a mailbox"]) {
    assert.throws(() => workspaceEmailIdentity(settings, invalid), error => error.status === 503);
  }
});

test("thank-you retry retains its signed stored payload despite newer workspace settings", async () => {
  const f = fixture();
  f.state.providerStatus = 503;
  assert.equal((await f.post("thank-you")).status, 502);
  f.state.settings.email_settings.senderName = "Renamed business";
  f.state.settings.email_settings.facebookReviewUrl = "https://own.example.invalid/review";
  f.state.providerStatus = 200;
  assert.equal((await f.post("thank-you")).status, 200);
  assert.equal(f.outgoing[0].options.body, f.outgoing[1].options.body);
  assert.equal(f.outgoing[0].options.headers["Idempotency-Key"], f.outgoing[1].options.headers["Idempotency-Key"]);
});
