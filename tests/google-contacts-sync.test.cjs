const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database } = require("./helpers.cjs");
const WS = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const PREVIEW = "44444444-4444-4444-8444-444444444444";
const MARKER = `${WS}:${CUSTOMER}`;
const source = { customerId: CUSTOMER, name: "Teszt Ügyfél", phone: "+36301234567", email: "customer@example.invalid", address: "Teszt utca 1.", notes: "Klíma: Példa 3,5 kW", sourceHash: "a".repeat(64) };
const model = harness().load("src/lib/alinflow/google-contacts-model.ts");
const sourceLib = harness({}, { "node:crypto": require("node:crypto") }).load("src/lib/alinflow/google-contacts-source.ts");
function person(extra = {}) { return { resourceName: "people/c123", metadata: { sources: [{ type: "CONTACT", id: "123", etag: "v1" }] },
  names: [{ unstructuredName: "Személyes név" }], phoneNumbers: [{ value: source.phone }], biographies: [{ value: "Személyes jegyzet", contentType: "TEXT_PLAIN" }], ...extra }; }
class ApiError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
class GoogleContactsAuthError extends Error {}
function fixture(options = {}) {
  const connection = { workspace_id: WS, google_subject: "subject", google_email: "owner@example.invalid", status: "active", refresh_token_encrypted: "encrypted",
    lease_token: "lease", lease_expires_at: new Date(Date.now() + 120000).toISOString(), ...options.connection };
  const links = options.links || [{ customer_id: CUSTOMER, resource_name: null, state: "pending", approved_source_hash: source.sourceHash,
    synced_source_hash: null, managed_snapshot: null, last_error: null, next_sync_at: new Date(0).toISOString() }];
  const sources = options.sources || [source], calls = [], writes = [], rpcCalls = [];
  const previews = [];
  const admin = database(op => {
    assert.equal(op.filters.workspace_id || op.filters.id || op.value?.workspace_id, WS, `${op.table} must remain scoped`);
    if (op.table === "workspaces") return { data: options.inactiveWorkspace ? null : { id: WS } };
    if (op.table === "google_contacts_connections") {
      if (op.method === "update") { Object.assign(connection, op.value); return { data: null }; }
      if (options.currentConnection) return { data: { ...connection, ...options.currentConnection } };
      return { data: { ...connection } };
    }
    if (op.table === "google_contacts_link_members") return { data: options.members || [] };
    if (op.table === "google_contacts_links") {
      if (op.method === "update") {
        writes.push(structuredClone(op.value));
        if (options.failSave?.(op.value)) return { error: { message: "database failure" } };
        Object.assign(links.find(item => item.customer_id === op.filters.customer_id), op.value);
        return { data: null };
      }
      return { data: links.map(item => ({ ...item })) };
    }
    if (op.table === "google_contacts_previews") {
      if (op.method === "insert") { previews.push(op.value); return { data: null }; }
      if (op.method === "delete") return { data: null };
      return { data: options.preview || previews[0] || null };
    }
    throw Error("Unexpected table " + op.table);
  });
  admin.rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    if (name === "claim_google_contacts_sync") return { data: [{ ...connection }] };
    if (name === "release_google_contacts_sync") return { data: true };
    if (name === "approve_google_contacts_links") return { data: args.p_items.length };
    throw Error("Unexpected RPC " + name);
  };
  const auth = { contactsAdmin: () => admin, contactsAccessToken: async () => "access", GoogleContactsAuthError };
  const responses = [...(options.responses || [])];
  const worker = harness({ AbortSignal, URLSearchParams, fetch: async (url, init) => {
    const call = { url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call); options.onRequest?.(call, links, connection);
    const response = responses.length ? responses.shift() : options.respond?.(call) || { status: 200, body: { connections: [] } };
    if (response.error) throw Error(response.error);
    return new Response(JSON.stringify(response.body || {}), { status: response.status || 200 });
  } }, { "node:crypto": require("node:crypto"), "./google-contacts-auth": auth, "./server-auth": { ApiError },
    "./google-contacts-source": { ...sourceLib, loadGoogleContactSources: async () => sources } }).load("src/lib/alinflow/google-contacts-sync.ts");
  return { worker, connection, links, calls, writes, rpcCalls, previews };
}

