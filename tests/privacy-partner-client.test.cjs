const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const workspaceId = "11111111-1111-4111-8111-111111111111";
const partnerUserId = "22222222-2222-4222-8222-222222222222";
const partnerWorkspaceId = "33333333-3333-4333-8333-333333333333";
const candidate = { userId: partnerUserId, workspaceId: partnerWorkspaceId, workspaceName: "Teszt partner", party: { legalName: "Teszt EV" }, issues: [] };

function fixture(result, status = 200, signedIn = true) {
  const requests = [];
  const h = harness({ fetch: async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return Response.json(result, { status });
  } }, { "@/lib/supabase": { supabase: { auth: { getSession: async () => ({ data: { session: signedIn ? { access_token: "synthetic-token" } : null } }) } } } });
  return { ...h.load("src/lib/alinflow/privacy-partner-client.ts"), requests };
}

test("partner lookup authenticates and only submits workspace and exact normalized email", async () => {
  const f = fixture({ ok: true, candidates: [candidate] });
  assert.equal((await f.lookupPrivacyPartners(workspaceId, "  Partner@Example.invalid  "))[0].userId, partnerUserId);
  assert.equal(f.requests[0].url, "/api/privacy-partner");
  assert.deepEqual(f.requests[0].body, { workspaceId, email: "partner@example.invalid" });
  assert.equal(f.requests[0].options.headers.Authorization, "Bearer synthetic-token");
  assert.equal(f.requests[0].options.cache, "no-store");
});

test("signed-out partner lookup never submits a request", async () => {
  const f = fixture({}, 200, false);
  await assert.rejects(f.lookupPrivacyPartners(workspaceId, "partner@example.invalid"), /jelentkezz be/);
  assert.equal(f.requests.length, 0);
});

test("save resolution checks exact selected identity and rejects incomplete or mismatched response", async () => {
  for (const value of [{ ...candidate, userId: workspaceId }, { ...candidate, workspaceId }, { ...candidate, issues: ["Hiányos"] }, undefined]) {
    const f = fixture({ ok: true, candidate: value });
    await assert.rejects(f.resolvePrivacyPartner(workspaceId, partnerUserId, partnerWorkspaceId), /nem ellenőrizhető/);
  }
  const f = fixture({ ok: true, candidate });
  assert.equal((await f.resolvePrivacyPartner(workspaceId, partnerUserId, partnerWorkspaceId)).party.legalName, "Teszt EV");
  assert.deepEqual(f.requests[0].body, { workspaceId, partnerUserId, partnerWorkspaceId });
});

test("server failure and malformed lookup do not appear as selectable results", async () => {
  await assert.rejects(fixture({ ok: false, error: "Próbáld újra." }, 503).lookupPrivacyPartners(workspaceId, "partner@example.invalid"), /Próbáld újra/);
  await assert.rejects(fixture({ ok: true }).lookupPrivacyPartners(workspaceId, "partner@example.invalid"), /nem olvasható/);
});
