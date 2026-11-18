const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const { Children, isValidElement } = require("react");
const { harness, source } = require("./helpers.cjs");

const h = harness({}, { "react/jsx-runtime": require("react/jsx-runtime") });
const { statusMeansSent } = h.load("src/lib/alinflow/documents.ts");
const customer = Object.freeze({
  id: "customer", activeAppointmentId: "survey", activeQuoteId: "quote",
  quoteReceiptScope: { quoteId: "quote", appointmentId: "survey",
    notBefore: "2026-11-01T00:00:00Z", notAfter: "2026-11-08T00:00:00Z" },
});
const sentAt = "2026-11-05T09:00:00Z";
const documents = [
  { id: "survey-receipt", type: "quote_email", appointmentId: "survey", sentAt },
  { id: "other-work", type: "quote_email", appointmentId: "installation", sentAt },
  { id: "legacy-linked", type: "quote_email", sentAt },
  { id: "legacy-unlinked", type: "quote_email", status: "Elküldve", createdAt: "2026-09-01T09:00:00Z" },
  { id: "draft", type: "quote_email", status: "Nincs kész", createdAt: sentAt },
  { id: "appointment-email", type: "appointment_email", sentAt },
];
const version = Object.freeze({ id: "delivery", kind: "sent", total: 1000 });

function page() {
  const session = { workspaceId: "workspace", userId: "user" };
  const state = {};
  const ctx = {
    activeWorkspace: { id: session.workspaceId }, user: { id: session.userId },
    currentWorkspaceId: () => session.workspaceId,
    authUserIdRef: { get current() { return session.userId; } },
    documentRefresh: 1, statusMeansSent,
    documentsByCustomer: { customer: documents, stranger: [{ id: "foreign", type: "quote_email", sentAt }] },
    QuoteDocuments: "quote-list",
    setQuoteVersionPreview: value => { state.preview = value; },
    setDocumentPreviewType: value => { state.type = value; },
    setDocumentBackView: value => { state.back = value; },
    navigateToView: value => { state.view = value; },
    // A document click must preserve the active work editor and its unsaved lines.
    setSelected() { assert.fail("Archive preview changed the selected customer"); },
    setQuoteItems() { assert.fail("Archive preview changed the active quote"); },
    fullCustomerAddress: () => "", climateSummary: () => "", customerInquiryLabel: () => "",
    documentRowsFor: () => [{ action: "Ajánlat", title: "Ajánlat email" }, { action: "Munkalap", title: "Munkalap" }],
    maintenanceDocumentRowsFor: () => [],
    renderDocumentLibrarySection: (_customer, _title, rows) => rows.map(row => row.title).join(" "),
  };
  const fns = h.functions(["renderQuoteDocuments", "renderDocumentLibraryCustomerCard", "documentLibrarySectionsFor",
    "quoteDocumentFor", "sentDocumentTimestamp", "timeValue"], ctx);
  return { ctx, state, session, ...fns };
}

function descendants(element) {
  if (!isValidElement(element)) return [element];
  return [element, ...Children.toArray(element.props.children).flatMap(descendants)];
}

const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findWorkPanel(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "WorkPagePanel") return node;
  return ts.forEachChild(node, findWorkPanel);
}
const workPanel = findWorkPanel(ast);
function workProp(name, context) {
  const attr = workPanel.attributes.properties.find(prop => prop.name?.getText(ast) === name);
  assert.ok(attr?.initializer?.expression, "Missing work page prop: " + name);
  return vm.runInNewContext(attr.initializer.expression.getText(ast), context);
}

test("customer document library includes all quote receipts once alongside the other documents", () => {
  const p = page();
  const contents = descendants(p.renderDocumentLibraryCustomerCard(customer));
  const lists = contents.filter(element => element?.type === "quote-list");
  assert.equal(lists.length, 1);
  assert.ok(contents.includes("Munkalap"));
  assert.ok(!contents.includes("Ajánlat email"));
  const props = lists[0].props;
  assert.equal(props.workspaceId, "workspace");
  assert.equal(props.customerId, customer.id);
  assert.equal(props.appointmentId, undefined);
  assert.equal(props.activeQuoteId, undefined);
  assert.deepEqual(Array.from(props.receipts, receipt => receipt.id),
    ["survey-receipt", "other-work", "legacy-linked", "legacy-unlinked"]);
  props.onPreview(version);
  assert.equal(p.state.back, "documents");
  assert.equal(p.state.view, "documentPreview");
  assert.equal(p.state.type, "quote_version");
  assert.equal(p.state.preview.document, version);
  assert.equal(p.state.preview.customer, customer);
});

test("work documents use the selected work and bounded legacy receipt, and reopen on return to that work", () => {
  const p = page();
  const elements = workProp("quoteDocuments", { selected: customer, renderQuoteDocuments: p.renderQuoteDocuments });
  const props = elements.props;
  assert.equal(props.appointmentId, "survey");
  assert.equal(props.activeQuoteId, "quote");
  assert.deepEqual(Array.from(props.receipts, receipt => receipt.id), ["survey-receipt", "legacy-linked"]);
  assert.equal(props.receipts[1].quoteId, customer.activeQuoteId);
  props.onPreview(version);
  assert.equal(p.state.preview.document, version);
  assert.equal(p.state.back, "work");
  const returning = { ...p.ctx, documentBackView: p.state.back, quoteVersionPreview: p.state.preview, selected: customer };
  assert.equal(workProp("initialDocumentsOpen", returning), true);
  assert.equal(workProp("initialDocumentsOpen", { ...returning, selected: { ...customer, activeAppointmentId: "installation" } }), false);
  assert.equal(workProp("initialDocumentsOpen", { ...returning, documentBackView: "documents" }), false);
});

test("an old quote document click cannot reopen another workspace's or user's preview", () => {
  const p = page();
  const { onPreview } = p.renderQuoteDocuments(customer, "documents").props;
  p.session.workspaceId = "other-workspace";
  onPreview(version);
  p.session.workspaceId = "workspace";
  p.session.userId = "other-user";
  onPreview(version);
  assert.deepEqual(p.state, {});
});
