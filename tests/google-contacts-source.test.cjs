const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, database } = require("./helpers.cjs");
const { projectGoogleContactSources: project, loadGoogleContactSources: load } = harness({}, { "node:crypto": require("node:crypto") })
  .load("src/lib/alinflow/google-contacts-source.ts");
const workspace = "workspace-one";
const customer = (extra = {}) => ({ id: "customer-one", workspace_id: workspace, name: "Teszt Ügyfél", phone: "06301234567",
  email: "test@example.invalid", postal_code: "1111", city: "Budapest", address: "Példa utca 1.", notes: "Titkos belső jegyzet", ...extra });
const installation = (extra = {}) => ({ id: "installation-one", workspace_id: workspace, customer_id: "customer-one", quote_id: "quote-one",
  scheduled_date: "2026-01-02", appointment_type: "installation", status: "Lezárva", maintenance_origin: "own", cancelled_at: null, ...extra });
const rows = (extra = {}) => ({ customers: [customer()], appointments: [installation()],
  quotes: [{ id: "quote-one", workspace_id: workspace, customer_id: "customer-one", notes: "quote_pricing_mode:bundle" }],
  quoteItems: [{ id: "item-one", workspace_id: workspace, quote_id: "quote-one", product_name: "Teszt klíma", quantity: 2, unit_price: 999999 }],
  devices: [], maintenanceLinks: [], excludedInstallationIds: [], ...extra });
const today = "2026-10-15";

test("only actual past own installations are exported; future, survey, canceled and handoff copies excluded", () => {
  const input = rows({ appointments: [installation(),
    installation({ id: "future", scheduled_date: "2026-11-01" }), installation({ id: "survey", appointment_type: "survey" }),
    installation({ id: "booked", status: "Időpont foglalva" }), installation({ id: "cancelled", cancelled_at: "2026-02-01" }),
    installation({ id: "external", maintenance_origin: "external" }), installation({ id: "handoff" }),
    installation({ id: "otherworkspace", workspace_id: "workspace-other" }), installation({ id: "bad-date", scheduled_date: "2026-02-30" }),
  ], excludedInstallationIds: ["handoff"] });
  const actual = project(input, workspace, today);
  assert.equal(actual.length, 1);
  assert.equal(actual[0].notes.split("Telepítés:").length - 1, 1);
  assert.equal(actual[0].address, "1111 Budapest, Példa utca 1.");
  assert.equal(actual[0].notes, "Telepítés: 2026.01.02 – 1111 Budapest, Példa utca 1.\n2 db Teszt klíma");
  assert.doesNotMatch(JSON.stringify(actual), /Titkos|999999|unit_price|notes.*belső/);
});

test("admin-in-progress actual work qualifies and several installations become a single contact", () => {
  const actual = project(rows({ appointments: [installation(), installation({ id: "second", scheduled_date: "2026-02-03",
    status: "Szerelés kész – admin folyamatban", address: "2222 Másváros, Példa tér 2." })] }), workspace, today);
  assert.equal(actual.length, 1);
  assert.equal(actual[0].notes.split("Telepítés:").length - 1, 2);
  assert.match(actual[0].notes, /2026.02.03 – 2222 Másváros, Példa tér 2\./);
  assert.doesNotMatch(actual[0].notes, /1111 Budapest, 2222/);
});