test("full phonebook pagination preserves request parameters and rejects incomplete results", async () => {
  const f = fixture({ responses: [{ body: { connections: [person()], nextPageToken: "next", totalItems: 2 } }, { body: { connections: [person({ resourceName: "people/c456" })], totalItems: 2 } }] });
  const contacts = await f.worker.listGoogleContacts("access");
  assert.equal(contacts.length, 2);
  const first = new URL(f.calls[0].url), second = new URL(f.calls[1].url);
  assert.equal(first.searchParams.get("sources"), "READ_SOURCE_TYPE_CONTACT");
  assert.equal(second.searchParams.get("personFields"), first.searchParams.get("personFields"));
  assert.equal(second.searchParams.get("pageToken"), "next");
  const incomplete = fixture({ responses: [{ body: { connections: [], totalItems: 4 } }] });
  await assert.rejects(incomplete.worker.listGoogleContacts("access"));
});

test("repeated page token fails closed without treating partial list as no match", async () => {
  const f = fixture({ responses: [{ body: { connections: [], nextPageToken: "same" } }, { body: { connections: [], nextPageToken: "same" } }] });
  await assert.rejects(f.worker.listGoogleContacts("access"));
});

test("non-idempotent create intent is saved before POST and stable mapping afterward", async () => {
  const f = fixture({ responses: [{ body: { connections: [] } }, { body: person(model.buildContactCreate(source, MARKER).body) }],
    onRequest(call, links) { if (call.method === "POST") { assert.equal(links[0].state, "creating"); assert.equal(links[0].managed_snapshot.marker, MARKER); } } });
  const result = await f.worker.runGoogleContactsSync(WS);
  assert.equal(result.synced, 1); assert.equal(f.links[0].resource_name, "people/c123"); assert.equal(f.links[0].state, "synced");
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  assert.equal(f.calls[1].body.userDefined[0].value, MARKER);
});

test("ambiguous create timeout is never retried with a second POST", async () => {
  const f = fixture({ responses: [{ body: { connections: [] } }, { error: "timeout" }] });
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.links[0].state, "uncertain");
  f.links[0].next_sync_at = new Date(0).toISOString();
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  assert.equal(f.links[0].resource_name, null);
});

test("database failure after successful creation retains uncertainty instead of recreating", async () => {
  let rejectRemoteSave = true;
  const f = fixture({ responses: [{ body: { connections: [] } }, { body: person(model.buildContactCreate(source, MARKER).body) }],
    failSave(patch) { if (patch.resource_name && rejectRemoteSave) { rejectRemoteSave = false; return true; } return false; } });
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.links[0].state, "uncertain");
  f.links[0].next_sync_at = new Date(0).toISOString();
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});

test("uncertain create recovers exact stable marker and updates without POST", async () => {
  const created = model.buildContactCreate(source, MARKER), remote = person(created.body);
  const f = fixture({ links: [{ customer_id: CUSTOMER, resource_name: null, state: "uncertain", approved_source_hash: source.sourceHash,
    synced_source_hash: source.sourceHash, managed_snapshot: created.managed, next_sync_at: new Date(0).toISOString() }],
    responses: [{ body: { connections: [remote] } }, { body: remote }] });
  const result = await f.worker.runGoogleContactsSync(WS);
  assert.equal(result.synced, 1); assert.equal(f.links[0].resource_name, "people/c123");
  assert.equal(f.calls.filter(call => call.method !== "GET").length, 0);
});

test("matching contact appearing after approval blocks create", async () => {
  const f = fixture({ responses: [{ body: { connections: [person()] } }] });
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.links[0].state, "review"); assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
});

test("changed source after initial approval requires review", async () => {
  const f = fixture({ sources: [{ ...source, sourceHash: "b".repeat(64) }] });
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.links[0].state, "review"); assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
});

test("paused connection or superseded token cannot issue Google writes", async () => {
  const f = fixture({ currentConnection: { status: "paused" } });
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.calls.length, 0);
});

test("successful in-flight POST identity is retained if connection is paused", async () => {
  const f = fixture({ responses: [{ body: { connections: [] } }, { body: person(model.buildContactCreate(source, MARKER).body) }],
    onRequest(call, links, connection) { if (call.method === "POST") connection.status = "paused"; } });
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.connection.status, "paused"); assert.equal(f.links[0].resource_name, "people/c123");
});

