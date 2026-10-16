const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const model = harness().load("src/lib/alinflow/google-contacts-model.ts");
const { normalizeContactPhone: phone, normalizeContactEmail: email, findContactCandidates: candidates,
  buildContactCreate: create, mergeContactUpdate: merge } = model;
const source = (extra = {}) => ({ customerId: "customer-one", name: "Teszt Ügyfél", phone: "06301234567", email: "test@example.invalid",
  address: "1111 Budapest, Példa utca 1.", notes: "Telepítés: 2026.01.02\n1 db Teszt klíma", sourceHash: "hash", ...extra });
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
  assert.equal(result.body.biographies[0].value, source().notes);
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
  assert.equal(result.body.biographies[0].value, `Személyes\nmegjegyzés\n\n${source().notes}`);
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
  assert.equal(result.body.biographies[0].value, "Személyes előtte\nÚj telepítési adatok\nSzemélyes utána");
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


test("legacy note wrappers migrate once while personal notes and all installation details survive", () => {
  const created = create(source(), marker);
  const legacyBlock = `--- AlinFlow ---\nSaját telepítések\n\n${source().notes}\n--- AlinFlow vége ---`;
  const previous = { ...created.managed, noteBlock: legacyBlock };
  const person = roundtrip(created.body, {
    biographies: [{ value: `Személyes előtte\n\n${legacyBlock}\nSzemélyes utána`, contentType: "TEXT_PLAIN" }],
  });
  const migrated = merge(source(), person, previous, marker);
  assert.equal(migrated.ok, true);
  assert.equal(migrated.updatePersonFields, "biographies");
  assert.equal(migrated.body.biographies[0].value, `Személyes előtte\n\n${source().notes}\nSzemélyes utána`);
  const confirmed = roundtrip({ ...person, ...migrated.body });
  assert.equal(model.contactMatchesManagedSnapshot(confirmed, migrated.managed, migrated), true);
  assert.equal(model.contactMatchesManagedSnapshot(person, migrated.managed, migrated), false);
  assert.equal(merge(source(), confirmed, migrated.managed, marker).updatePersonFields, "");
  const manuallyEdited = roundtrip(person, { biographies: [{ value: person.biographies[0].value.replace("Teszt klíma", "Kézzel javított klíma") }] });
  assert.equal(merge(source(), manuallyEdited, previous, marker).ok, false);
});

test("empty managed notes cannot become an ambiguous update target", () => {
  assert.throws(() => create(source({ notes: "  \n " }), marker));
});

test("removing legacy wrappers never adopts an identical personal note as managed text", () => {
  const created = create(source(), marker);
  const legacyBlock = `--- AlinFlow ---\nSaját telepítések\n\n${source().notes}\n--- AlinFlow vége ---`;
  const person = roundtrip(created.body, { biographies: [{ value: `${source().notes}\n\n${legacyBlock}` }] });
  const result = merge(source(), person, { ...created.managed, noteBlock: legacyBlock }, marker);
  assert.equal(result.ok, false);
});


const groupedSource = (extra = {}) => source({
  memberCustomerIds: ["customer-two", "customer-one"],
  phones: ["06301234567", "06201234567"],
  emails: ["test@example.invalid", "second@example.invalid"],
  addresses: [source().address, "2222 Példaváros, Másik utca 2."],
  notes: source().notes + "\n\nTelepítés: 2026.02.03\n2 db Másik tesztklíma\nBeltéri S/N: TEST-SECOND",
  ...extra,
});

test("grouped create exports both member contacts and every installation block in a V2 snapshot", () => {
  const notes = Array.from({ length: 22 }, (_, i) => `Telepítés: 2026.01.02
1 db Teszt klíma
Beltéri S/N: TEST-${i}`).join("\n\n");
  const result = create(groupedSource({ notes }), marker);
  assert.equal(result.managed.version, 2);
  assert.deepEqual(plain(result.managed.memberCustomerIds), ["customer-one", "customer-two"]);
  assert.deepEqual(plain(result.body.phoneNumbers.map(item => item.value)), groupedSource().phones);
  assert.deepEqual(plain(result.body.emailAddresses.map(item => item.value)), groupedSource().emails);
  assert.deepEqual(plain(result.body.addresses.map(item => item.formattedValue)), groupedSource().addresses);
  assert.equal(result.body.biographies[0].value, notes);
  assert.equal(result.body.biographies[0].value.match(/Telepítés:/g).length, 22);
  assert.equal(create(source(), marker).managed.version, 1, "Existing single-customer snapshots stay V1");
});