test("only correctly scoped device details and last completed linked maintenance date appear", () => {
  const input = rows({ appointments: [installation(),
    installation({ id: "maintenance-old", appointment_type: "maintenance", scheduled_date: "2026-03-01" }),
    installation({ id: "maintenance-new", appointment_type: "maintenance", scheduled_date: "2026-04-01" }),
    installation({ id: "maintenance-future", appointment_type: "maintenance", scheduled_date: "2026-12-01" }),
    installation({ id: "maintenance-booked", appointment_type: "maintenance", scheduled_date: "2026-05-01", status: "Időpont foglalva" }),
  ], devices: [{ id: "device-one", workspace_id: workspace, customer_id: "customer-one", appointment_id: "installation-one",
    product_key: "synthetic", product_name: "Teszt klíma", unit_number: 1,
    data: { manufacturer: "Teszt gyártó", indoorModel: "MODEL-IN", outdoorModel: "MODEL-OUT", indoorSerial: "SN-IN", outdoorSerial: "SN-OUT", notes: "Ne exportáld" } },
    { id: "device-wrong", workspace_id: "workspace-other", customer_id: "customer-one", appointment_id: "installation-one", data: { indoorSerial: "PRIVATE-SERIAL" } }],
    maintenanceLinks: ["maintenance-old", "maintenance-new", "maintenance-future", "maintenance-booked"].map((id) => ({ id,
      workspace_id: workspace, customer_id: "customer-one", installation_appointment_id: "installation-one", maintenance_appointment_id: id })),
  });
  const actual = project(input, workspace, today)[0];
  for (const text of ["Teszt gyártó", "MODEL-IN", "MODEL-OUT", "SN-IN", "SN-OUT", "Utolsó rögzített karbantartás: 2026.04.01"]) assert.ok(actual.notes.includes(text));
  assert.doesNotMatch(actual.notes, /Ne exportáld|PRIVATE-SERIAL|2026.12.01|2026.05.01/);
});

test("quote from another customer and alternative quote choices are never treated as installed equipment", () => {
  const wrong = rows({ quotes: [{ id: "quote-one", workspace_id: workspace, customer_id: "customer-other" }] });
  assert.doesNotMatch(project(wrong, workspace, today)[0].notes, /Teszt klíma/);
  const alternative = rows({ quotes: [{ id: "quote-one", workspace_id: workspace, customer_id: "customer-one", notes: "quote_pricing_mode:alternatives" }] });
  assert.doesNotMatch(project(alternative, workspace, today)[0].notes, /2 db Teszt klíma/);
  assert.match(project(alternative, workspace, today)[0].notes, /nincs véglegesítve/);
});

test("hash is deterministic and changes only when exported data changes", () => {
  const first = project(rows(), workspace, today)[0];
  const privateChange = project(rows({ customers: [customer({ notes: "más belső jegyzet" })] }), workspace, today)[0];
  assert.equal(first.sourceHash, privateChange.sourceHash);
  const changed = project(rows({ customers: [customer({ phone: "06307654321" })] }), workspace, today)[0];
  assert.notEqual(first.sourceHash, changed.sourceHash);
  assert.match(first.sourceHash, /^[a-f0-9]{64}$/);
});

test("source loader scopes and paginates every table and provenance RPC without truncation", async () => {
  const calls = [];
  const admin = database((op) => {
    calls.push(op);
    assert.equal(op.filters.workspace_id, workspace);
    assert.ok(op.order.includes("id"));
    const total = op.table === "customers" ? 501 : 0;
    const result = Array.from({ length: Math.max(0, Math.min(op.range[1] + 1, total) - op.range[0]) }, (_, offset) => customer({ id: `customer-${offset + op.range[0]}` }));
    return { data: result, error: null };
  });
  const rpcCalls = [];
  admin.rpc = (name, args) => ({ order(column) {
    assert.equal(name, "google_contacts_excluded_installations");
    assert.equal(args.p_workspace_id, workspace);
    assert.equal(column, "installation_id");
    return { async range(from, to) { rpcCalls.push([from, to]); return { data: from === 0 ? Array.from({ length: 500 }, (_, i) => ({ installation_id: `id-${i}` })) : [], error: null }; } };
  } });
  assert.equal((await load(admin, workspace)).length, 0);
  assert.deepEqual(calls.filter((op) => op.table === "customers").map((op) => op.range), [[0, 499], [500, 999]]);
  assert.deepEqual(rpcCalls, [[0, 499], [500, 999]]);
  for (const op of calls) assert.notEqual(op.table, "shared_maintenance_handoffs");
});

