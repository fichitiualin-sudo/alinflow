const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");

function fixture(returnTarget) {
  const currentViewRef = { current: "dashboard" };
  const viewHistoryRef = { current: [] };
  const state = { view: "dashboard", taskFilter: null };
  const actions = harness().functions(["navigateToView", "replaceView", "goBack", "returnToLastMenu"], {
    currentViewRef,
    viewHistoryRef,
    maintenanceReturnRef: { current: null },
    returnTarget,
    setView: view => { state.view = view; },
    setTaskFilter: filter => { state.taskFilter = filter; },
  });
  return { ...actions, state, currentViewRef, viewHistoryRef };
}

test("saving a work report returns to its work and Back then leaves that work", () => {
  const f = fixture();
  f.navigateToView("lead");
  f.navigateToView("work");
  f.navigateToView("workReport");
  f.replaceView("work");
  assert.equal(f.state.view, "work");
  f.goBack();
  assert.equal(f.state.view, "lead", "Back must not remain on the same work after saving");
  f.goBack();
  assert.equal(f.state.view, "dashboard");
  assert.equal(f.viewHistoryRef.current.length, 0);
});

test("completing a new schedule closes its editing path instead of reopening it on Back", () => {
  const f = fixture();
  for (const view of ["lead", "quote", "schedule"]) f.navigateToView(view);
  f.replaceView("dashboard");
  assert.equal(f.state.view, "dashboard");
  assert.equal(f.viewHistoryRef.current.length, 0);
  f.goBack();
  assert.equal(f.state.view, "dashboard", "completed scheduling must not return to the quote editor");
});

test("ordinary nested navigation preserves the previous screen at each Back step", () => {
  const f = fixture();
  for (const view of ["lead", "quote", "quotePreview"]) f.navigateToView(view);
  for (const expected of ["quote", "lead", "dashboard"]) {
    f.goBack();
    assert.equal(f.state.view, expected);
    assert.equal(f.currentViewRef.current, expected);
  }
});

test("Back preserves chronological history when an earlier screen was visited more than once", () => {
  const f = fixture();
  for (const view of ["lead", "quote", "lead", "work"]) f.navigateToView(view);
  for (const expected of ["lead", "quote", "lead", "dashboard"]) {
    f.goBack();
    assert.equal(f.state.view, expected, "Back must consume one step instead of pruning older visits to that view");
  }
});

test("opening the current view again does not create an extra Back step", () => {
  const f = fixture();
  f.navigateToView("lead");
  f.navigateToView("lead");
  f.goBack();
  assert.equal(f.state.view, "dashboard");
});

test("returning from a finished job restores the task filter and closes the job path", () => {
  const f = fixture({ view: "tasks", taskFilter: "callback" });
  for (const view of ["tasks", "lead", "work"]) f.navigateToView(view);
  f.returnToLastMenu();
  assert.equal(f.state.view, "tasks");
  assert.equal(f.state.taskFilter, "callback");
  f.goBack();
  assert.equal(f.state.view, "dashboard", "Back from returned task list must not reopen the finished job");
});

for (const menu of ["archive", "documents", "maintenanceMap"]) {
  test(`returning to ${menu} keeps its origin without retaining the finished work`, () => {
    const f = fixture({ view: menu });
    for (const view of [menu, "work", "workReport"]) f.navigateToView(view);
    f.returnToLastMenu();
    assert.equal(f.state.view, menu);
    f.goBack();
    assert.equal(f.state.view, "dashboard");
  });
}

test("return without a saved menu goes to dashboard and closes the form path", () => {
  const f = fixture();
  f.navigateToView("lead");
  f.navigateToView("work");
  f.returnToLastMenu();
  assert.equal(f.state.view, "dashboard");
  f.goBack();
  assert.equal(f.state.view, "dashboard");
});

test("directly opened screens use their explicit Back destination when there is no history", () => {
  const f = fixture();
  f.replaceView("quotePreview");
  f.goBack("quote");
  assert.equal(f.state.view, "quote");
  f.replaceView("documentPreview");
  f.goBack("documents");
  assert.equal(f.state.view, "documents");
});
