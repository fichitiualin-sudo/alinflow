const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const { buildCallbackMap } = harness().load("src/lib/alinflow/callback-map.ts");
const customer = (id, patch = {}) => ({ id, name: `Teszt ${id}`, city: "Tápiószele", postalCode: "2766",
  phone: "", email: "", address: "", source: "Facebook", status: "Visszahívandó", need: "Gree Comfort Pro",
  quoteItems: [], ...patch });
const ids = items => Array.from(items, item => item.id);

test("callback map groups town variants and Budapest postcodes into canonical municipalities", () => {
  const people = [customer("a"), customer("b", { city: "  HU-2766 TAPIOSZELE  " }),
    customer("c", { city: "2766, Tápiószele" }), customer("d", { city: "Budapest", postalCode: "1011" }),
    customer("e", { city: "H-1101 Budapest", postalCode: "1101" })];
  const data = buildCallbackMap(people);
  assert.equal(data.total, 5);
  assert.equal(data.unlocated.length, 0);
  assert.deepEqual(Array.from(data.groups, group => group.city), ["Budapest", "Tápiószele"]);
  assert.deepEqual(ids(data.groups[0].customers), ["d", "e"]);
  assert.deepEqual(ids(data.groups[1].customers), ["a", "b", "c"]);
  assert.equal(data.groups[1].latitude, 47.3361);
  assert.equal(data.groups[1].longitude, 19.8772);
});

test("callback eligibility agrees with the task list and leaves all input objects unchanged", () => {
  const people = [customer("callback"), customer("booked", { date: "2026-10-12" }),
    customer("quote", { status: "Ajánlat elküldve" }), customer("closed", { status: "Lezárva" }),
    customer("cancelled", { status: "Lemondva" }), customer("other", { status: "új lead" }),
    customer("empty-date", { date: "" })];
  const before = JSON.stringify(people);
  for (const item of people) Object.freeze(item);
  Object.freeze(people);
  const data = buildCallbackMap(people);
  assert.deepEqual(ids(data.groups[0].customers), ["callback", "empty-date"]);
  assert.equal(data.total, 2);
  assert.equal(JSON.stringify(people), before);
  assert.equal(data.groups[0].customers[0], people[0]);
});

test("only an empty town permits an exact unambiguous postcode fallback", () => {
  const data = buildCallbackMap([
    customer("postcode", { city: "", postalCode: "2766" }),
    customer("prefixed", { city: " ", postalCode: "HU-2100" }),
    customer("ambiguous", { city: "", postalCode: "2066" }), // Szár and Újbarok.
    customer("invalid-town", { city: "Definitely not a town", postalCode: "2766" }),
    customer("missing", { city: "", postalCode: "" }),
    customer("partial", { city: "", postalCode: "276" }),
    customer("noisy", { city: "", postalCode: "2766 unknown" }),
    customer("unknown-postcode", { city: "", postalCode: "9999" }),
  ]);
  assert.equal(data.total, 8);
  assert.deepEqual(Array.from(data.groups, group => group.city), ["Gödöllő", "Tápiószele"]);
  assert.deepEqual(ids(data.unlocated), ["ambiguous", "invalid-town", "missing", "partial", "noisy", "unknown-postcode"]);
});

test("town lookup never guesses from an address, partial name, district or low accuracy source point", () => {
  const data = buildCallbackMap([
    customer("partial", { city: "Tápió" }),
    customer("street", { city: "2766 Tápiószele, Teszt utca 1." }),
    customer("district", { city: "Budapest XIII." }),
    customer("estimated", { city: "Románd", postalCode: "8434" }),
  ]);
  assert.equal(data.groups.length, 0);
  assert.equal(data.unlocated.length, 4);
  assert.equal(data.total, 4);
});

test("search ignores accents and case across name, town and climate, including unlocated people", () => {
  const people = [customer("name", { name: "Őri Éva", city: "Gödöllő", need: "Polar Prime" }),
    customer("climate", { name: "Teszt Béla", city: "Missing place", need: "AUX AURA" }),
    customer("postal", { city: "", postalCode: "2766", need: "Tesla Superior" })];
  assert.equal(buildCallbackMap(people, "ORI EVA").groups[0].customers[0].id, "name");
  assert.equal(buildCallbackMap(people, "godollo").total, 1);
  assert.deepEqual(ids(buildCallbackMap(people, "aura").unlocated), ["climate"]);
  assert.equal(buildCallbackMap(people, "tapioszele").groups[0].customers[0].id, "postal");
  assert.equal(buildCallbackMap(people, "no match").total, 0);
  assert.equal(buildCallbackMap(people, "  ").total, 3);
});

