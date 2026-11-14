const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database } = require("./helpers.cjs");
const w = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
const c = "20000000-0000-4000-8000-000000000001", a = "30000000-0000-4000-8000-000000000001";
const grant = "40000000-0000-4000-8000-000000000001", userId = "90000000-0000-4000-8000-000000000001";
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ["2026-11-14T10:00:00Z"])); } }
const h = harness();
const { buildMaintenanceContactSms } = h.load("src/lib/alinflow/maintenance-contact-sms.ts");
const { defaultWorkspaceSettings } = h.load("src/lib/alinflow/workspace-settings.ts");
const { countSmsSegments, smsComposerHref } = h.load("src/lib/alinflow/sms-reminders.ts");
function settings() {
  const value = defaultWorkspaceSettings({ name: "Teszt Klíma", slug: "synthetic" });
  Object.assign(value.companyProfile, { displayName: "Teszt Klíma", legalName: "Teszt Karbantartó E.V.", phone: "06 70 123 4567" });
  return value;
}
test("own draft preserves the saved full name, accents, current brand and callback number", () => {
  const draft = buildMaintenanceContactSms({ name: "  Teszt\n Anna  ", phone: "06 30 123 4567" }, settings());
  assert.equal(draft.customerName, "Teszt Anna");
  assert.equal(draft.phone, "+36301234567");
  assert.equal(draft.text, "Kedves Teszt Anna! Klímakarbantartás egyeztetése miatt kerestük telefonon, de nem értük el. Kérjük, hívjon vissza: +36701234567. Köszönjük! Teszt Klíma");
  assert.deepEqual(draft.encoding, countSmsSegments(draft.text));
  for (const platform of ["ios", "android"]) assert.equal(decodeURIComponent(smsComposerHref(draft.phone, draft.text, platform).split("body=")[1]), draft.text);
});
test("shared draft names the source and actual provider, never claims a placed order", () => {
  const draft = buildMaintenanceContactSms({ name: "Teszt Béla", phone: "+36301234567" }, settings(), "Forrás Klíma");
  assert.match(draft.text, /Forrás Klíma nevében kerestük/);
  assert.match(draft.text, /Köszönjük! Teszt Karbantartó E\.V\.$/);
  assert.match(draft.text, /\+36701234567/);
  assert.doesNotMatch(draft.text, /megrendel|érkezünk|időpontja/);
});
test("missing name, invalid recipient and missing callback have honest fallbacks", () => {
  const company = settings(); company.companyProfile.phone = "";
  const draft = buildMaintenanceContactSms({ name: "123", phone: "06301234567;06701234567" }, company);
  assert.equal(draft.phone, null);
  assert.match(draft.text, /^Kedves Ügyfelünk!/);
  assert.match(draft.text, /hívjon vissza ezen a számon/);
  assert.doesNotMatch(draft.text, /700.4908|KLIMAlin/);
});
test("shared provider falls back to its own display name when legal name is blank", () => {
  const company = settings(); company.companyProfile.legalName = "";
  assert.match(buildMaintenanceContactSms({ name: "Anna", phone: "" }, company, "Forrás").text, /Köszönjük! Teszt Klíma$/);
});

