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

test("unmapped and organic leads do not guess climate from ad titles", () => {
  for (const ad_id of [undefined, "999"]) {
    assert.equal(api.normalizeFacebookLead({ ...lead, ad_id, ad_name: "Polar Prime" }, config).climate_name, "");
  }
  assert.equal(api.normalizeFacebookLead({ ...lead, field_data: [] }, config).name, "");
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
