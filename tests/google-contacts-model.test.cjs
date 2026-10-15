const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const model = harness().load("src/lib/alinflow/google-contacts-model.ts");
const { normalizeContactPhone: phone, normalizeContactEmail: email, findContactCandidates: candidates,
  buildContactCreate: create, mergeContactUpdate: merge } = model;
const source = (extra = {}) => ({ customerId: "customer-one", name: "Teszt Ügyfél", phone: "06301234567", email: "test@example.invalid",
  address: "1111 Budapest, Példa utca 1.", notes: "Saját telepítések\nTelepítés: 2026.01.02\n1 db Teszt klíma", sourceHash: "hash", ...extra });
const remote = (extra = {}) => ({ resourceName: "people/example", metadata: { sources: [{ type: "CONTACT", id: "example", etag: "version-one" }] }, ...extra });
const plain = (value) => JSON.parse(JSON.stringify(value));
const marker = "workspace-one:customer-one";
const roundtrip = (body, extra = {}) => remote({ ...body, ...extra });

test("Hungarian phone formats and international numbers match without guessing extensions or short numbers", () => {
  for (const value of ["+36 30 123 4567", "06 (30) 123-4567", "0036 30 1234567", "36301234567", "301234567"]) assert.equal(phone(value), "+36301234567");
  assert.equal(phone("0612345678"), "+3612345678");
  assert.equal(phone("+44 20 1234 5678"), "+442012345678");
  for (const value of ["12345", "06301234567 mellék 2", "++36301234567", "06 30 1234567, 06307654321", "nincs"]) assert.equal(phone(value), "");
  assert.equal(email("  TEST@Example.invalid "), "test@example.invalid");
  assert.equal(email("test@invalid"), "");
});

test("name alone never matches, profiles and deleted contacts do not match", () => {
  const result = candidates(source(), [remote({ names: [{ displayName: "Teszt Ügyfél" }] }),
    remote({ resourceName: "people/profile", phoneNumbers: [{ value: source().phone, metadata: { source: { type: "PROFILE" } } }] }),
    remote({ resourceName: "people/deleted", metadata: { deleted: true }, phoneNumbers: [{ value: source().phone }] })]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.conflict, false);
});

test("different phone and email matches remain ambiguous, never auto-merged", () => {
  const result = candidates(source(), [remote({ phoneNumbers: [{ value: "+36301234567" }] }),
    remote({ resourceName: "people/email", emailAddresses: [{ value: "TEST@example.invalid" }] })]);
  assert.equal(result.conflict, true);
  assert.deepEqual(plain(result.candidates.map((entry) => entry.evidence)), [["phone"], ["email"]]);
});

test("repeated same remote candidate is unique and has both evidence types", () => {
  const person = remote({ phoneNumbers: [{ value: source().phone }], emailAddresses: [{ value: source().email }] });
  const result = candidates(source(), [person, person]);
  assert.equal(result.conflict, false);
  assert.deepEqual(plain(result.candidates[0].evidence), ["phone", "email"]);
  assert.equal(result.candidates.length, 1);
});

test("create carries stable marker, full unsplit name and managed note only", () => {
  const result = create(source(), marker);
  assert.deepEqual(plain(result.body.names), [{ unstructuredName: "Teszt Ügyfél" }]);
  assert.deepEqual(plain(model.googleContactMarkers(result.body)), [marker]);
  assert.match(result.body.biographies[0].value, /1 db Teszt klíma/);
  assert.equal(result.managed.marker, marker);
  assert.equal(result.body.resourceName, undefined);
});

test("linking keeps personal name, fields and free notes and claims only added values", () => {
  const person = remote({ names: [{ givenName: "Saját név", displayName: "Saját név" }],
    phoneNumbers: [{ value: "+36301234567", type: "mobile" }, { value: "+3612223333", type: "work" }],
    emailAddresses: [{ value: "private@example.invalid", type: "home" }],
    biographies: [{ value: "Személyes\nmegjegyzés", contentType: "TEXT_PLAIN" }],
    userDefined: [{ key: "Születésnap", value: "május" }],
  });
  const result = merge(source(), person, null, marker);
  assert.equal(result.ok, true);
  assert.equal(result.body.names, undefined);
  assert.equal(result.body.phoneNumbers, undefined);
  assert.equal(result.managed.phone, null);
  assert.equal(result.managed.name, null);
  assert.deepEqual(plain(result.body.emailAddresses), [{ value: "private@example.invalid", type: "home" }, { value: source().email, type: "other" }]);
  assert.ok(result.body.biographies[0].value.startsWith("Személyes\nmegjegyzés\n\n--- AlinFlow ---"));
  assert.deepEqual(plain(result.body.userDefined[0]), { key: "Születésnap", value: "május" });
});

