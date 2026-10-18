const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const api = harness().load("src/lib/alinflow/facebook-leads.ts");
const config = { workspaceId: "10000000-0000-4000-8000-000000000001", pageId: "111", formIds: ["222"], adClimateMap: { "333": "Polar Prime" } };
const lead = { id: "444", form_id: "222", ad_id: "333", ad_name: "Actual ad", campaign_id: "555", campaign_name: "Autumn",
  created_time: "2026-10-05T10:25:00+0200", field_data: [
    { name: "full_name", values: [" Teszt Éva "] }, { name: "phone_number", values: ["+36 30 123 4567"] },
    { name: "email", values: ["EVA@EXAMPLE.TEST"] }, { name: "a_szerelés_települése", values: ["Tápiószele"] },
  ] };

test("Meta lead normalization preserves submitted time, Hungarian city and exact ad mapping", () => {
  assert.equal(api.validateFacebookGraphLead(lead), true);
  const value = api.normalizeFacebookLead(lead, config);
  assert.equal(value.name, "Teszt Éva");
  assert.equal(value.phone, "+36 30 123 4567");
  assert.equal(value.email, "eva@example.test");
  assert.equal(value.city, "Tápiószele");
  assert.equal(value.climate_name, "Polar Prime");
  assert.equal(value.submitted_at, "2026-10-05T08:25:00.000Z");
});

test("configured city question takes precedence over profile city", () => {
  const value = api.normalizeFacebookLead({ ...lead, field_data: [...lead.field_data,
    { name: "city", values: ["Budapest"] }, { name: "Hová kérné?", values: ["Cegléd"] }] }, { ...config, cityField: "Hová kérné?" });
  assert.equal(value.city, "Cegléd");
});

test("postcode-only Meta leads fill only a missing city while preserving the submitted postcode", () => {
  for (const [postalCode, city] of [["2100", "Gödöllő"], ["1139", "Budapest"], ["3053", ""],
    ["9999", ""], ["21000", ""], ["2100/2", ""], ["2100 unknown", ""]]) {
    const value = api.normalizeFacebookLead({ ...lead, field_data: [{ name: "zip_code", values: [postalCode] }] }, config);
    assert.equal(value.city, city);
    assert.equal(value.postal_code, postalCode);
  }
  for (const postalCode of ["2100", "2100 unknown", ""]) {
    const value = api.normalizeFacebookLead({ ...lead, field_data: [
      { name: "city", values: ["Synthetic custom town"] }, { name: "postal_code", values: [postalCode] },
    ] }, config);
    assert.equal(value.city, "Synthetic custom town");
    assert.equal(value.postal_code, postalCode);
  }
});

const knownConfig = { ...config, adClimateMap: {
  "333": "Polar Prime", "334": "Gree Comfort Pro", "335": "AUX Aura", "336": "Tesla Superior",
} };
const climateFor = (ad_name, ad_id = "999", selectedConfig = knownConfig, patch = {}) =>
  api.normalizeFacebookLead({ ...lead, ad_id, ad_name, ...patch }, selectedConfig).climate_name;

test("explicit ad IDs remain authoritative over missing, different or ambiguous title names", () => {
  for (const title of [undefined, "", "Gree Comfort Pro", "Polar Prime | Gree Comfort Pro", "Polar Prime Plus"]) {
    assert.equal(climateFor(title, "333"), "Polar Prime");
  }
});

test("new and copied ads recognize one complete known model in an isolated title field", () => {
  for (const [title, expected] of [
    ["01 | Polar Prime | 280000 Ft | Eredeti kreatív | 2026-10-18", "Polar Prime"],
    ["02 | Gree Comfort Pro | 300000 Ft | Eredeti kreatív | 2026-10-18", "Gree Comfort Pro"],
    ["01 | Polar Prime | Fűtésre tervezve | 280000 Ft | 2026-10-17", "Polar Prime"],
    ["01 | (PÓLÁR---prime) | 280000 Ft", "Polar Prime"],
    ["02; GREE.\tComfort / Pro; 300000 Ft", "Gree Comfort Pro"],
    ["03 • aux\u00a0 aura • Új kreatív", "AUX Aura"],
    ["04 · Tesla Superior · Új kreatív", "Tesla Superior"],
    ["01\nPolar Prime\nÚj kreatív", "Polar Prime"],
    [" Gree Comfort Pro ", "Gree Comfort Pro"],
    ["Polar Prime | PÓLAR--PRIME", "Polar Prime"],
  ]) assert.equal(climateFor(title), expected, title);
});

test("duplicate configured names and formatting variants count as one known model", () => {
  const duplicateConfig = { ...config, adClimateMap: {
    "333": "Polar Prime", "334": "Polar Prime", "335": "PÓLAR--PRIME",
  } };
  assert.equal(climateFor("01 | polar prime | Új kreatív", "999", duplicateConfig), "Polar Prime");
  assert.equal(climateFor("ignored", "335", duplicateConfig), "PÓLAR--PRIME", "exact mapping keeps its configured value");
});

