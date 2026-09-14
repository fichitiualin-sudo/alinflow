const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument, PDFDict, PDFName, PDFRawStream } = require("pdf-lib");
const { loadTypeScript, ids, report, declaration, input, backend } = require("./document-pdf-fixtures.cjs");
const { loadSavedPdfBundle } = loadTypeScript("src/lib/alinflow/document-pdf-data.ts");
const { createSavedPdfAttachments, createWorkReportPdf, createPurchaseDeclarationPdf } = loadTypeScript("src/lib/alinflow/document-pdf-render.ts");
const { defaultWorkspaceSettings } = loadTypeScript("src/lib/alinflow/workspace-settings.ts");
const settings = defaultWorkspaceSettings(null);

test("saved PDF source requires all workspace/customer/appointment/report links", async () => {
  const db = backend();
  const bundle = await loadSavedPdfBundle(db, input());
  assert.equal(bundle.report.customer_name, report().customer_name);
  assert.equal(bundle.declarations[0].signature_data_url, declaration().signature_data_url);
  assert.notEqual(bundle.report.signature_data_url, bundle.declarations[0].signature_data_url);
  assert.deepEqual(db.queries, [
    { table: "work_reports", filters: { id: ids.report, workspace_id: ids.workspace, customer_id: ids.customer, appointment_id: ids.appointment } },
    { table: "purchase_declarations", filters: { id: ids.declaration, workspace_id: ids.workspace, customer_id: ids.customer, appointment_id: ids.appointment, work_report_id: ids.report } },
  ]);
});

for (const key of ["workspaceId", "customerId", "appointmentId", "workReportId"]) test(`rejects a report from another ${key}`, async () => {
  await assert.rejects(loadSavedPdfBundle(backend(), input({ [key]: ids.other })), (error) => error.status === 404);
});
for (const key of ["workspace_id", "customer_id", "appointment_id", "work_report_id"]) test(`rejects a declaration with wrong ${key}`, async () => {
  const db = backend({ work_reports: [report()], purchase_declarations: [declaration({ [key]: ids.other })] });
  await assert.rejects(loadSavedPdfBundle(db, input()), (error) => error.status === 404);
});
test("invalid scope and unsaved work report are rejected before database access", async () => {
  const db = backend();
  await assert.rejects(loadSavedPdfBundle(db, input({ appointmentId: "" })), (error) => error.status === 400);
  await assert.rejects(loadSavedPdfBundle(db, input({ workReportId: undefined })), (error) => error.status === 400);
  assert.equal(db.queries.length, 0);
});
test("unsigned selected documents cannot be sent; each has its own signature", async () => {
  for (const missing of [{ signature_data_url: "" }, { signed_at: "invalid" }]) {
    await assert.rejects(loadSavedPdfBundle(backend({ work_reports: [report(missing)] }), input({ documents: "work_report" })), (error) => error.status === 409);
    await assert.rejects(loadSavedPdfBundle(backend({ work_reports: [report()], purchase_declarations: [declaration(missing)] }), input()), (error) => error.status === 409);
  }
});
test("individual documents only require the selected saved signature", async () => {
  const onlyReport = await loadSavedPdfBundle(backend(), input({ documents: "work_report", purchaseDeclarationIds: undefined }));
  assert.equal(onlyReport.declarations.length, 0);
  const onlyDeclaration = await loadSavedPdfBundle(backend({ work_reports: [report({ signature_data_url: "", signed_at: null })], purchase_declarations: [declaration()] }), input({ documents: "purchase_declaration" }));
  assert.equal(onlyDeclaration.includeWorkReport, false);
  assert.equal(onlyDeclaration.declarations.length, 1);
});
test("maintenance defaults to only its report and cannot include installation declaration", async () => {
  const db = backend({ work_reports: [report({ appointment_type: "maintenance" })] });
  const bundle = await loadSavedPdfBundle(db, input({ documents: undefined }));
  assert.equal(bundle.declarations.length, 0);
  await assert.rejects(loadSavedPdfBundle(db, input()), (error) => error.status === 400);
});
test("declaration selection is bounded, deduplicated and never inferred", async () => {
  for (const purchaseDeclarationIds of [undefined, [], Array(11).fill(ids.declaration), ["invalid"]]) {
    await assert.rejects(loadSavedPdfBundle(backend(), input({ purchaseDeclarationIds })), (error) => error.status === 400);
  }
  const bundle = await loadSavedPdfBundle(backend(), input({ purchaseDeclarationIds: [ids.declaration, ids.declaration] }));
  assert.equal(bundle.declarations.length, 1);
});