test("unchanged approved contact produces no update mask", () => {
  const result = create(source(), marker);
  const merged = merge(source(), roundtrip(result.body), result.managed, marker);
  assert.equal(merged.ok, true);
  assert.equal(merged.updatePersonFields, "");
});

test("managed values change while manual second phone and note edits stay intact", () => {
  const created = create(source(), marker);
  const person = roundtrip(created.body, {
    phoneNumbers: [...created.body.phoneNumbers, { value: "+3612223333", type: "work" }],
    biographies: [{ value: `Személyes előtte\n${created.managed.noteBlock}\nSzemélyes utána`, contentType: "TEXT_PLAIN" }],
  });
  const next = source({ phone: "06307654321", notes: "Új telepítési adatok" });
  const result = merge(next, person, created.managed, marker);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.body.phoneNumbers), [{ value: next.phone, type: "other" }, { value: "+3612223333", type: "work" }]);
  assert.match(result.body.biographies[0].value, /^Személyes előtte\n--- AlinFlow ---\nÚj telepítési adatok\n--- AlinFlow vége ---\nSzemélyes utána$/);
  assert.equal(result.body.metadata.sources[0].etag, "version-one");
  assert.equal(result.body.names, undefined);
});

test("manual removal is not reversed and concurrent edits are flagged", () => {
  const created = create(source(), marker);
  const person = roundtrip(created.body, { phoneNumbers: [{ value: "+3612223333", type: "home" }] });
  const result = merge(source({ notes: "Megváltozott telepítés" }), person, created.managed, marker);
  assert.equal(result.ok, true);
  assert.equal(result.body.phoneNumbers, undefined);
  assert.equal(result.managed.phone, null);
  const conflict = merge(source({ phone: "06307654321" }), person, created.managed, marker);
  assert.equal(conflict.ok, false);
});

test("Google manual name changes stay untouched", () => {
  const created = create(source(), marker);
  const person = roundtrip(created.body, { names: [{ givenName: "Kézzel javított név" }] });
  const result = merge(source({ name: "Másik CRM-név" }), person, created.managed, marker);
  assert.equal(result.ok, true);
  assert.equal(result.body.names, undefined);
  assert.equal(result.managed.name, null);
});

test("missing ETag, other owner markers and changed managed notes fail closed", () => {
  const created = create(source(), marker);
  for (const person of [
    roundtrip(created.body, { metadata: { sources: [{ type: "CONTACT", id: "example" }] } }),
    roundtrip(created.body, { userDefined: [{ key: "alinflow", value: "other:customer" }] }),
    roundtrip(created.body, { userDefined: [] }),
    roundtrip(created.body, { biographies: [{ value: "Kézzel átírt AlinFlow-megjegyzés", contentType: "TEXT_PLAIN" }] }),
    roundtrip(created.body, { biographies: [{ value: created.managed.noteBlock + created.managed.noteBlock }] }),
  ]) assert.equal(merge(source(), person, created.managed, marker).ok, false);
});

test("HTML personal notes are not flattened and existing blocks are not appended twice", () => {
  for (const value of [{ value: "<b>Saját</b>", contentType: "TEXT_HTML" }, { value: "--- AlinFlow ---\nrégi\n--- AlinFlow vége ---" }]) {
    assert.equal(merge(source(), remote({ biographies: [value] }), null, marker).ok, false);
  }
});

test("only previously owned values are removed and duplicate personal values survive", () => {
  const created = create(source(), marker);
  const person = roundtrip(created.body, { phoneNumbers: [...created.body.phoneNumbers, { value: "+36307654321", type: "home" }] });
  const result = merge(source({ phone: "06307654321", email: "" }), person, created.managed, marker);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.body.phoneNumbers), [{ value: "+36307654321", type: "home" }]);
  assert.deepEqual(plain(result.body.emailAddresses), []);
  assert.equal(result.managed.phone, null);
});