test("fallback requires a valid ad ID and a nonempty title, with no campaign or form inference", () => {
  for (const ad_id of [undefined, null, "", "not-an-id", 999]) {
    const value = api.normalizeFacebookLead({ ...lead, ad_id, ad_name: "Polar Prime" }, knownConfig);
    assert.equal(value.climate_name, "");
  }
  for (const ad_name of [undefined, null, "", " \t "]) assert.equal(climateFor(ad_name), "");
  assert.equal(climateFor("Új kampány", "999", knownConfig, {
    campaign_name: "Polar Prime",
    field_data: [{ name: "climate_name", values: ["Polar Prime"] }, { name: "product", values: ["Gree Comfort Pro"] }],
  }), "");
  assert.equal(api.normalizeFacebookLead({ ...lead, field_data: [] }, config).name, "");
});

test("unsupported, brand-only, embedded and longer model names stay unassigned", () => {
  for (const title of [
    "Polar", "Prime", "Gree", "Midea Xtreme Save", "01 | Brand New Model | 280000 Ft",
    "Polar Prime Plus", "01 | Polar Prime Plus | 280000 Ft", "Polar Prime+",
    "01 | Polar Prime + | 280000 Ft", "SuperPolar Prime", "Polar PrimeXL", "PolarPrime",
    "01 | Polar Prime X | 280000 Ft", "Polar Prime 3.5 kW", "Akciós Polar Prime",
    "Polar Prime - 280000 Ft", "01 / Polar Prime / 280000 Ft",
  ]) assert.equal(climateFor(title), "", title);
  assert.equal(climateFor("Polar", "999", { ...config, adClimateMap: { "333": "Polar" } }), "");
  assert.equal(climateFor("Polar Prime", "999", { ...config, adClimateMap: {} }), "");
});

test("titles mentioning multiple known models or an extended second model are ambiguous", () => {
  for (const title of [
    "Polar Prime | Gree Comfort Pro", "Polar Prime / Gree Comfort Pro",
    "Polar Prime | Gree Comfort Pro Plus", "Polar Prime | Gree Comfort Pro+",
    "01 | Polar Prime | Akciós Gree Comfort Pro", "Polar Prime Plus | Gree Comfort Pro",
    "Polar Prime | Polar Prime Plus", "AUX Aura | Tesla Superior",
    "Polar Prime | Gree Comfort ProXL", "Polar Prime | Polar Prime2", "Polar Prime | Akciós Gree Comfort ProXL",
  ]) assert.equal(climateFor(title), "", title);
});

test("a configured longer model must match fully and never inherits the shorter model", () => {
  const extendedConfig = { ...knownConfig, adClimateMap: { ...knownConfig.adClimateMap, "337": "Polar Prime Plus" } };
  assert.equal(climateFor("01 | Polar Prime Plus | 300000 Ft", "999", extendedConfig), "Polar Prime Plus");
  assert.equal(climateFor("01 | Polar Prime+ | 300000 Ft", "999", extendedConfig), "Polar Prime Plus");
  assert.equal(climateFor("Polar Prime Plus | Polar Prime", "999", extendedConfig), "");
});

test("inherited map keys and inherited known-name values cannot identify an ad", () => {
  const inheritedMap = Object.assign(Object.create({ "999": "Polar Prime" }), { "334": "Gree Comfort Pro" });
  const inheritedConfig = { ...config, adClimateMap: inheritedMap };
  assert.equal(climateFor("Unknown title", "999", inheritedConfig), "");
  assert.equal(climateFor("Polar Prime", "998", inheritedConfig), "");
  assert.equal(climateFor("Gree Comfort Pro", "998", inheritedConfig), "Gree Comfort Pro");
});
test("configuration validation rejects unsafe routing and malformed ad mappings", () => {
  assert.ok(api.parseFacebookLeadsConfig(config));
  assert.equal(api.parseFacebookLeadsConfig({ ...config, pageId: "../me" }), null);
  assert.equal(api.parseFacebookLeadsConfig({ ...config, workspaceId: "other" }), null);
  assert.equal(api.parseFacebookLeadsConfig({ ...config, formIds: [] }), null);
  assert.equal(api.parseFacebookLeadsConfig({ ...config, adClimateMap: { invalid: "Polar" } }), null);
  assert.equal(api.parseFacebookLeadsConfig({ ...config, adClimateMap: { 333: "" } }), null);
  assert.equal(api.parseFacebookLeadsConfig({ ...config, cityField: 123 }), null);
  assert.equal(api.parseFacebookLeadsConfig({ ...config, formIds: ["222", "222"] }).formIds.length, 1);
});

test("malformed Graph leads cannot reach normalization/import", () => {
  for (const patch of [{ id: 444 }, { form_id: "../x" }, { created_time: "not a date" },
    { created_time: "2026" }, { created_time: "2026-02-30T10:00:00Z" }, { created_time: "2026-10-05T10:25:00" },
    { field_data: {} }, { field_data: [{ name: "full_name", values: [123] }] }, { ad_id: "../ads" }]) {
    assert.equal(api.validateFacebookGraphLead({ ...lead, ...patch }), false);
  }
});

test("Meta timestamps accept explicit UTC and both timezone offset forms", () => {
  for (const created_time of ["2026-10-05T10:25:00Z", "2026-10-05T10:25:00+0000", "2026-10-05T10:25:00+02:00", "2026-10-05T10:25:00.123Z"]) {
    assert.equal(api.validateFacebookGraphLead({ ...lead, created_time }), true);
  }
});
