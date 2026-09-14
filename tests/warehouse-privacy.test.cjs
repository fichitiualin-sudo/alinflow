const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { renderToStaticMarkup } = require("react-dom/server");
const { harness, repo } = require("./helpers.cjs");

const h = harness({ URLSearchParams }, { "react/jsx-runtime": require("react/jsx-runtime") });
const products = h.load("src/lib/alinflow/products.ts");
const declarations = h.load("src/lib/alinflow/purchase-declarations.ts");
const appointments = h.load("src/lib/alinflow/appointments.ts");
const settingsModule = h.load("src/lib/alinflow/workspace-settings.ts");
const settings = settingsModule.defaultWorkspaceSettings(null);
const marker = "WAREHOUSE_ONLY_ACQUISITION_COST";
const privateFields = { purchasePrice: 9876543.21, purchase_price: 9876543.21,
  costPrice: 9876543.21, inventoryPurchasePrices: { memo: marker, unitPrice: 9876543.21 } };
const withPrivateFields = (value) => ({ ...value, ...privateFields });
const plain = (value) => JSON.parse(JSON.stringify(value));
const assertPrivateExcluded = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert.doesNotMatch(text, /WAREHOUSE_ONLY_ACQUISITION_COST|purchasePrice|purchase_price|costPrice|inventoryPurchasePrices/);
  assert.doesNotMatch(text, /9[\s\u00a0\u202f]?876[\s\u00a0\u202f]?543(?:[.,]21)?/);
};
const issuedAt = "2026-09-14T08:00:00Z";
const catalog = { id: "privacy-ac", name: "Synthetic AC", price: 240000, installPrice: 60000 };
products.setActiveProducts([withPrivateFields(catalog)]);
const items = [{ productId: catalog.id, quantity: 2 }, { productId: "", productName: "Manual AC",
  customName: "Manual AC", isManual: true, quantity: 1, customPrice: 180000, customInstallPrice: 50000 }];
const customer = { id: "synthetic-customer", activeAppointmentId: "synthetic-appointment", name: "Synthetic Customer",
  email: "synthetic@example.invalid", phone: "TEST", city: "Test", postalCode: "0000", address: "Test street",
  status: "Időpont foglalva", appointmentType: "installation", date: "2026-09-14", time: "08:00", quoteItems: items };
const report = { id: "synthetic-report", appointmentType: "installation", workDate: customer.date, workTime: customer.time,
  workDescription: "Synthetic completed work", signerName: customer.name, signedAt: issuedAt };
const pollutedItems = items.map(withPrivateFields);
const pollutedCustomer = withPrivateFields({ ...customer, quoteItems: pollutedItems });
const { quotePayload, workReportPayload } = h.functions(["quotePayload", "workReportPayload"], {
  ...products, ...appointments, selected: customer, quoteItems: items, quoteIssuedAt: issuedAt, workspaceSettings: settings,
});

// Exercise actual route render functions without invoking their network/auth entrypoints.
function routeFunctions(route) {
  const file = `src/app/api/${route}/route.ts`;
  const source = fs.readFileSync(path.join(repo, file), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = tree.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name).map((node) => node.name.text);
  return h.functions(names, { ...products, ...appointments, ...settingsModule,
    ...h.load("src/lib/alinflow/billing.ts") }, file);
}

test("warehouse privacy: quote normalization preserves known fields but drops every unknown internal field", () => {
  const original = withPrivateFields({ productId: catalog.id, productName: "Saved AC", quantity: 3,
    customName: "  Custom AC  ", customPrice: 230000, customInstallPrice: 55000, isManual: true });
  const clean = products.cleanQuoteItems([original]);
  assert.deepEqual(plain(clean), [{ productId: catalog.id, productName: "Saved AC", quantity: 3,
    customName: "Custom AC", customPrice: 230000, customInstallPrice: 55000, isManual: true }]);
  assertPrivateExcluded(clean);
  assert.equal(original.inventoryPurchasePrices.memo, marker);
  assert.equal(products.cleanQuoteItems([{ productId: "", quantity: 1, ...privateFields }]).length, 0);
});

test("warehouse privacy: catalog and custom customer prices remain unchanged by acquisition prices", () => {
  assertPrivateExcluded(products.normalizeProduct(withPrivateFields(catalog)));
  assert.equal(products.total(items), 660000);
  assert.equal(products.quoteInstallTotal(items), 170000);
  for (const input of [pollutedItems, products.cleanQuoteItems(pollutedItems)]) {
    assert.equal(products.total(input), 660000);
    assert.equal(products.quoteInstallTotal(input), 170000);
    assert.deepEqual(input.map(products.itemTotal), [480000, 180000]);
    assert.deepEqual(input.map(products.itemInstallTotal), [120000, 50000]);
  }
});

test("warehouse privacy: persisted quote rows and declaration snapshots exclude acquisition data", () => {
  for (const item of pollutedItems) assertPrivateExcluded(products.quoteItemToRow(item, "synthetic-quote"));
  const row = declarations.declarationToRow({ customerId: customer.id, appointmentId: customer.activeAppointmentId,
    workReportId: report.id, seller: declarations.DEFAULT_SELLER_COMPANY, quoteItems: pollutedItems,
    report: withPrivateFields(report), legacySourceKey: "synthetic-declaration" });
  assertPrivateExcluded(row);
  assert.equal(row.quote_items[0].productName, catalog.name);
  const restored = declarations.declarationFromRow({ ...row, id: "synthetic-declaration", quote_items: pollutedItems });
  assertPrivateExcluded(restored);
  assert.equal(restored.quoteItems[1].customPrice, 180000);
});

