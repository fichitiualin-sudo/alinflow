const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { PDFDocument } = require("pdf-lib");
const { loadTypeScript } = require("./document-pdf-fixtures.cjs");
const { database } = require("./helpers.cjs");
const overrides = { "@/lib/supabase": { supabase: {} } };
const h = loadTypeScript("src/lib/alinflow/h-tariff.ts", overrides);
const { buildHTariffPdf } = loadTypeScript("src/lib/alinflow/h-tariff-pdf.ts", overrides);
const scope = { workspaceId: "11111111-1111-4111-8111-111111111111", customerId: "22222222-2222-4222-8222-222222222222", appointmentId: "33333333-3333-4333-8333-333333333333", appointmentType: "installation", workDate: "2026-09-14", workTime: "08:00" };
const data = (provider = "eon", patch = {}) => h.normalizeHTariffData({ provider, applicantName: "TESZT Őri Tűnde", postalCode: "1111", installationAddress: "1111 Tesztváros, Ősz utca ű/2.", customerIdentifier: "1012345678", consumptionPlaceIdentifier: "0412345678", meteringPointIdentifier: "HU0001234567890123456789012345678", totalSimultaneousElectricalKw: "2,4", location: "Tesztváros", date: "2026-09-14", installerName: "TESZT Klímaszerelő", installerAddress: "1111 Tesztváros, Ősz utca 2.", installerPhone: "0612345678", installerEmail: "installer@example.invalid", electricianName: "TESZT Villanyszerelő", electricianAddress: "1111 Tesztváros, Hosszú utca ű/2.", electricianPhone: "0612345679", electricianEmail: "electric@example.invalid", notes: "Árvíztűrő tükörfúrógép - TESZT", ...patch });
const device = (index = 1, patch = {}) => ({ ...scope, id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`, productKey: "product:test", productName: "TESZT klíma", unitNumber: index, data: { manufacturer: "TESZT Gyártó", indoorModel: "IN-35-TEST", outdoorModel: "OUT-35-TEST", indoorSerial: `IN${index}`, outdoorSerial: `OUT${index}`, nominalElectricalKw: "1,2", heatingCapacityKw: "3,8", scop: "4,6", systemType: "air-air", phaseCount: "1", startCurrentReduction: "inverter", nominalCurrentA: "5,5", maximumCurrentA: "9,5", recommendedFuse: "C16 A", supplementaryHeaterKw: "0", supplementaryHeaterSeparable: "", supplementaryHeaterSharePercent: "", systemUsage: "heating-cooling", heatSource: "air", heatingSeasonKwh: "900", summerSeasonKwh: "120", ...patch } });

test("H tariff starts without an assumed distributor and ignores technical guesses from a marketing name", () => {
  const defaults = h.defaultHTariffData({ name: "Saved name", city: "Town", address: "Street", postalCode: "1111", quoteItems: [{ productName: "Ultra 3.5 kW SCOP5", quantity: 2 }] }, { companyProfile: { legalName: "Saved installer", address: "", phone: "", email: "" } });
  assert.equal(defaults.provider, "");
  assert.equal(defaults.applicantName, "Saved name");
  assert.equal(defaults.installerName, "Saved installer");
  assert.equal(defaults.totalSimultaneousElectricalKw, "");
  assert.equal(h.normalizeHTariffData({ provider: "mvm-emasz", signature: "FORGED", applicantName: {} }).provider, "");
  assert.equal(h.normalizeHTariffData({ signature: "FORGED" }).signature, undefined);
});

test("H tariff accepts checked decimal values but rejects missing, invalid and COP-only inputs", () => {
  assert.deepEqual(h.validateHTariff(data(), [device()], scope), []);
  assert.deepEqual(h.validateHTariff(data("mvm-demasz"), [device()], scope), []);
  assert.equal(h.hTariffNumber("1,25"), 1.25);
  for (const value of ["", "3.5kW", "Infinity", "-1", "1,2,3"]) assert.equal(h.hTariffNumber(value), null);
  for (const patch of [{ scop: "" }, { scop: "3.2" }, { nominalElectricalKw: "0" }, { systemType: "" }, { heatSource: "well" }]) assert.ok(h.validateHTariff(data(), [device(1, patch)], scope).length);
  assert.ok(h.validateHTariff(data("mvm-demasz", { date: "2026-02-31" }), [device()], scope).length);
  assert.ok(h.validateHTariff(data("mvm-demasz", { customerIdentifier: "0412345678" }), [device()], scope).length);
  assert.ok(h.validateHTariff(data(), [{ ...device(), appointmentId: "other" }], scope).length);
  assert.ok(h.validateHTariff(data(), [device(), device()], scope).length);
  assert.ok(h.validateHTariff(data(), [], scope).length);
});

test("auxiliary heating requires its actual separation and percentage data only when present", () => {
  assert.deepEqual(h.validateHTariff(data(), [device(1, { supplementaryHeaterKw: "0" })], scope), []);
  assert.ok(h.validateHTariff(data(), [device(1, { supplementaryHeaterKw: "1" })], scope).length);
  assert.ok(h.validateHTariff(data(), [device(1, { supplementaryHeaterKw: "1", supplementaryHeaterSeparable: "no", supplementaryHeaterSharePercent: "101" })], scope).length);
  assert.deepEqual(h.validateHTariff(data(), [device(1, { supplementaryHeaterKw: "1", supplementaryHeaterSeparable: "no", supplementaryHeaterSharePercent: "10" })], scope), []);
});

test("blank required numeric fields have one message while invalid entered values keep range guidance", () => {
  for (const provider of ["eon", "mvm-demasz"]) {
    const fields = ["nominalElectricalKw", "heatingCapacityKw", "scop", ...(provider === "eon" ? ["nominalCurrentA", "maximumCurrentA", "supplementaryHeaterKw"] : ["heatingSeasonKwh", "summerSeasonKwh"])];
    for (const key of fields) {
      for (const blank of ["", "   ", undefined]) {
        const messages = h.validateHTariff(data(provider), [device(1, { [key]: blank })], scope).filter((issue) => issue.deviceField === key);
        assert.equal(messages.length, 1, `${provider}/${key} should report a missing value once`);
        assert.equal(messages[0].label, h.hTariffDeviceFields(provider).find((field) => field.key === key).label);
      }
      const invalid = h.validateHTariff(data(provider), [device(1, { [key]: "nem szám" })], scope).filter((issue) => issue.deviceField === key);
      assert.equal(invalid.length, 1);
      assert.match(invalid[0].label, /pozitív szám szükséges/);
    }
  }
});

test("E.ON groups only identical technical systems; MVM has one form per physical unit", () => {
  const units = [device(1), device(2), device(3, { scop: "4.7" }), device(4, { outdoorModel: "OTHER" })];
  assert.deepEqual(h.hTariffDeviceGroups("eon", units).map((group) => group.length), [2, 1, 1]);
  assert.deepEqual(h.hTariffDeviceGroups("mvm-demasz", units).map((group) => group.length), [1, 1, 1, 1]);
});

test("official source templates have their audited exact hashes", () => {
  const files = { "eon-25-htb-1-2.pdf": "8fe2323df2f4635cf0cc194dc2ca23af06ca8557deccc4e72d5f80b422a2e945", "mvm-aszab-10-ny03.pdf": "c8756b5b3311d113fdc3efa3a7c4169ada99a52c5b3c85192d835b578d829048" };
  for (const [name, hash] of Object.entries(files)) assert.equal(createHash("sha256").update(fs.readFileSync(path.resolve("public/forms/h-tariff", name))).digest("hex"), hash);
});

for (const provider of ["eon", "mvm-demasz"]) test(`${provider} PDF contains complete official pages and canonical editable fields for every form`, async () => {
  const units = [device(1), device(2, provider === "eon" ? { outdoorModel: "OUT-50-TEST" } : {})];
  const bytes = await buildHTariffPdf(data(provider), units, scope);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 4);
  assert.equal(pdf.getForm().getTextField("h_1.applicantName").getText(), "TESZT Őri Tűnde");
  assert.equal(pdf.getForm().getTextField("h_2.applicantName").getText(), "TESZT Őri Tűnde");
  if (provider === "eon") assert.equal(pdf.getForm().getTextField("h_2.model").getText(), "IN-35-TEST / OUT-50-TEST");
  else {
    assert.equal(pdf.getForm().getTextField("h_2.indoorModel").getText(), "IN-35-TEST");
    assert.equal(pdf.getForm().getTextField("h_2.outdoorModel").getText(), "OUT-35-TEST");
  }
  const fields = pdf.getForm().getFields();
  assert.equal(new Set(fields.map((field) => field.getName())).size, fields.length);
  for (const field of fields) {
    assert.equal(field.acroField.getWidgets().length, 1);
    const appearance = field.acroField.getWidgets()[0].getAppearances();
    assert.ok(appearance?.normal, `${field.getName()} missing appearance`);
  }
  assert.ok(fields.every((field) => !field.getName().toLowerCase().includes("signature")));
  if (process.env.H_TARIFF_RENDER_DIR) {
    fs.mkdirSync(process.env.H_TARIFF_RENDER_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.H_TARIFF_RENDER_DIR, `${provider}-filled.pdf`), bytes);
  }
});

test("E.ON count is populated and Hungarian source data survives roundtrip", async () => {
  const pdf = await PDFDocument.load(await buildHTariffPdf(data(), [device(1), device(2)], scope));
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getForm().getTextField("h_1.quantityCount").getText(), "2");
  assert.ok(pdf.getForm().getCheckBox("h_1.quantity.multiple").isChecked());
  assert.ok(!pdf.getForm().getCheckBox("h_1.quantity.one").isChecked());
  assert.equal(pdf.getForm().getTextField("h_1.notes").getText(), data().notes);
  assert.equal(pdf.getForm().getTextField("h_1.meteringPointIdentifier").getText(), data().meteringPointIdentifier.slice(5));
});

test("invalid or unreasonably long values stop PDF generation instead of clipping or inventing", async () => {
  await assert.rejects(buildHTariffPdf(data(), [device(1, { scop: "" })], scope), /SCOP/);
  await assert.rejects(buildHTariffPdf(data("eon", { applicantName: "Long".repeat(300) }), [device()], scope), /túl hosszú/);
});

test("H tariff storage reads and updates exact scope with optimistic versioning", async () => {
  const calls = [];
  const db = database((op) => { calls.push(op); return { data: { data: data(), updated_at: "version-2" }, error: null }; });
  const store = loadTypeScript("src/lib/alinflow/h-tariff-store.ts", { "@/lib/supabase": { supabase: db } });
  const found = await store.loadHTariffRequest(scope);
  await store.saveHTariffRequest(scope, found.data, { ...found, updatedAt: "version-1" });
  for (const call of calls) assert.deepEqual({ workspace_id: call.filters.workspace_id, customer_id: call.filters.customer_id, appointment_id: call.filters.appointment_id }, { workspace_id: scope.workspaceId, customer_id: scope.customerId, appointment_id: scope.appointmentId });
  assert.equal(calls[1].filters.updated_at, "version-1");
  assert.equal(calls[1].method, "update");
  await assert.rejects(store.loadHTariffRequest({ ...scope, appointmentType: "maintenance" }), /telepítési/);
  assert.equal(calls.length, 2);
  const failedStore = loadTypeScript("src/lib/alinflow/h-tariff-store.ts", { "@/lib/supabase": { supabase: database(() => ({ data: null, error: { code: "PGRST116" } })) } });
  await assert.rejects(failedStore.saveHTariffRequest(scope, data(), found), /közben máshol/);
});

function routeFixture({ missingDevice = false, missingQuote = false, denied = false, staleSlots = false } = {}) {
  const calls = [];
  let built;
  const rows = [device(1), device(2), { ...device(3), productKey: "product:obsolete" }].map((unit) => ({ id: unit.id, workspace_id: unit.workspaceId, customer_id: unit.customerId, appointment_id: unit.appointmentId, product_key: unit.productKey, product_name: unit.productName, unit_number: unit.unitNumber, data: unit.data }));
  const db = database((op) => {
    calls.push(op);
    const result = op.table === "h_tariff_requests" ? { data: data() } : op.table === "appointment_devices" ? rows.slice(missingDevice ? 1 : 0) : op.table === "quotes" ? { id: "saved-quote" } : [{ description: "test|install_price=0", product_name: "TESZT klíma", quantity: 2 }];
    return { data: result, error: null };
  });
  const realAuth = loadTypeScript("src/lib/alinflow/server-auth.ts");
  const route = loadTypeScript("src/app/api/h-tariff/pdf/route.ts", {
    "@/lib/supabase": { supabase: {} },
    "@/lib/alinflow/server-auth": { ...realAuth, authorizeCustomerRequest: async (_request, body) => {
      if (denied) throw new realAuth.ApiError("Denied", 403);
      body.customer = { id: scope.customerId };
      return { client: db, workspaceId: scope.workspaceId, appointment: { id: scope.appointmentId, appointment_type: "installation", quote_id: missingQuote ? null : "saved-quote" } };
    } },
    "@/lib/alinflow/h-tariff-pdf": { buildHTariffPdf: async (...args) => { built = args; return Buffer.from("%PDF-TEST"); } },
  });
  return { route, calls, getBuilt: () => built, request: () => new Request("https://example.invalid/api/h-tariff/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: "untrusted", customer: { id: "untrusted" }, data: { applicantName: "FORGED" }, devices: [device(99)], expectedDeviceSlots: staleSlots ? ["product:test:1"] : ["product:test:1", "product:test:2"] }) }) };
}

test("H PDF endpoint only uses scoped saved data and current appointment quote slots", async () => {
  const fixture = routeFixture();
  const response = await fixture.route.POST(fixture.request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(fixture.getBuilt()[0].applicantName, data().applicantName);
  assert.equal(fixture.getBuilt()[1].length, 2);
  assert.ok(fixture.getBuilt()[1].every((unit) => unit.productKey === "product:test"));
  assert.ok(fixture.calls.every((call) => call.filters.workspace_id === scope.workspaceId));
  assert.equal(fixture.calls.find((call) => call.table === "quote_items").filters.quote_id, "saved-quote");
});

test("H PDF endpoint stops on missing device, stale slot list, absent appointment quote or denied auth", async () => {
  for (const [options, status] of [[{ missingDevice: true }, 409], [{ staleSlots: true }, 409], [{ missingQuote: true }, 400], [{ denied: true }, 403]]) {
    const fixture = routeFixture(options);
    assert.equal((await fixture.route.POST(fixture.request())).status, status);
    assert.equal(fixture.getBuilt(), undefined);
    if (options.denied || options.missingQuote) assert.equal(fixture.calls.length, 0);
  }
});