test("partial data/provenance failures stop the entire projection", async () => {
  for (const failed of ["customers", "appointment_devices", "provenance"]) {
    const admin = database((op) => ({ data: [], error: op.table === failed ? { code: "fail" } : null }));
    admin.rpc = () => ({ order() { return { async range() { return { data: [], error: failed === "provenance" ? { code: "fail" } : null }; } }; } });
    await assert.rejects(load(admin, workspace));
  }
});

const { groupGoogleContactSources: groupSources } = harness({}, { "node:crypto": require("node:crypto") }).load("src/lib/alinflow/google-contacts-source.ts");
function groupFixture() {
  const first = project(rows(), workspace, today)[0];
  const second = { ...first, customerId: "customer-two", name: "Másik névalak", phone: "+36709998888", email: "second@example.invalid", address: "Másik cím 2.", sourceHash: "b".repeat(64) };
  return { first, second, group: { anchorCustomerId: first.customerId, memberCustomerIds: [first.customerId, second.customerId] } };
}
test("explicit group preserves both customer sources, each phone/email and duplicate-looking work blocks", () => {
  const { first, second, group } = groupFixture();
  const result = groupSources([first, second], [group]);
  assert.equal(result.errors.size, 0); assert.equal(result.sources.length, 1);
  const contact = result.sources[0];
  assert.equal(contact.name, first.name); assert.equal(contact.phone, first.phone);
  assert.equal(contact.phones.length, 2); assert.equal(contact.emails.length, 2); assert.equal(contact.addresses.length, 2);
  assert.equal(contact.notes, first.notes + "\n\n" + second.notes);
  assert.equal(contact.notes.split("Telepítés:").length - 1, 2);
  assert.equal(first.memberCustomerIds, undefined); assert.equal(second.memberCustomerIds, undefined);
});
test("group identifier deduplication does not deduplicate installations and hashes bind every member", () => {
  const { first, second, group } = groupFixture(); second.phone = "+36 30 123 4567"; second.email = first.email.toUpperCase();
  const a = groupSources([first, second], [group]).sources[0];
  const b = groupSources([second, first], [{ ...group, memberCustomerIds: [...group.memberCustomerIds].reverse() }]).sources[0];
  assert.equal(a.phones.length, 1); assert.equal(a.emails.length, 1); assert.equal(a.sourceHash, b.sourceHash);
  const changed = groupSources([first, { ...second, sourceHash: "c".repeat(64) }], [group]).sources[0];
  assert.notEqual(a.sourceHash, changed.sourceHash);
});
test("missing eligible group member never exports a partial source, unrelated singleton remains identical", () => {
  const { first, group } = groupFixture(), third = { ...first, customerId: "third" };
  const result = groupSources([first, third], [group]);
  assert.equal(result.errors.size, 1); assert.equal(result.sources.length, 1); assert.equal(result.sources[0], third);
});
test("invalid nonempty phone or email stops the group without dropping an identifier", () => {
  const { first, second, group } = groupFixture();
  for (const change of [{ phone: "123" }, { email: "broken email" }]) {
    const result = groupSources([first, { ...second, ...change }], [group]);
    assert.equal(result.errors.size, 1); assert.equal(result.sources.length, 0);
  }
});
test("overlapping membership and a missing anchor are rejected", () => {
  const { first, second, group } = groupFixture();
  assert.throws(() => groupSources([first, second], [group, group]), /tagsága/);
  assert.throws(() => groupSources([first, second], [{ ...group, anchorCustomerId: "unrelated" }]), /tagsága/);
});
test("combined note size is limited even when both individual notes fit", () => {
  const { first, second, group } = groupFixture();
  const result = groupSources([{ ...first, notes: "a".repeat(25000) }, { ...second, notes: "b".repeat(25000) }], [group]);
  assert.equal(result.sources.length, 0); assert.match(result.errors.get(first.customerId), /túl hosszú/);
});