test("warehouse privacy: customer email request payloads never contain acquisition fields", () => {
  const clean = quotePayload(customer, items, issuedAt);
  const dirty = quotePayload(pollutedCustomer, pollutedItems, issuedAt);
  assert.deepEqual(plain(dirty), plain(clean));
  assertPrivateExcluded(dirty);
  assert.equal(dirty.totalAmount, 660000);
  assert.equal(dirty.installerAmount, 170000);
  assert.equal(dirty.materialAmount, 490000);
  const pdfRequest = workReportPayload(withPrivateFields(report), pollutedCustomer, ["synthetic-declaration"], "both");
  assertPrivateExcluded(pdfRequest);
  assert.deepEqual(Object.keys(pdfRequest.customer).sort(), ["activeAppointmentId", "email", "id"]);
});

for (const route of ["send-quote", "send-appointment", "send-thank-you"]) {
  test(`warehouse privacy: ${route} email HTML excludes injected acquisition data`, () => {
    const api = routeFunctions(route);
    const payload = quotePayload(customer, items, issuedAt);
    const render = (target, lines) => route === "send-quote"
      ? api.quoteEmailHtml(target, lines, payload.totalAmount, "bundle", issuedAt, settings)
      : route === "send-appointment" ? api.appointmentEmailHtml(target, lines, settings)
        : api.thankYouEmailHtml(target, lines, settings);
    const html = render(pollutedCustomer, payload.items.map(withPrivateFields));
    assert.equal(html, render(customer, payload.items));
    assertPrivateExcluded(html);
    assert.match(html, /Synthetic AC/);
  });
}

test("warehouse privacy: printable customer documents and signed ZIP source HTML exclude acquisition data", () => {
  const previews = h.load("src/components/alinflow/DocumentPreviewDocuments.tsx");
  for (const name of ["QuoteDocument", "AppointmentConfirmationDocument", "WorkReportDocument", "PurchaseDeclarationDocument"]) {
    const props = { customer: pollutedCustomer, quoteItems: pollutedItems, report: withPrivateFields(report),
      seller: declarations.DEFAULT_SELLER_COMPANY, workspaceSettings: settings, quoteIssuedAt: issuedAt };
    const html = renderToStaticMarkup(previews[name](props));
    assertPrivateExcluded(html);
    assert.equal(html, renderToStaticMarkup(previews[name]({ ...props, customer, quoteItems: items, report })));
  }
  const exports = h.load("src/lib/alinflow/signed-document-export.ts");
  assertPrivateExcluded(exports.buildWorkReportHtml(pollutedCustomer, withPrivateFields(report), pollutedItems, settings));
  assertPrivateExcluded(exports.buildPurchaseDeclarationHtml(pollutedCustomer,
    withPrivateFields({ id: "synthetic-declaration", quoteItems: pollutedItems, signedAt: issuedAt })));
});

test("warehouse privacy: PDF renderers only pass public document fields to the PDF writer", async () => {
  const writes = [];
  const record = (...values) => writes.push(values);
  const pdfHarness = harness({}, { "./document-pdf": { async createDocumentPdf(title) {
    record(title);
    return { text: record, field: record, section: record, table: record, signature: record,
      keepTogether() {}, textHeight() { return 20; }, async save() { return new Uint8Array(); } };
  } } });
  const render = pdfHarness.load("src/lib/alinflow/document-pdf-render.ts");
  const savedReport = { id: report.id, appointment_type: "installation", work_date: customer.date,
    work_time: customer.time, customer_name: customer.name, climate_summary: "2 db Synthetic AC",
    work_description: report.workDescription, signer_name: customer.name, signed_at: issuedAt };
  const savedDeclaration = { id: "synthetic-declaration", seller_name: "Synthetic seller",
    quote_items: pollutedItems.map((item) => ({ ...item, productName: products.itemName(item) })),
    signer_name: customer.name, signed_at: issuedAt };
  await render.createWorkReportPdf(withPrivateFields(savedReport), pollutedCustomer, settings);
  await render.createPurchaseDeclarationPdf(withPrivateFields(savedDeclaration), withPrivateFields(savedReport), pollutedCustomer);
  assertPrivateExcluded(writes);
  assert.match(JSON.stringify(writes), /Synthetic AC/);
});

test("warehouse privacy: invoice XML and calendar URLs exclude acquisition data and preserve sale totals", () => {
  const api = routeFunctions("create-invoice");
  for (const kind of ["device", "labor", "combined", "maintenance"]) {
    const input = { kind, amount: 660000, customer: pollutedCustomer, quoteItems: pollutedItems, sendEmail: true };
    const xml = api.buildInvoiceXml(input, "synthetic-agent-key");
    assert.equal(xml, api.buildInvoiceXml({ ...input, customer, quoteItems: items }, "synthetic-agent-key"));
    assertPrivateExcluded(xml);
    const gross = [...xml.matchAll(/<bruttoErtek>(\d+)<\/bruttoErtek>/g)].reduce((sum, match) => sum + Number(match[1]), 0);
    assert.equal(gross, 660000);
  }
  const calendar = h.load("src/lib/alinflow/calendar.ts");
  assert.equal(calendar.googleCalendarHref(pollutedCustomer), calendar.googleCalendarHref(customer));
  assertPrivateExcluded(decodeURIComponent(calendar.googleCalendarHref(pollutedCustomer)));
});