test("ambiguous normalized town spellings cannot choose an arbitrary coordinate", () => {
  const { buildCallbackMap: ambiguousMap } = harness({}, {
    "./callback-town-data": { CALLBACK_TOWNS: [["Ár", 47, 19], ["Är", 48, 20]] },
  }).load("src/lib/alinflow/callback-map.ts");
  const data = ambiguousMap([customer("ambiguous", { city: "AR" })]);
  assert.equal(data.groups.length, 0);
  assert.equal(data.unlocated[0].id, "ambiguous");
});

test("exact accented towns remain distinct before an ambiguous accentless fallback", () => {
  const data = buildCallbackMap([
    customer("komlo", { city: "KOMLÓ" }), customer("komlo2", { city: "Kömlő" }),
    customer("komoro", { city: "Komoró" }), customer("komoro2", { city: "Kömörő" }),
    customer("decomposed", { city: "Ko\u0308mlo\u030b" }),
    customer("ambiguous", { city: "KOMLO", postalCode: "7300" }),
    customer("postal-komlo", { city: "", postalCode: "7300" }),
    customer("postal-komlo2", { city: "", postalCode: "3372" }),
  ]);
  assert.equal(data.total, 8);
  assert.equal(data.groups.length, 4);
  assert.equal(new Set(data.groups.map(group => group.id)).size, 4);
  assert.deepEqual(ids(data.groups.find(group => group.city === "Komló").customers), ["komlo", "postal-komlo"]);
  assert.deepEqual(ids(data.groups.find(group => group.city === "Kömlő").customers), ["komlo2", "decomposed", "postal-komlo2"]);
  assert.deepEqual(ids(data.unlocated), ["ambiguous"]);
});

test("independent towns with formerly duplicated postal coordinates have distinct gazetteer points", () => {
  const pairs = [["Abasár", "Pálosvörösmart"], ["Balassagyarmat", "Ipolyszög"], ["Bő", "Szombathely"],
    ["Eger", "Szarvaskő"], ["Encs", "Gibárt"], ["Kisfalud", "Mihályi"], ["Kázsmárk", "Léh"],
    ["Pári", "Tamási"], ["Szajla", "Terpes"], ["Tekenye", "Zalaszentgrót"]];
  const data = buildCallbackMap(pairs.flat().map(city => customer(city, { city })));
  assert.equal(data.total, 20);
  assert.equal(data.groups.length, 20);
  assert.equal(data.unlocated.length, 0);
  for (const [left, right] of pairs) {
    const a = data.groups.find(group => group.city === left);
    const b = data.groups.find(group => group.city === right);
    assert.notDeepEqual([a.latitude, a.longitude], [b.latitude, b.longitude], `${left}/${right}`);
  }
  // Independently identified municipality records, rather than similarly named
  // stations/districts: GeoNames 3054967 (Bő), 7287750 (Kisfalud).
  const bo = data.groups.find(group => group.city === "Bő");
  assert.deepEqual([bo.latitude, bo.longitude], [47.36783, 16.8149]);
  const kisfalud = data.groups.find(group => group.city === "Kisfalud");
  assert.deepEqual([kisfalud.latitude, kisfalud.longitude], [47.52821, 17.09061]);
});

test("climate search matches the same fallback quote label shown in the customer list", () => {
  const { callbackClimateLabel } = harness().load("src/lib/alinflow/callback-map.ts");
  const person = customer("quoted", { need: "  ", quoteItems: [{ isManual: true, customName: "Gree Comfort X", quantity: 2 }] });
  assert.equal(callbackClimateLabel(person), "2 db Gree Comfort X");
  assert.equal(buildCallbackMap([person], "GREE COMFORT").total, 1);
  const inquiry = { ...person, need: "Polar Prime" };
  assert.equal(callbackClimateLabel(inquiry), "Polar Prime");
  assert.equal(buildCallbackMap([inquiry], "Gree").total, 0);
});

test("offline data is complete enough for Hungary and contains only finite town points", () => {
  const { CALLBACK_TOWNS } = harness().load("src/lib/alinflow/callback-town-data.ts");
  assert.ok(CALLBACK_TOWNS.length > 3100);
  assert.equal(new Set(CALLBACK_TOWNS.map(town => town[0])).size, CALLBACK_TOWNS.length);
  assert.equal(new Set(CALLBACK_TOWNS.map(town => `${town[1]},${town[2]}`)).size, CALLBACK_TOWNS.length);
  for (const [city, latitude, longitude] of CALLBACK_TOWNS) {
    assert.ok(city.trim());
    assert.ok(Number.isFinite(latitude) && latitude >= 45 && latitude <= 49.5);
    assert.ok(Number.isFinite(longitude) && longitude >= 16 && longitude <= 23.5);
  }
  for (const city of ["Budapest", "Debrecen", "Győr", "Miskolc", "Pécs", "Szeged", "Tápiószele", "Gödöllő"]) {
    assert.ok(CALLBACK_TOWNS.some(town => town[0] === city), city);
  }
});