function embeddedImages(document) {
  return document.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
}
test("real PDF attachments have embedded Hungarian fonts and distinct saved signature images", async () => {
  const attachments = await createSavedPdfAttachments(await loadSavedPdfBundle(backend(), input()), { name: "WRONG CURRENT CUSTOMER" }, settings);
  assert.equal(attachments.length, 2);
  const documents = [];
  for (const attachment of attachments) {
    assert.equal(attachment.content_type, "application/pdf");
    assert.match(attachment.filename, /\.pdf$/);
    const bytes = Buffer.from(attachment.content, "base64");
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    const pdf = await PDFDocument.load(bytes);
    assert.ok(pdf.getPageCount() >= 1);
    assert.ok(pdf.getPages()[0].node.Resources().lookup(PDFName.of("Font"), PDFDict).keys().length >= 1);
    assert.equal(embeddedImages(pdf).length, 1);
    documents.push(pdf);
  }
  assert.notDeepEqual(embeddedImages(documents[0])[0][1].contents, embeddedImages(documents[1])[0][1].contents);
});
test("long saved notes and device lists flow to further pages without dropping content", async () => {
  const longReport = report({ notes: Array(120).fill("Árvíztűrő tükörfúrógép: hosszú mentett megjegyzés Ő Ű.").join("\n") });
  const workPdf = await PDFDocument.load(await createWorkReportPdf(longReport, {}, settings));
  assert.ok(workPdf.getPageCount() >= 3);
  assert.equal(embeddedImages(workPdf).length, 1);
  const declarationPdf = await PDFDocument.load(await createPurchaseDeclarationPdf(declaration({ quote_items: Array.from({ length: 70 }, (_, i) => ({ productName: `Mentett készülék ${i + 1} Ő/Ű`, quantity: 1 })) }), report(), {}));
  assert.ok(declarationPdf.getPageCount() >= 4);
  assert.equal(embeddedImages(declarationPdf).length, 1);
});
test("corrupt saved signature and incomplete saved device snapshot stop PDF creation", async () => {
  await assert.rejects(createWorkReportPdf(report({ signature_data_url: "data:image/png;base64,YmFk" }), {}, settings), /aláírás/);
  await assert.rejects(createPurchaseDeclarationPdf(declaration({ quote_items: [{ quantity: 1 }] }), report(), {}), /készülékadata/);
});

test("email route attaches selected saved PDFs to the authorized recipient; ignores body document contents", async () => {
  const realAuth = loadTypeScript("src/lib/alinflow/server-auth.ts");
  let renderedBundle;
  const auth = { ...realAuth, async authorizeCustomerRequest(_request, body) {
    body.customer = { id: ids.customer, name: "Saved <customer>", email: "saved@example.invalid" };
    return { client: backend(), workspaceId: ids.workspace, appointment: { id: ids.appointment } };
  } };
  const route = loadTypeScript("src/app/api/send-work-report/route.ts", {
    "@/lib/alinflow/server-auth": auth, "./server-auth": auth,
    "@/lib/alinflow/document-pdf-render": { async createSavedPdfAttachments(bundle, customer, settings) {
      renderedBundle = bundle;
      return createSavedPdfAttachments(bundle, customer, settings);
    } },
  });
  const previousFetch = global.fetch, previousKey = process.env.RESEND_API_KEY;
  const requests = [];
  global.fetch = async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return Response.json({ id: "synthetic-send" }); };
  process.env.RESEND_API_KEY = "synthetic-not-a-real-key";
  try {
    const response = await route.POST(new Request("https://example.invalid/api/send-work-report", { method: "POST", body: JSON.stringify({
      ...input(), customer: { id: ids.customer, email: "wrong@example.invalid" }, report: { workDescription: "INJECTED BODY" },
    }) }));
    assert.equal(response.status, 200);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body.to, ["saved@example.invalid"]);
    assert.equal(requests[0].body.attachments.length, 2);
    assert.ok(requests[0].body.attachments.every((attachment) => Buffer.from(attachment.content, "base64").subarray(0, 5).toString() === "%PDF-"));
    assert.equal(renderedBundle.report.work_description, report().work_description);
    assert.ok(!requests[0].body.html.includes("<customer>"));
    assert.match(requests[0].body.html, /&lt;customer&gt;/);
    assert.deepEqual((await response.json()).purchaseDeclarationIds, [ids.declaration]);
  } finally { global.fetch = previousFetch; if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey; }
});

test("email route never sends when the saved signature cannot be rendered", async () => {
  const realAuth = loadTypeScript("src/lib/alinflow/server-auth.ts");
  const auth = { ...realAuth, async authorizeCustomerRequest(_request, body) {
    body.customer = { id: ids.customer, email: "synthetic@example.invalid" };
    return { client: backend({ work_reports: [report({ signature_data_url: "data:image/png;base64,YmFk" })] }), workspaceId: ids.workspace, appointment: { id: ids.appointment } };
  } };
  const route = loadTypeScript("src/app/api/send-work-report/route.ts", { "@/lib/alinflow/server-auth": auth, "./server-auth": auth });
  const previousFetch = global.fetch; let sends = 0;
  global.fetch = async () => { sends++; throw new Error("A live email request is forbidden in this test"); };
  try {
    const response = await route.POST(new Request("https://example.invalid/api/send-work-report", { method: "POST", body: JSON.stringify({ ...input({ documents: "work_report" }), customer: { id: ids.customer } }) }));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /aláírás/);
    assert.equal(sends, 0);
  } finally { global.fetch = previousFetch; }
});