test("grouped values deduplicate equivalent contacts but never deduplicate work notes", () => {
  const repeated = source().notes + "\n\n" + source().notes;
  const input = groupedSource({ phones: ["06 (30) 123-4567", "+36 30 1234567"],
    emails: ["TEST@example.invalid", "test@example.invalid"], addresses: [source().address, source().address], notes: repeated });
  const result = create(input, marker);
  assert.equal(result.body.phoneNumbers.length, 1);
  assert.equal(result.body.emailAddresses.length, 1);
  assert.equal(result.body.addresses.length, 1);
  assert.equal(result.body.biographies[0].value, repeated);
});

test("group matching uses the second member phone and email and retains ambiguity across Google contacts", () => {
  const phoneMatch = remote({ phoneNumbers: [{ value: "+36201234567" }] });
  const emailMatch = remote({ resourceName: "people/other", emailAddresses: [{ value: "SECOND@example.invalid" }] });
  assert.deepEqual(plain(candidates(groupedSource(), [phoneMatch]).candidates[0].evidence), ["phone"]);
  assert.deepEqual(plain(candidates(groupedSource(), [emailMatch]).candidates[0].evidence), ["email"]);
  assert.equal(candidates(groupedSource(), [phoneMatch, emailMatch]).conflict, true);
  assert.equal(candidates(groupedSource(), [remote({ names: [{ displayName: source().name }] })]).candidates.length, 0);
});

test("grouped inputs require complete explicit membership and never silently discard an invalid contact", () => {
  for (const input of [
    source({ phones: [source().phone] }),
    groupedSource({ memberCustomerIds: ["customer-one"] }),
    groupedSource({ memberCustomerIds: ["customer-one", "customer-one"] }),
    groupedSource({ memberCustomerIds: ["customer-two", "customer-three"] }),
    groupedSource({ memberCustomerIds: ["customer-one", " "] }),
    groupedSource({ memberCustomerIds: Array.from({ length: 11 }, (_, i) => i ? `customer-${i}` : "customer-one") }),
    groupedSource({ phones: undefined }), groupedSource({ emails: undefined }), groupedSource({ addresses: undefined }),
    groupedSource({ phones: [source().phone, "123"] }), groupedSource({ emails: [source().email, "missing-at"] }),
    groupedSource({ phones: ["06201234567"] }), groupedSource({ emails: ["second@example.invalid"] }),
    groupedSource({ addresses: ["Different address"] }),
  ]) assert.throws(() => create(input, marker));
  assert.throws(() => create(groupedSource({ notes: "x".repeat(40001) }), marker));
});

test("group linking preserves matched personal fields, their primary flags, unrelated fields and personal notes", () => {
  const person = remote({ names: [{ givenName: "Személyes név" }],
    phoneNumbers: [{ value: "+36301234567", type: "mobile", metadata: { sourcePrimary: true, primary: true } },
      { value: "+3612223333", type: "work" }],
    emailAddresses: [{ value: "TEST@example.invalid", type: "home", displayName: "Saját", metadata: { sourcePrimary: true } }],
    addresses: [{ formattedValue: source().address, type: "home", metadata: { sourcePrimary: true } }],
    biographies: [{ value: "Személyes megjegyzés", contentType: "TEXT_PLAIN" }],
    userDefined: [{ key: "Egyéni", value: "marad" }],
  });
  const result = merge(groupedSource(), person, null, marker);
  assert.equal(result.ok, true);
  assert.equal(result.body.names, undefined);
  assert.equal(result.managed.name, null);
  assert.equal(result.managed.phones.length, 1);
  assert.equal(result.managed.emails.length, 1);
  assert.equal(result.managed.addresses.length, 1);
  assert.deepEqual(plain(result.body.phoneNumbers[0]), { value: "+36301234567", type: "mobile", metadata: { sourcePrimary: true } });
  assert.deepEqual(plain(result.body.phoneNumbers[1]), { value: "+3612223333", type: "work" });
  assert.equal(result.body.emailAddresses[0].displayName, "Saját");
  assert.equal(result.body.addresses[0].metadata.sourcePrimary, true);
  assert.equal(result.body.biographies[0].value, "Személyes megjegyzés\n\n" + groupedSource().notes);
  assert.deepEqual(plain(result.body.userDefined[0]), { key: "Egyéni", value: "marad" });
});

