const assert = require("node:assert/strict");
const test = require("node:test");
const { harness } = require("./helpers.cjs");

const panel = "src/components/alinflow/WarehousePanel.tsx";

function materialAction(onAddMaterialItem) {
  const state = { messages: [], busy: [], cleared: false };
  const { addMaterialItem } = harness({ Error }).functions(["addMaterialItem"], {
    materialInFlight: { current: false },
    newMaterialName: "Rézcső", newMaterialUnit: "m", newMaterialStock: "3", newMaterialLowAt: "1",
    materialInventory: [], onAddMaterialItem,
    setMaterialMessage: (value) => state.messages.push(value),
    setMaterialBusy: (value) => state.busy.push(value),
    setNewMaterialName: () => { state.cleared = true; },
    setNewMaterialUnit: () => {}, setNewMaterialStock: () => {}, setNewMaterialLowAt: () => {},
  }, panel);
  return { addMaterialItem, state };
}

test("material submission cannot duplicate before a pending save settles", async () => {
  let resolve;
  let calls = 0;
  const action = materialAction(() => { calls++; return new Promise((done) => { resolve = done; }); });
  const first = action.addMaterialItem();
  await action.addMaterialItem();
  assert.equal(calls, 1);
  assert.equal(action.state.cleared, false);
  resolve(true);
  await first;
  assert.equal(action.state.cleared, true);
  assert.deepEqual(action.state.busy, [true, false]);
  assert.match(action.state.messages.at(-1), /hozzáadva/);
});

test("material validation rejection preserves the entered material", async () => {
  const action = materialAction(async () => false);
  await action.addMaterialItem();
  assert.equal(action.state.cleared, false);
  assert.match(action.state.messages.at(-1), /nem került mentésre/);
  assert.deepEqual(action.state.busy, [true, false]);
});

test("material database failure preserves input and allows a retry", async () => {
  let calls = 0;
  const action = materialAction(async () => { if (++calls === 1) throw new Error("Nincs kapcsolat"); return true; });
  await action.addMaterialItem();
  assert.equal(action.state.cleared, false);
  assert.match(action.state.messages.at(-1), /Nincs kapcsolat/);
  await action.addMaterialItem();
  assert.equal(calls, 2);
  assert.equal(action.state.cleared, true);
});

function stockAction(amount, onAdjust) {
  const state = { errors: [], busy: [] };
  const { adjust } = harness({ Error }).functions(["adjust"], {
    inFlight: { current: false }, amount, onAdjust,
    setBusy: (value) => state.busy.push(value),
    setError: (value) => state.errors.push(value),
  }, panel);
  return { adjust, state };
}

test("a repeated stock click cannot apply the same delta twice while saving", async () => {
  let resolve;
  const deltas = [];
  const action = stockAction("-2", (delta) => { deltas.push(delta); return new Promise((done) => { resolve = done; }); });
  const first = action.adjust();
  await action.adjust();
  assert.deepEqual(deltas, [-2]);
  resolve();
  await first;
  assert.deepEqual(action.state.busy, [true, false]);
});

test("invalid or empty stock changes show feedback without making a write", async () => {
  for (const amount of ["", "0", "Infinity", "abc"]) {
    let calls = 0;
    const action = stockAction(amount, async () => { calls++; });
    await action.adjust();
    assert.equal(calls, 0);
    assert.match(action.state.errors.at(-1), /nullától eltérő/);
  }
});

test("a rejected stock update releases the pending state and can be retried", async () => {
  let calls = 0;
  const action = stockAction("1", async () => { if (++calls === 1) throw new Error("Nincs kapcsolat"); });
  await action.adjust();
  assert.match(action.state.errors.at(-1), /Nincs kapcsolat/);
  await action.adjust();
  assert.equal(calls, 2);
  assert.deepEqual(action.state.busy, [true, false, true, false]);
});

function stockWorkspaceAction() {
  const requests = [];
  const pendingActionsRef = { current: new Set() };
  const state = { workspace: "workspace-a", messages: [], writes: 0, inventory: [], materials: [{ name: "Rézcső", stock: 4 }] };
  function request(kind, input) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    requests.push({ kind, input, workspace: state.workspace, resolve, reject });
    return promise;
  }
  const actions = harness({ Error }).functions(["addStock", "addMaterialStock", "addMaterialInventoryItem", "beginAction", "endAction"], {
    pendingActionsRef, setPendingActions() {},
    currentWorkspaceId: () => state.workspace,
    materialInventory: state.materials,
    setMessage: (message, tone) => state.messages.push({ message, tone }),
    setInventory: (update) => { state.writes++; state.inventory = update(state.inventory); },
    setMaterialInventory: (update) => { state.writes++; state.materials = update(state.materials); },
    adjustClimateStock: (productId, amount) => request("climate", { productId, amount }),
    supabase: { rpc: (name, input) => request(name, input) },
    persistMaterialStock: (item) => request("new-material", item),
  });
  return { ...actions, state, requests, pendingActionsRef,
    start(kind) {
      if (kind === "climate") return actions.addStock("climate-fixture", 2);
      if (kind === "material") return actions.addMaterialStock("Rézcső", 2);
      return actions.addMaterialInventoryItem({ name: "Konzol", stock: 3, unit: "db", lowAt: 1 });
    },
    succeed(kind, index = 0) { requests[index].resolve(kind === "material" ? { data: 6, error: null } : 6); },
  };
}

for (const kind of ["climate", "material", "new-material"]) {
  test(`${kind}: late stock success and failure cannot alter a different workspace`, async () => {
    for (const failed of [false, true]) {
      const action = stockWorkspaceAction();
      const pending = action.start(kind);
      assert.equal(action.requests.length, 1);
      assert.equal(action.requests[0].workspace, "workspace-a");
      if (kind === "material") assert.equal(action.requests[0].input.p_workspace_id, "workspace-a");
      action.state.workspace = "workspace-b";
      action.state.messages = [];
      if (failed) action.requests[0].reject(new Error("Korábbi munkaterület hibája"));
      else action.succeed(kind);
      const result = await pending;
      assert.equal(action.state.writes, 0);
      assert.deepEqual(action.state.messages, []);
      assert.equal(action.pendingActionsRef.current.size, 0);
      if (kind === "new-material") assert.equal(result, false);
    }
  });

  test(`${kind}: a successful current-workspace save still updates inventory and confirms success`, async () => {
    const action = stockWorkspaceAction();
    const pending = action.start(kind);
    action.succeed(kind);
    const result = await pending;
    assert.equal(action.state.writes, 1);
    assert.match(action.state.messages.at(-1).message, /mentve|hozzáadva/);
    assert.equal(action.pendingActionsRef.current.size, 0);
    if (kind === "new-material") assert.equal(result, true);
  });
}

test("an old workspace finishing cannot release the same material's newer workspace lock", async () => {
  const action = stockWorkspaceAction();
  const oldSave = action.start("material");
  action.state.workspace = "workspace-b";
  const currentSave = action.start("material");
  assert.equal(action.requests.length, 2);
  assert.equal(action.requests[1].input.p_workspace_id, "workspace-b");
  action.succeed("material", 0);
  await oldSave;
  assert.equal(action.state.writes, 0);
  assert.equal(action.pendingActionsRef.current.size, 1);
  await action.start("material");
  assert.equal(action.requests.length, 2);
  action.succeed("material", 1);
  await currentSave;
  assert.equal(action.state.writes, 1);
  assert.equal(action.pendingActionsRef.current.size, 0);
});