function fixture(options = {}) {
  const queries = [], rpcCalls = [];
  const data = {
    workspaces: [{ id: w, name: "Teszt Klíma", slug: "synthetic", active: true }],
    workspace_members: [{ workspace_id: w, user_id: userId, active: true }],
    workspace_settings: [{ workspace_id: w, company_profile: settings().companyProfile }],
    appointments: [{ id: a, workspace_id: w, customer_id: c, appointment_type: "installation", scheduled_date: "2025-10-18", status: "Lezárva", cancelled_at: null, maintenance_opt_out: false }],
    customers: [{ id: c, workspace_id: w, name: "Teszt Anna", phone: "06 30 123 4567" }],
    ...options.data,
  };
  const shared = [{ grantId: grant, installationId: a, sourceWorkspaceId: other, sourceWorkspaceName: "Forrás Klíma",
    customer: { name: "Megosztott Ügyfél", phone: "06 20 123 4567" }, maintenanceOptOut: false }];
  const preferences = [];
  const db = database(op => {
    queries.push(op);
    assert.equal(op.method, "select", "SMS preparation must not mutate business records");
    if (options.failTable === op.table) return { error: { message: "private database detail" }, data: null };
    assert.ok(Object.hasOwn(data, op.table), "Unexpected table " + op.table);
    const result = data[op.table].filter(row => Object.entries(op.filters).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
    return { data: op.single ? result[0] || null : result, error: null };
  });
  db.auth = { getUser: async () => ({ data: { user: options.signedOut ? null : { id: userId } }, error: null }) };
  db.rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    assert.ok(["list_received_maintenance_installations", "list_maintenance_contact_preferences"].includes(name), "No mutating RPC may be called");
    if (options.rpcError) return { data: null, error: { code: options.rpcError, message: "private database detail" } };
    return { data: name === "list_received_maintenance_installations" ? shared : preferences, error: null };
  };
  const route = harness({ Date: FixedDate, process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-public" } } },
    { "@supabase/supabase-js": { createClient: () => db } }).load("src/app/api/maintenance-contact-sms/route.ts");
  const get = (changes = {}, headers = { Authorization: "Bearer test" }) => {
    const query = new URLSearchParams({ workspaceId: w, type: "own", customerId: c, installationId: a, ...changes });
    return route.GET(new Request(`https://example.test/api/maintenance-contact-sms?${query}`, { headers }));
  };
  return { data, queries, rpcCalls, shared, preferences, route, get };
}
function preference(extra = {}) {
  return { installationId: a, sourceInstallationId: a, sourceWorkspaceId: w, sourceWorkspaceName: "Teszt Klíma",
    choice: "open", updatedAt: "2026-11-14T08:00:00Z", isSource: true, ...extra };
}
async function draft(f, changes) {
  const response = await f.get(changes);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Authorization");
  return (await response.json()).draft;
}
test("API only reads saved recipient and workspace identity, ignoring spoofed query text", async () => {
  const f = fixture(), before = JSON.stringify(f.data);
  const result = await draft(f, { text: "Forged", phone: "+19999999999", sourceWorkspaceName: "Wrong", brand: "Foreign" });
  assert.equal(result.phone, "+36301234567"); assert.match(result.text, /Teszt Klíma$/); assert.doesNotMatch(result.text, /Forged|Foreign|Wrong/);
  assert.ok(f.queries.every(op => op.table === "workspaces" || op.filters.workspace_id === w));
  assert.deepEqual(f.rpcCalls.map(row => row.name), ["list_maintenance_contact_preferences"]);
  assert.equal(JSON.stringify(f.data), before); assert.equal(f.route.POST, undefined);
});
test("missing auth, expired session, foreign or inactive workspace never expose customers", async () => {
  let f = fixture(); assert.equal((await f.get({}, {})).status, 401); assert.equal(f.queries.length, 0);
  f = fixture({ signedOut: true }); assert.equal((await f.get()).status, 401); assert.equal(f.queries.length, 0);
  for (const [mutate, query] of [[f => f.data.workspaces[0].active = false, {}], [f => f.data.workspace_members[0].active = false, {}], [() => {}, { workspaceId: other }]]) {
    f = fixture(); mutate(f); assert.equal((await f.get(query)).status, 403);
    assert.equal(f.queries.some(op => op.table === "customers"), false); assert.equal(f.rpcCalls.length, 0);
  }
});
test("invalid target or foreign installation/customer binding cannot produce a draft", async () => {
  for (const [changes, status] of [[{ type: "other" }, 400], [{ installationId: "shared:fake" }, 400], [{ customerId: other }, 404], [{ installationId: other }, 404]]) {
    const f = fixture(); assert.equal((await f.get(changes)).status, status); assert.equal(f.rpcCalls.length, 0);
  }
});
test("future, cancelled, uncompleted and noninstallation works cannot be contacted", async () => {
  for (const change of [{ status: "Időpont foglalva" }, { status: "Lemondva" }, { cancelled_at: "2026-11-14" },
    { appointment_type: "maintenance" }, { scheduled_date: "2026-11-15" }, { scheduled_date: "invalid" }, { scheduled_date: null }]) {
    const f = fixture(); Object.assign(f.data.appointments[0], change); assert.equal((await f.get()).status, 404);
    assert.equal(f.rpcCalls.length, 0);
  }
});
test("finished admin work and accepted external installations keep own provider text", async () => {
  for (const change of [{ status: "Szerelés kész – admin folyamatban" }, { maintenance_origin: "external" }]) {
    const f = fixture(); Object.assign(f.data.appointments[0], change);
    assert.doesNotMatch((await draft(f)).text, /nevében/);
  }
});
test("whole refusal blocks contact, explicit reopening overrides legacy opt-out", async () => {
  const f = fixture(); f.data.appointments[0].maintenance_opt_out = true;
  assert.equal((await f.get()).status, 409);
  f.preferences.push(preference()); assert.ok(await draft(f));
  f.preferences[0].choice = "declined"; assert.equal((await f.get()).status, 409);
});
test("original-installer choice permits the source but prevents recipient outreach", async () => {
  const f = fixture(); f.preferences.push(preference({ choice: "original_installer" })); assert.ok(await draft(f));
  f.preferences[0].isSource = false; assert.equal((await f.get()).status, 409);
});
test("partial unit refusal remains neutral outreach, unrelated choices do not block it", async () => {
  const f = fixture(); f.preferences.push(preference({ declinedDevices: [{ productName: "Teszt klíma", unitNumber: 1 }] }));
  assert.match((await draft(f)).text, /Klímakarbantartás/);
  f.preferences[0] = preference({ installationId: other, choice: "declined" }); assert.ok(await draft(f));
});
test("shared RPC supplies exact permitted source and recipient without source table access", async () => {
  const f = fixture(), result = await draft(f, { type: "shared", grantId: grant });
  assert.equal(result.customerName, "Megosztott Ügyfél"); assert.equal(result.phone, "+36201234567");
  assert.match(result.text, /Forrás Klíma nevében/); assert.match(result.text, /Teszt Karbantartó E\.V\.$/); assert.match(result.text, /\+36701234567/);
  assert.deepEqual(JSON.parse(JSON.stringify(f.rpcCalls[0])), { name: "list_received_maintenance_installations", args: { p_target_workspace_id: w } });
  assert.equal(f.queries.some(op => op.table === "appointments" || op.table === "customers"), false);
});
test("revoked grants, wrong exact grant/installation and duplicate shared records fail closed", async () => {
  for (const kind of ["revoked", "grant", "installation", "duplicate"]) {
    const f = fixture();
    if (kind === "revoked") f.shared.length = 0;
    if (kind === "duplicate") f.shared.push({ ...f.shared[0] });
    assert.equal((await f.get({ type: "shared", grantId: kind === "grant" ? other : grant, installationId: kind === "installation" ? other : a })).status, 404);
  }
});
test("shared refusal and original-installer choice block drafting, exact source binding matters", async () => {
  const f = fixture(), query = { type: "shared", grantId: grant };
  f.shared[0].maintenanceOptOut = true; assert.equal((await f.get(query)).status, 409);
  f.preferences.push(preference({ isSource: false, sourceWorkspaceId: other })); assert.ok(await draft(f, query));
  for (const choice of ["declined", "original_installer"]) { f.preferences[0].choice = choice; assert.equal((await f.get(query)).status, 409); }
  f.shared[0].maintenanceOptOut = false; f.preferences[0].sourceWorkspaceId = w; assert.ok(await draft(f, query));
});
test("read failures and malformed preferences fail safely without leaking database details", async () => {
  for (const options of [{ failTable: "customers" }, { failTable: "workspace_settings" }, { rpcError: "unexpected" }, { rpcError: "42501" }]) {
    const f = fixture(options), response = await f.get(); assert.equal(response.status, options.rpcError === "42501" ? 403 : 503);
    assert.doesNotMatch(await response.text(), /private database detail/);
  }
  const f = fixture(); f.preferences.push({ choice: "open" }); assert.equal((await f.get()).status, 503);
});
test("invalid phone stays visible as uncomposable without accidental multiple recipients", async () => {
  const f = fixture(); f.data.customers[0].phone = "+36301234567,+36701234567"; assert.equal((await draft(f)).phone, null);
});
