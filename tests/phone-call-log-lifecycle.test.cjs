const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./helpers.cjs");
const own = { type: "own", workspaceId: "workspace", customerId: "customer" };
const shared = { type: "shared", workspaceId: "workspace", grantId: "grant", installationId: "installation" };
const row = (id, occurredAt = "2026-11-06T12:00:00Z") => ({ id, kind: "initiated", occurredAt,
  recordedAt: "2026-11-06T13:00:00Z", actorName: "Example" });
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const slots = [], effects = [], calls = [];
  let cursor = 0, args = [[own], "user", 0];
  const same = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const api = harness({}, {
    react: {
      useState: initial => {
        const index = cursor++;
        slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
        return [slots[index].value, next => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
      },
      useEffect: (fn, deps) => {
        const index = cursor++;
        if (!same(slots[index]?.deps, deps)) effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
      },
    },
    "@/lib/alinflow/phone-calls-client": { listPhoneCalls: scope => new Promise((resolve, reject) => calls.push({ scope, resolve, reject })) },
  }).load("src/components/alinflow/usePhoneCallLog.ts");
  return {
    calls,
    render(next = args) { args = next; cursor = 0; const value = api.usePhoneCallLog(...args); effects.splice(0).forEach(effect => effect()); return value; },
    async resolve(index, rows) { calls[index].resolve(rows); await flush(); },
    async reject(index, reason = new Error("Access revoked")) { calls[index].reject(reason); await flush(); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

test("phone log merges only the open customer's explicit scopes, deduplicates and sorts actual instants", async () => {
  const f = fixture();
  assert.equal(f.render([[own, shared], "user", 0]).loading, true);
  assert.deepEqual(f.calls.map(call => JSON.parse(JSON.stringify(call.scope))), [own, shared]);
  const duplicate = row("same");
  await f.resolve(0, [duplicate, row("earlier", "2026-11-06T12:00:00+02:00")]);
  assert.equal(f.render().loading, true, "no partial source is exposed while the shared log is pending");
  await f.resolve(1, [duplicate, row("later", "2026-11-06T11:30:00Z")]);
  const result = f.render();
  assert.equal(result.loading, false);
  assert.deepEqual(Array.from(result.records, entry => entry.id), ["same", "later", "earlier"]);
  f.render([[{ ...own }, { ...shared }], "user", 0]);
  assert.equal(f.calls.length, 2, "equivalent render objects cannot repeatedly fetch the history");
});

test("customer, workspace and user switches synchronously hide prior data and ignore late results", async () => {
  for (const next of [[[{ ...own, customerId: "other" }], "user", 0], [[{ ...own, workspaceId: "other" }], "user", 0], [[own], "other-user", 0]]) {
    const f = fixture(); f.render(); await f.resolve(0, [row("old")]); f.render();
    f.render([[own], "user", 1]);
    const switched = f.render(next);
    assert.equal(switched.records.length, 0);
    await f.resolve(2, [row("new")]); await f.resolve(1, [row("stale")]);
    assert.deepEqual(Array.from(f.render().records, entry => entry.id), ["new"]);
  }
});

test("closing the customer or signing out cannot revive a stale log when the same scope is reopened", async () => {
  for (const disabled of [[[], "user", 0], [[own], undefined, 0]]) {
    const f = fixture(); f.render(); await f.resolve(0, [row("old")]); f.render();
    assert.equal(f.render(disabled).records.length, 0);
    const reopened = f.render([[own], "user", 0]);
    assert.equal(reopened.records.length, 0, "the prior session's cached records must remain hidden until re-authorized");
    assert.equal(reopened.loading, true);
    await f.resolve(1, []);
    assert.equal(f.render().records.length, 0);
  }
});

test("failed shared access clears the complete history and a revision supersedes in-flight loads", async () => {
  const f = fixture(); f.render([[own, shared], "user", 0]);
  await f.resolve(0, [row("own")]); await f.reject(1);
  const failed = f.render();
  assert.equal(failed.records.length, 0); assert.equal(failed.loading, false); assert.ok(failed.error);
  f.render([[own, shared], "user", 1]);
  f.render([[own, shared], "user", 2]);
  await f.resolve(4, [row("current")]); await f.resolve(5, []);
  await f.resolve(2, [row("stale")]); await f.resolve(3, []);
  assert.deepEqual(Array.from(f.render().records, entry => entry.id), ["current"]);
  assert.equal(f.render().error, undefined);
});

test("removing a shared scope drops its call details before the local customer refresh completes", async () => {
  const f = fixture(); f.render([[own, shared], "user", 0]);
  await f.resolve(0, [row("own")]); await f.resolve(1, [row("shared")]);
  assert.equal(f.render().records.length, 2);
  assert.equal(f.render([[own], "user", 0]).records.length, 0);
  await f.resolve(2, [row("own")]);
  assert.deepEqual(Array.from(f.render().records, entry => entry.id), ["own"]);
});
