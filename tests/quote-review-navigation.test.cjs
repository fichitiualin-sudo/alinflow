const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const jsx = require("react/jsx-runtime");
const { harness, noop, source } = require("./helpers.cjs");

const h = harness({}, { "react/jsx-runtime": jsx });
const { cleanQuoteItems, total } = h.load("src/lib/alinflow/products.ts");
const { manualQuoteScope } = h.load("src/lib/alinflow/manual-quote-attempt.ts");
const { DocumentActionButtons } = h.load("src/components/alinflow/DocumentCards.tsx");
const tree = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const home = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "HomeContent");
const routes = home.body.statements.filter(node => ts.isIfStatement(node) && /<Quote(?:Builder|Preview)Panel\b/.test(node.getText(tree)));
const routeCode = ts.transpileModule("function renderRoute() {" + routes.map(node => node.getText(tree)).join("\n") + "}",
  { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let workReview;
(function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "WorkPagePanel") {
    workReview = node.attributes.properties.find(prop => prop.name?.getText(tree) === "onReviewQuote")?.initializer?.expression;
  }
  ts.forEachChild(node, visit);
})(tree);

const item = price => ({ isManual: true, customName: "Mintaklíma", quantity: 1, customPrice: price });
const issuedAt = "2026-10-12T10:00:00.000Z";
const sentAt = "2026-10-12T10:04:00.000Z";

function page({ previous, attempt, stored } = {}) {
  const selected = { id: "customer", activeQuoteId: "quote", activeAppointmentId: "survey", quoteItems: [item(100)] };
  const quoteReceiptsRef = { current: new Map() };
  if (attempt) quoteReceiptsRef.current.set(manualQuoteScope("office", "user", selected), attempt);
  const calls = { send: 0, back: [], warnings: [] };
  const ctx = {
    require: () => jsx, exports: {}, QuoteBuilderPanel: "builder", QuotePreviewPanel: "preview",
    selected, selectedCustomerIdRef: { current: selected.id }, currentViewRef: { current: "quote" },
    currentWorkspaceId: () => "office", authUserIdRef: { current: "user" }, quoteReceiptsRef, manualQuoteScope,
    storedManualQuoteAttempt: () => stored, quoteSentAtFor: () => previous, renderQuoteActions: () => "new-quote",
    cleanQuoteItems, total, quoteItems: [item(250)], t: 250, installer: 0, materialPrice: 250,
    products: [], workspaceSettings: {}, quoteEmailBusy: false, canEditWorkResources: true, quoteIssuedAt: "",
    startInstallationScheduleFromQuote: noop, updateQuotePricingMode: noop, updateQuoteItem: noop,
    updateQuoteProduct: noop, removeQuoteItem: noop, syncQuoteItemPrice: noop, addQuoteItem: noop, addManualQuoteItem: noop,
    setQuoteIssuedAt: value => { ctx.quoteIssuedAt = value; },
    navigateToView: view => { ctx.currentViewRef.current = view; },
    goBack: view => { calls.back.push(view); ctx.currentViewRef.current = view; },
    setMessage: message => { calls.warnings.push(message); },
    sendQuoteEmail: async () => { calls.send++; return ctx.complete; },
  };
  ctx.openQuoteForReview = h.functions(["openQuoteForReview"], ctx).openQuoteForReview;
  vm.createContext(ctx);
  vm.runInContext(routeCode, ctx);
  const render = view => { ctx.view = ctx.currentViewRef.current = view; return ctx.renderRoute().props; };
  return { ctx, calls, render };
}

test("a work's current quote opens the actual review without sending or replacing the edited price", () => {
  const { ctx, calls, render } = page();
  assert.ok(workReview, "The work must expose a review action");
  const onReviewQuote = vm.runInContext(workReview.getText(tree), ctx);
  const button = DocumentActionButtons({ customer: ctx.selected, row: { action: "Ajánlat" }, onReviewQuote });
  button.props.onClick();
  assert.equal(calls.send, 0);
  assert.equal(ctx.currentViewRef.current, "quotePreview");
  assert.equal(render("quotePreview").totalAmount, 250);
});

test("the ordinary editor reviews first, then offers a separate new quote after a confirmed send", () => {
  for (const [previous, newAction] of [[undefined, undefined], [sentAt, "new-quote"]]) {
    const { ctx, calls, render } = page({ previous });
    const props = render("quote");
    assert.equal(props.quoteActions, newAction);
    assert.equal(props.onSendQuoteEmail, undefined);
    assert.equal(props.deliveryStep, undefined);
    props.onPreview();
    assert.equal(ctx.currentViewRef.current, "quotePreview");
    assert.equal(calls.send, 0);
  }
});

test("retry retains the issue date and a logging-only review shows the originally accepted items", () => {
  const accepted = { id: "customer", quoteItems: [item(100)] };
  const attempt = { customer: accepted, requestBody: JSON.stringify({ quoteIssuedAt: issuedAt }) };
  for (const [state, step, price] of [
    [{ stored: { issuedAt } }, "retry", 250],
    [{ attempt }, "retry", 250],
    [{ attempt: { ...attempt, sentAt } }, "record", 100],
  ]) {
    const { calls, render } = page(state);
    const editor = render("quote");
    assert.equal(editor.deliveryStep, step);
    assert.equal(editor.quoteActions, "new-quote");
    editor.onPreview();
    const review = render("quotePreview");
    assert.equal(review.quoteIssuedAt, issuedAt);
    assert.equal(review.deliveryStep, step);
    assert.equal(review.totalAmount, price);
    if (step === "record") assert.equal(review.selected, accepted);
    assert.equal(calls.send, 0);
  }
});

test("a failed confirmation leaves the preview open and a confirmed send returns once", async () => {
  const { ctx, calls, render } = page();
  const review = render("quotePreview");
  ctx.complete = false;
  await review.onSendQuote();
  assert.deepEqual(calls.back, []);
  assert.equal(ctx.currentViewRef.current, "quotePreview");
  ctx.complete = true;
  await review.onSendQuote();
  assert.deepEqual(calls.back, ["quote"]);
  assert.equal(calls.send, 2);
});
