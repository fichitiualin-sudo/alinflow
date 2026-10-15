const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const WS = "11111111-1111-4111-8111-111111111111", USER = "33333333-3333-4333-8333-333333333333";
for (const route of ["preview", "approve", "sync"]) {
  test(`${route} rejects foreign origin before contact access`, async () => {
    let called = false;
    const auth = { assertContactsOrigin() { throw Error("origin"); }, readContactsBody: async () => ({}),
      authorizeContactsWorkspace: async () => { called = true; }, contactsApiError: () => Response.json({ error: "denied" }, { status: 403 }), googleContactsConfigured: () => true };
    const module = harness({}, { "@/lib/alinflow/google-contacts-auth": auth, "@/lib/alinflow/google-contacts-sync": {
      previewGoogleContacts: async () => { called = true; }, approveGoogleContacts: async () => { called = true; }, runGoogleContactsSync: async () => { called = true; },
    } }).load(`src/app/api/google-contacts/${route}/route.ts`);
    assert.equal((await module.POST(new Request("https://example.invalid"))).status, 403); assert.equal(called, false);
  });
  test(`${route} passes verified workspace/user scope, not caller identity`, async () => {
    const calls = [];
    const auth = { assertContactsOrigin() {}, readContactsBody: async () => ({ workspaceId: "requested", userId: "forged", previewId: "preview", items: [] }),
      authorizeContactsWorkspace: async (request, workspace) => { assert.equal(workspace, "requested"); return { workspaceId: WS, userId: USER }; },
      contactsApiError: error => { throw error; }, googleContactsConfigured: () => true };
    const module = harness({}, { "@/lib/alinflow/google-contacts-auth": auth, "@/lib/alinflow/google-contacts-sync": {
      previewGoogleContacts: async (...args) => { calls.push(args); return {}; }, approveGoogleContacts: async (...args) => { calls.push(args); return {}; }, runGoogleContactsSync: async (...args) => { calls.push(args); return {}; },
    } }).load(`src/app/api/google-contacts/${route}/route.ts`);
    assert.equal((await module.POST(new Request("https://example.invalid"))).status, 200);
    assert.equal(calls[0][0], WS); if (route !== "sync") assert.equal(calls[0][1], USER);
  });
}
test("cron refuses missing secret before starting worker", async () => {
  let called = false;
  const module = harness({}, { "@/lib/alinflow/google-contacts-auth": { contactsCronAuthorized: () => false, contactsApiError: error => { throw error; }, googleContactsConfigured: () => true },
    "@/lib/alinflow/google-contacts-sync": { runGoogleContactsSync: async () => { called = true; } } }).load("src/app/api/google-contacts/cron/route.ts");
  assert.equal((await module.POST(new Request("https://example.invalid"))).status, 401); assert.equal(called, false);
});