test("deleted Google contact is retained as a review mapping, never recreated", async () => {
  const f = fixture(); f.links[0].resource_name = "people/c123";
  const g = fixture({ links: f.links, responses: [{ status: 404 }] });
  await g.worker.runGoogleContactsSync(WS);
  assert.equal(g.links[0].state, "review"); assert.equal(g.calls.length, 1); assert.equal(g.calls[0].method, "GET");
});

test("initial existing match preserves personal name and note and retries changed ETag safely", async () => {
  const f = fixture(); f.links[0].resource_name = "people/c123";
  const remote = person(), changed = person({ metadata: { sources: [{ type: "CONTACT", id: "123", etag: "v2" }] }, biographies: [{ value: "Új személyes jegyzet", contentType: "TEXT_PLAIN" }] });
  const g = fixture({ links: f.links, responses: [{ body: remote }, { status: 400 }, { body: changed }, { body: changed }] });
  await g.worker.runGoogleContactsSync(WS);
  const patches = g.calls.filter(call => call.method === "PATCH");
  assert.equal(patches.length, 2);
  assert.equal(patches[1].body.metadata.sources[0].etag, "v2");
  assert.match(patches[1].body.biographies[0].value, /Új személyes jegyzet/);
  assert.equal(patches[1].body.names, undefined);
  assert.equal(g.links[0].state, "synced");
});

test("source no longer eligible never exports and never deletes existing Google contact", async () => {
  const f = fixture({ sources: [] });
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.calls.length, 0); assert.equal(f.links[0].state, "review");
});

test("preview uses exact phone/email only and blocks shared local identifiers", () => {
  const f = fixture();
  const p = f.worker.buildContactPreview(WS, [source], [person({ phoneNumbers: [], names: [{ unstructuredName: source.name }] })], []);
  assert.equal(p.items[0].state, "new");
  assert.equal(p.proofs[0].options[0], null);
  const duplicates = f.worker.buildContactPreview(WS, [source, { ...source, customerId: USER }], [], []);
  assert.equal(duplicates.items[0].state, "review"); assert.equal(duplicates.proofs.length, 0);
});

test("approval validates unchanged source and fresh remote candidate against reviewed proof", async () => {
  const f = fixture({ links: [] });
  const proof = f.worker.buildContactPreview(WS, [source], [], []).proofs;
  const g = fixture({ links: [], sources: [{ ...source, sourceHash: "b".repeat(64) }], preview: {
    id: PREVIEW, workspace_id: WS, user_id: USER, google_subject: "subject", expires_at: new Date(Date.now() + 60000).toISOString(), proofs: proof } });
  await assert.rejects(g.worker.approveGoogleContacts(WS, USER, PREVIEW, [{ customerId: CUSTOMER, resourceName: null, sourceHash: source.sourceHash }]), /változtak/);
  assert.equal(g.rpcCalls.length, 0); assert.equal(g.calls.filter(call => call.method !== "GET").length, 0);
});


test("truncated per-person contact fields fail closed", async () => {
  const f = fixture({ responses: [{ body: { connections: [person({ phoneNumbers: Array.from({ length: 100 }, (_, i) => ({ value: `+3630123${String(i).padStart(4, "0")}` })) })] } }] });
  await assert.rejects(f.worker.listGoogleContacts("access"), /elérhetőséget/);
});

test("repurposed matched Google contact is rechecked before first update", async () => {
  const f = fixture(); f.links[0].resource_name = "people/c123";
  const g = fixture({ links: f.links, responses: [{ body: person({ phoneNumbers: [{ value: "+36709999999" }] }) }] });
  await g.worker.runGoogleContactsSync(WS);
  assert.equal(g.links[0].state, "review"); assert.equal(g.calls.filter(call => call.method === "PATCH").length, 0);
});

test("only never-attempted review mappings may return to explicit preview approval", () => {
  const f = fixture(); f.links[0].state = "review";
  const retry = f.worker.buildContactPreview(WS, [source], [], f.links);
  assert.equal(retry.items[0].state, "new"); assert.equal(retry.proofs.length, 1);
  f.links[0].state = "uncertain";
  assert.equal(f.worker.buildContactPreview(WS, [source], [], f.links).proofs.length, 0);
  f.links[0].state = "review"; f.links[0].mutation_snapshot = model.buildContactCreate(source, MARKER).managed;
  assert.equal(f.worker.buildContactPreview(WS, [source], [], f.links).proofs.length, 0);
});