test("unchanged grouped contacts remain idempotent despite source and Google field ordering or primary flags", () => {
  const input = groupedSource(), created = create(input, marker), person = roundtrip(plain(created.body));
  for (const key of ["names", "phoneNumbers", "emailAddresses", "addresses", "biographies"]) {
    person[key].reverse(); person[key][0].metadata = { sourcePrimary: true, primary: true, verified: true };
  }
  const reordered = groupedSource({ memberCustomerIds: [...input.memberCustomerIds].reverse(), phones: [...input.phones].reverse(),
    emails: [...input.emails].reverse(), addresses: [...input.addresses].reverse() });
  const result = merge(reordered, person, created.managed, marker);
  assert.equal(result.ok, true);
  assert.equal(result.updatePersonFields, "");
  assert.equal(model.contactMatchesManagedSnapshot(person, result.managed), true);
});

test("updating a member number preserves the other member, a personal number and the preferred-field flag", () => {
  const created = create(groupedSource(), marker);
  const person = roundtrip(plain(created.body), { phoneNumbers: [created.body.phoneNumbers[0],
    { ...created.body.phoneNumbers[1], metadata: { sourcePrimary: true, primary: true } }, { value: "+3612223333", type: "home" }] });
  const next = groupedSource({ phones: [source().phone, "06701234567"] });
  const result = merge(next, person, created.managed, marker);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.body.phoneNumbers), plain([created.body.phoneNumbers[0], { value: "+3612223333", type: "home" },
    { value: "06701234567", type: "other", metadata: { sourcePrimary: true } }]));
  assert.equal(result.managed.phones.length, 2);
  const confirmed = roundtrip({ ...person, ...result.body });
  assert.equal(merge(next, confirmed, result.managed, marker).updatePersonFields, "");
});

test("manual deletion of a second member phone stays deleted while unrelated work notes can update", () => {
  const created = create(groupedSource(), marker);
  const person = roundtrip(created.body, { phoneNumbers: [created.body.phoneNumbers[0]] });
  const next = groupedSource({ notes: groupedSource().notes + "\nUtolsó rögzített karbantartás: 2026.03.04" });
  const result = merge(next, person, created.managed, marker);
  assert.equal(result.ok, true);
  assert.equal(result.body.phoneNumbers, undefined);
  assert.equal(result.managed.phones.length, 1);
  const confirmed = roundtrip({ ...person, ...result.body });
  assert.equal(merge(next, confirmed, result.managed, marker).updatePersonFields, "");
  assert.equal(merge(groupedSource({ phones: [source().phone, "06701234567"] }), person, created.managed, marker).ok, false);
});

test("manual edits to an owned field become personal and are never overwritten by group updates", () => {
  const created = create(groupedSource(), marker);
  const person = roundtrip(created.body, { phoneNumbers: [created.body.phoneNumbers[0], { value: "06201234567", type: "work" }] });
  const result = merge(groupedSource({ notes: "Másik telepítési megjegyzés" }), person, created.managed, marker);
  assert.equal(result.ok, true);
  assert.equal(result.body.phoneNumbers, undefined);
  assert.equal(result.managed.phones.length, 1);
  assert.equal(merge(groupedSource({ phones: [source().phone, "06701234567"] }), person, created.managed, marker).ok, false);
});

test("removing a member value only removes the owned field and never a personal equivalent", () => {
  const created = create(groupedSource(), marker);
  const personal = { value: "+36201234567", type: "mobile", metadata: { sourcePrimary: true } };
  const person = roundtrip(created.body, { phoneNumbers: [...created.body.phoneNumbers, personal] });
  const result = merge(groupedSource({ phones: [source().phone], emails: [source().email] }), person, created.managed, marker);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.body.phoneNumbers), plain([created.body.phoneNumbers[0], personal]));
  assert.deepEqual(plain(result.body.emailAddresses), plain([created.body.emailAddresses[0]]));
});

