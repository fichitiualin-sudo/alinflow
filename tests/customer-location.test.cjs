const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

const { customerLocationFromData, postalCodeFromCustomerData } = harness().load("src/lib/alinflow/customers.ts");
const { fullCustomerAddress, displayAddress } = harness().load("src/lib/alinflow/format.ts");
const location = (...args) => ({ ...customerLocationFromData(...args) });

test("full work addresses supply their own town, including comma, compact and accent variants", () => {
  for (const address of ["2100 Gödöllő, Synthetic utca 1.", "2100, GODOLLO, Synthetic utca 1.",
    "2100Godollo, Synthetic utca 1.", " 2100   gödöllő Synthetic utca 1."]) {
    assert.deepEqual(location("Hatvan", "3000", address), { city: "Gödöllő", postalCode: "2100" });
  }
  assert.deepEqual(location("Hatvan", "3000", "1139, Budapest, Synthetic utca 1."), { city: "Budapest", postalCode: "1139" });
  assert.deepEqual(location("Hatvan", "3000", "1162Budapest, Synthetic utca 1."), { city: "Budapest", postalCode: "1162" });
  assert.deepEqual(location("Hatvan", "3000", "2131 Göd(Alsógöd), Synthetic utca 1."), { city: "Göd", postalCode: "2131" });
});

test("missing towns are inferred only from complete unique postcodes", () => {
  assert.deepEqual(location("", "2100", "Synthetic utca 1."), { city: "Gödöllő", postalCode: "2100" });
  assert.deepEqual(location(" ", " 1139 "), { city: "Budapest", postalCode: "1139" });
  assert.deepEqual(location("", "3053"), { city: "", postalCode: "3053" });
  assert.deepEqual(location("", "9999"), { city: "", postalCode: "9999" });
  for (const invalid of ["210", "21000", "2x100", "2100/2", "2100 unknown"]) {
    assert.deepEqual(location("", invalid), { city: "", postalCode: "" });
    assert.equal(postalCodeFromCustomerData("", invalid), "");
  }
});

test("a full address disambiguates shared postcodes using a complete town name", () => {
  assert.deepEqual(location("", "", "3053 Ecseg, Synthetic utca 1."), { city: "Ecseg", postalCode: "3053" });
  assert.deepEqual(location("", "", "3053, KOZARD, Synthetic utca 1."), { city: "Kozárd", postalCode: "3053" });
  assert.deepEqual(location("", "", "3053 Ecseg(Synthetic külterület), Synthetic utca 1."), { city: "Ecseg", postalCode: "3053" });
  assert.deepEqual(location("Hatvan", "3000", "3053 Ecsegi út 1."), { city: "", postalCode: "3053" });
});

test("full addresses can use a unique postcode but never borrow a different canonical city", () => {
  assert.deepEqual(location("Hatvan", "3000", "2100 Gödöll typo, Synthetic utca 1."), { city: "Gödöllő", postalCode: "2100" });
  for (const address of ["3053 SyntheticTown, Synthetic utca 1.", "3053 Budapest, Synthetic utca 1.",
    "3053 Ecsegi út 1.", "3053 Synthetic utca, Ecseg"]) {
    assert.deepEqual(location("Hatvan", "3000", address), { city: "", postalCode: "3053" });
  }
  assert.deepEqual(location("Hatvan", "3000", "9999 SyntheticTown, Synthetic utca 1."), { city: "", postalCode: "9999" });
});

test("street addresses preserve supplied towns and never turn parcel numbers into postcodes", () => {
  for (const address of ["Synthetic utca 1.", "4321/2 hrsz.", "2100 hrsz.", "2100 HRSZ./2", "2100 helyrajzi szám 2",
    "Synthetic külterület 3941", "21000 Synthetic utca 1."]) {
    assert.deepEqual(location("Hatvan", "", address), { city: "Hatvan", postalCode: "3000" });
    assert.deepEqual(location("", "", address), { city: "", postalCode: "" });
    assert.equal(postalCodeFromCustomerData("", "", address), "");
  }
  assert.deepEqual(location("Custom town", "2100", "Synthetic utca 1."), { city: "Custom town", postalCode: "2100" });
  assert.deepEqual(location("godollo", "", "Synthetic utca 1."), { city: "godollo", postalCode: "2100" });
});

test("postcode-only callers retain direct code, full-address and unique city precedence", () => {
  assert.equal(postalCodeFromCustomerData("Hatvan", "3000", "2100 Gödöllő, Synthetic utca 1."), "3000");
  assert.equal(postalCodeFromCustomerData("Hatvan", "", "1139, Budapest, Synthetic utca 1."), "1139");
  assert.equal(postalCodeFromCustomerData("Hatvan", "", "1162Budapest, Synthetic utca 1."), "1162");
  assert.equal(postalCodeFromCustomerData("Hatvan", "", "Synthetic utca 1."), "3000");
  assert.equal(postalCodeFromCustomerData("Budapest", "", "Synthetic utca 1."), "");
});

test("resolved accented town names do not duplicate an accentless full address", () => {
  for (const address of ["2100 Godollo, Synthetic utca 1.", "2100, GODOLLO, Synthetic utca 1.",
    "2100Godollo, Synthetic utca 1."]) {
    const customer = { ...customerLocationFromData("", "", address), address };
    assert.equal(customer.city, "Gödöllő");
    assert.equal(fullCustomerAddress(customer), address);
    assert.equal(displayAddress(customer), address);
  }
});