test("uncertain PATCH recovers its exact applied snapshot without duplicate note", async () => {
  const remote = person(), mutation = model.mergeContactUpdate(source, remote, null, MARKER);
  assert.equal(mutation.ok, true);
  const changed = { ...remote, ...mutation.body };
  const f = fixture(); f.links[0].resource_name = "people/c123";
  const g = fixture({ links: f.links, responses: [{ body: remote }, { error: "timeout after applied" }, { body: changed }] });
  await g.worker.runGoogleContactsSync(WS);
  assert.ok(g.links[0].mutation_snapshot); assert.equal(g.links[0].managed_snapshot, null);
  g.links[0].next_sync_at = new Date(0).toISOString();
  await g.worker.runGoogleContactsSync(WS);
  assert.equal(g.links[0].state, "synced"); assert.equal(g.links[0].mutation_snapshot, null);
  assert.equal(g.calls.filter(call => call.method === "PATCH").length, 1);
});

const MEMBER = "55555555-5555-4555-8555-555555555555";
const OUTSIDE = "66666666-6666-4666-8666-666666666666";
function grouped() {
  const second = { ...source, customerId: MEMBER, name: "Másik névalak", phone: "+36709998888", email: "other@example.invalid", notes: "Második telepítés", sourceHash: "b".repeat(64) };
  const group = { anchorCustomerId: CUSTOMER, memberCustomerIds: [CUSTOMER, MEMBER] };
  const combined = sourceLib.groupGoogleContactSources([source, second], [group]).sources[0];
  const members = group.memberCustomerIds.map(customer_id => ({ customer_id, anchor_customer_id: CUSTOMER }));
  return { second, group, combined, members };
}
test("group preview binds all explicit members and matches the second member's identifier", async () => {
  const { second, group } = grouped();
  const f = fixture({ links: [], sources: [source, second], responses: [{ body: { connections: [person({ phoneNumbers: [{ value: second.phone }] })] } }] });
  const preview = await f.worker.previewGoogleContactGroups(WS, USER, [group]);
  assert.equal(preview.items.length, 1); assert.equal(preview.items[0].state, "match");
  assert.equal(preview.items[0].members.length, 2); assert.equal(preview.items[0].phones.length, 2);
  assert.equal(f.previews[0].proofs[0].memberCustomerIds.length, 2);
  assert.doesNotMatch(JSON.stringify(f.previews[0].proofs), /Teszt Ügyfél|Másik névalak|example.invalid/);
  assert.equal(f.calls.filter(call => call.method !== "GET").length, 0);
});
test("third-party local collisions stay blocked despite explicit same-person grouping", async () => {
  const { second, group } = grouped();
  const f = fixture({ links: [], sources: [source, second, { ...source, customerId: OUTSIDE, name: "Másik személy" }] });
  const preview = await f.worker.previewGoogleContactGroups(WS, USER, [group]);
  assert.equal(preview.items[0].state, "review"); assert.equal(f.previews[0].proofs.length, 0);
});
test("group proposals reject linked members, missing own sources and overlapping selection", async () => {
  const { second, group } = grouped();
  for (const options of [{ links: [{ customer_id: CUSTOMER }], sources: [source, second] }, { links: [], sources: [source] }]) {
    const f = fixture(options); await assert.rejects(f.worker.previewGoogleContactGroups(WS, USER, [group]), /saját telepítéssel/);
    assert.equal(f.previews.length, 0);
  }
  const f = fixture({ links: [], sources: [source, second] });
  await assert.rejects(f.worker.previewGoogleContactGroups(WS, USER, [group, group]), /fedhetik/);
});
test("approval rechecks a secondary member hash and never writes after source change", async () => {
  const { second, group } = grouped();
  const first = fixture({ links: [], sources: [source, second] });
  const preview = await first.worker.previewGoogleContactGroups(WS, USER, [group]);
  const f = fixture({ links: [], sources: [source, { ...second, sourceHash: "c".repeat(64) }], preview: first.previews[0] });
  await assert.rejects(f.worker.approveGoogleContacts(WS, USER, preview.previewId,
    [{ customerId: CUSTOMER, sourceHash: preview.items[0].sourceHash, resourceName: null }]), /változtak/);
  assert.equal(f.rpcCalls.length, 0);
});
test("approved group creates one contact with both phones and all work notes", async () => {
  const { second, combined, members } = grouped();
  const created = model.buildContactCreate(combined, MARKER);
  const f = fixture({ sources: [source, second], members, responses: [{ body: { connections: [] } }, { body: person(created.body) }] });
  f.links[0].approved_source_hash = combined.sourceHash;
  await f.worker.runGoogleContactsSync(WS);
  const posts = f.calls.filter(call => call.method === "POST");
  assert.equal(posts.length, 1); assert.equal(posts[0].body.phoneNumbers.length, 2);
  assert.match(posts[0].body.biographies[0].value, /Második telepítés/);
  assert.equal(f.links[0].managed_snapshot.version, 2); assert.equal(f.links[0].state, "synced");
});
test("missing group member stops worker without partial Google export", async () => {
  const { combined, members } = grouped();
  const f = fixture({ members }); f.links[0].approved_source_hash = combined.sourceHash;
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.calls.length, 0); assert.equal(f.links[0].state, "review"); assert.match(f.links[0].last_error, /egyik ügyfele/);
});
test("grouped worker checks unrelated identifiers before updating an existing Google target", async () => {
  const { second, combined, members } = grouped();
  const f = fixture({ members, sources: [source, second, { ...source, customerId: OUTSIDE }] });
  Object.assign(f.links[0], { resource_name: "people/c123", state: "synced", managed_snapshot: model.buildContactCreate(combined, MARKER).managed });
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.calls.length, 0); assert.equal(f.links[0].state, "review");
});
test("normal preview collapses approved group and shows separate represented-customer count", async () => {
  const { second, members } = grouped();
  const f = fixture({ sources: [source, second], members });
  const preview = await f.worker.previewGoogleContacts(WS, USER);
  assert.equal(preview.items.length, 1); assert.equal(preview.items[0].state, "linked"); assert.equal(preview.items[0].groupable, false);
  assert.equal(await f.worker.countGoogleContactsRepresentedCustomers(WS, 1), 2);
});