test("lost PATCH response is adopted only when every changed field matches the saved mutation", () => {
  const created = create(source(), marker);
  const previous = roundtrip(created.body);
  const mutation = merge(source({ phone: "", notes: "Új munka" }), previous, created.managed, marker);
  assert.equal(mutation.ok, true);
  const confirmed = roundtrip({ ...created.body, ...mutation.body });
  assert.equal(model.contactMatchesManagedSnapshot(confirmed, mutation.managed, mutation), true);
  assert.equal(model.contactMatchesManagedSnapshot(previous, mutation.managed, mutation), false);
  assert.equal(model.contactMatchesManagedSnapshot({ ...confirmed, phoneNumbers: created.body.phoneNumbers }, mutation.managed, mutation), false,
    "Marker and note alone cannot prove removal of the old phone");
  assert.equal(model.contactMatchesManagedSnapshot({ ...confirmed, userDefined: [{ key: "alinflow", value: "another:owner" }] }, mutation.managed, mutation), false);
});

test("mutation recovery tolerates array reordering but never changed values or repeated fields", () => {
  const created = create(source(), marker);
  const previous = roundtrip(created.body, { phoneNumbers: [...created.body.phoneNumbers, { value: "+3612223333", type: "home" }] });
  const mutation = merge(source({ phone: "06307654321" }), previous, created.managed, marker);
  const confirmed = roundtrip({ ...created.body, ...mutation.body, phoneNumbers: [...mutation.body.phoneNumbers].reverse() });
  assert.equal(model.contactMatchesManagedSnapshot(confirmed, mutation.managed, mutation), true);
  confirmed.phoneNumbers.push({ value: "+3612223333", type: "home" });
  assert.equal(model.contactMatchesManagedSnapshot(confirmed, mutation.managed, mutation), false);
});

test("array updates retain the chosen primary phone, email and address but no read-only metadata", () => {
  const person = remote({
    phoneNumbers: [{ value: "+3612223333", type: "home", metadata: { sourcePrimary: true, primary: true, verified: true, source: { type:"CONTACT",id:"example" } } }],
    emailAddresses: [{ value: "personal@example.invalid", type: "home", metadata: { sourcePrimary: true, primary: true, verified:true } }],
    addresses: [{ formattedValue: "Személyes cím", type: "home", metadata: { sourcePrimary: true, primary:true } }],
  });
  const mutation=merge(source(), person, null, marker);
  assert.equal(mutation.ok,true);
  for(const field of ["phoneNumbers","emailAddresses","addresses"]) {
    assert.deepEqual(plain(mutation.body[field][0].metadata),{sourcePrimary:true});
    assert.equal(mutation.body[field][1].metadata,undefined);
  }
});

test("user changes of the primary flag do not lose ownership and survive a managed value replacement", () => {
  const created=create(source(), marker);
  const person=roundtrip(created.body,{phoneNumbers:[{...created.body.phoneNumbers[0],metadata:{sourcePrimary:true,primary:true}}]});
  const mutation=merge(source({phone:"06307654321"}),person,created.managed,marker);
  assert.equal(mutation.ok,true);
  assert.deepEqual(plain(mutation.body.phoneNumbers[0]),{value:"06307654321",type:"other",metadata:{sourcePrimary:true}});
  const confirmed=roundtrip(plain({...created.body,...mutation.body}));
  assert.equal(model.contactMatchesManagedSnapshot(confirmed,mutation.managed,mutation),true);
  confirmed.phoneNumbers[0].metadata.sourcePrimary=false;
  assert.equal(model.contactMatchesManagedSnapshot(confirmed,mutation.managed,mutation),false,"Explicit primary choice is part of the recovery proof");
});

test("provider-assigned primary metadata on a new value does not prevent recovery proof", () => {
  const person=remote({names:[{givenName:"Saját név"}]});
  const mutation=merge(source(),person,null,marker);
  const confirmed=roundtrip({...person,...mutation.body,phoneNumbers:mutation.body.phoneNumbers.map(field=>({...field,metadata:{sourcePrimary:true}}))});
  assert.equal(model.contactMatchesManagedSnapshot(confirmed,mutation.managed,mutation),true);
});


test("read-only and preferred-field metadata never triggers an otherwise unchanged contact PATCH", () => {
  const created=create(source(),marker);
  const person=roundtrip(plain(created.body));
  for(const key of ["names","phoneNumbers","emailAddresses","addresses","biographies"]) person[key][0].metadata={sourcePrimary:true,primary:true,verified:true};
  const result=merge(source(),person,created.managed,marker);
  assert.equal(result.ok,true); assert.equal(result.updatePersonFields,"");
  const updated=merge(source({notes:"Új telepítési adatok"}),person,created.managed,marker);
  assert.equal(updated.ok,true);
  assert.deepEqual(plain(updated.body.biographies[0].metadata),{sourcePrimary:true});
});