test("ambiguous identical owned entries, changed membership and singleton/group conversions require review", () => {
  const group = create(groupedSource(), marker), single = create(source(), marker);
  const duplicate = roundtrip(group.body, { phoneNumbers: [...group.body.phoneNumbers, { ...group.body.phoneNumbers[1] }] });
  assert.equal(merge(groupedSource(), duplicate, group.managed, marker).ok, false);
  assert.equal(merge(groupedSource({ memberCustomerIds: ["customer-one", "customer-three"] }), roundtrip(group.body), group.managed, marker).ok, false);
  assert.equal(merge(source(), roundtrip(group.body), group.managed, marker).ok, false);
  assert.equal(merge(groupedSource(), roundtrip(single.body), single.managed, marker).ok, false);
  assert.equal(merge(groupedSource(), roundtrip(group.body), { ...group.managed, phones: null }, marker).ok, false);
});

test("group notes update the complete owned block and keep personal text byte-for-byte", () => {
  const input = groupedSource(), created = create(input, marker);
  const person = roundtrip(created.body, { biographies: [{ value: "Előtte\n\n" + input.notes + "\n\nUtána", contentType: "TEXT_PLAIN" }] });
  const next = groupedSource({ notes: input.notes + "\nTelepítés: 2026.03.04\n1 db További klíma" });
  const result = merge(next, person, created.managed, marker);
  assert.equal(result.ok, true);
  assert.equal(result.body.biographies[0].value, "Előtte\n\n" + next.notes + "\n\nUtána");
  const edited = roundtrip(person, { biographies: [{ value: person.biographies[0].value.replace("TEST-SECOND", "MANUAL-SECOND") }] });
  assert.equal(merge(next, edited, created.managed, marker).ok, false);
});

test("lost grouped PATCH response is proven only by every changed array including the second member", () => {
  const created = create(groupedSource(), marker), person = roundtrip(created.body);
  const next = groupedSource({ phones: [source().phone, "06701234567"], emails: [source().email], notes: "Frissített telepítési adatok" });
  const mutation = merge(next, person, created.managed, marker);
  assert.equal(mutation.ok, true);
  const confirmed = roundtrip({ ...person, ...mutation.body });
  assert.equal(model.contactMatchesManagedSnapshot(confirmed, mutation.managed, mutation), true);
  assert.equal(model.contactMatchesManagedSnapshot(person, mutation.managed, mutation), false);
  assert.equal(model.contactMatchesManagedSnapshot({ ...confirmed, phoneNumbers: [confirmed.phoneNumbers[0]] }, mutation.managed, mutation), false);
  assert.equal(model.contactMatchesManagedSnapshot({ ...confirmed, emailAddresses: created.body.emailAddresses }, mutation.managed, mutation), false);
  assert.equal(model.contactMatchesManagedSnapshot({ ...confirmed, phoneNumbers: [...confirmed.phoneNumbers].reverse() }, mutation.managed, mutation), true);
  assert.equal(model.contactMatchesManagedSnapshot({ ...confirmed, phoneNumbers: [...confirmed.phoneNumbers, confirmed.phoneNumbers[1]] }, mutation.managed, mutation), false);
  assert.equal(merge(next, confirmed, mutation.managed, marker).updatePersonFields, "");
});

test("group recovery rejects a missing member value, invalid membership and a foreign marker", () => {
  const created = create(groupedSource(), marker), person = roundtrip(created.body);
  assert.equal(model.contactMatchesManagedSnapshot(person, created.managed), true);
  for (const field of ["phoneNumbers", "emailAddresses", "addresses"]) {
    assert.equal(model.contactMatchesManagedSnapshot({ ...person, [field]: [person[field][0]] }, created.managed), false);
  }
  assert.equal(model.contactMatchesManagedSnapshot(person, { ...created.managed, memberCustomerIds: ["customer-one", "customer-one"] }), false);
  assert.equal(model.contactMatchesManagedSnapshot(person, { ...created.managed, phones: null }), false);
  assert.equal(model.contactMatchesManagedSnapshot({ ...person, userDefined: [{ key: "alinflow", value: "other:customer" }] }, created.managed), false);
});