test("unchanged group approval submits only the reviewed anchor while proof retains immutable members", async () => {
  const { second, group } = grouped();
  const f = fixture({ links: [], sources: [source, second] });
  const preview = await f.worker.previewGoogleContactGroups(WS, USER, [group]);
  const result = await f.worker.approveGoogleContacts(WS, USER, preview.previewId,
    [{ customerId: CUSTOMER, sourceHash: preview.items[0].sourceHash, resourceName: null, memberCustomerIds: [CUSTOMER, OUTSIDE] }]);
  assert.equal(result.approved, 1);
  const approval = f.rpcCalls.find(call => call.name === "approve_google_contacts_links");
  assert.equal(approval.args.p_items[0].customerId, CUSTOMER);
  assert.equal(approval.args.p_items[0].memberCustomerIds, undefined);
  assert.deepEqual([...f.previews[0].proofs[0].memberCustomerIds], [CUSTOMER, MEMBER]);
  assert.equal(f.calls.filter(call => call.method !== "GET").length, 0);
});
test("group creation uncertainty recovers the same anchor marker without another POST", async () => {
  const { second, combined, members } = grouped(), created = model.buildContactCreate(combined, MARKER);
  const remote = person(created.body);
  const f = fixture({ sources: [source, second], members, responses: [{ body: { connections: [] } }, { error: "timeout after applied" },
    { body: { connections: [remote] } }, { body: remote }] });
  f.links[0].approved_source_hash = combined.sourceHash;
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.links[0].state, "uncertain"); assert.equal(f.links[0].managed_snapshot.version, 2);
  f.links[0].next_sync_at = new Date(0).toISOString();
  await f.worker.runGoogleContactsSync(WS);
  assert.equal(f.links[0].state, "synced"); assert.equal(f.links[0].resource_name, "people/c123");
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  assert.equal(f.calls.filter(call => call.method === "PATCH").length, 0);
});
test("a missing member in another group cannot hide an external identifier collision", async () => {
  const { second, group } = grouped();
  const hiddenAnchor = OUTSIDE, absentMember = "77777777-7777-4777-8777-777777777777";
  const f = fixture({ links: [{ customer_id: hiddenAnchor, state: "synced", resource_name: "people/other" }],
    sources: [source, second, { ...source, customerId: hiddenAnchor }], members: [
      { customer_id: hiddenAnchor, anchor_customer_id: hiddenAnchor }, { customer_id: absentMember, anchor_customer_id: hiddenAnchor }] });
  const preview = await f.worker.previewGoogleContactGroups(WS, USER, [group]);
  assert.equal(preview.items[0].state, "review"); assert.equal(f.previews[0].proofs.length, 0);
});
