const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers.cjs');

function deletionHarness(result, { confirmed = true } = {}) {
  let workspace = 'workspace-A';
  const selectedCustomerIdRef = { current: 'customer-A' };
  const pendingActionsRef = { current: new Set() };
  const calls = [], ui = [], messages = [], confirmations = [];
  const mark = name => () => ui.push(name);
  const { deleteCustomer } = harness().functions(['deleteCustomer', 'beginAction', 'endAction'], {
    window: { confirm: message => { confirmations.push(message); return confirmed; } },
    currentWorkspaceId: () => workspace,
    selectedCustomerIdRef,
    pendingActionsRef,
    setPendingActions: () => {},
    supabase: {
      from: () => { throw Error('Separate destructive requests are forbidden'); },
      rpc: async (name, args) => { calls.push({ name, args }); return await result; },
    },
    setMessage: message => messages.push(message),
    setCustomers: mark('customers'), setDocumentsByCustomer: mark('documents'),
    setWorkReportsByCustomer: mark('reports'), setWorkChecklistsByCustomer: mark('checklists'),
    setSelected: mark('selection'), setQuoteItems: mark('quote'), returnToLastMenu: mark('navigate'),
    clearCustomerDraft: mark('draft'), EMPTY_CUSTOMER: {}, EMPTY_QUOTE_ITEMS: [],
  });
  return { run: options => deleteCustomer({ id: 'customer-A', name: 'Synthetic customer' }, options),
    switchWorkspace: () => { workspace = 'workspace-B'; }, selectedCustomerIdRef,
    pendingActions: pendingActionsRef.current, calls, ui, messages, confirmations };
}

test('cancelling deletion neither calls the database nor changes the customer and releases the guard', async () => {
  const h = deletionHarness({ error: null }, { confirmed: false });
  assert.equal(await h.run({ stayOnMap: true }), false);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.ui, []);
  assert.deepEqual(h.messages, []);
  assert.equal(h.pendingActions.size, 0);
});

test('photo retention rejection never starts separate document deletes or changes cached records', async () => {
  const h = deletionHarness({ error: { message: 'Mentett munkafotók miatt nem törölhető.' } });
  assert.equal(await h.run(), false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'delete_customer_preserving_photos');
  assert.equal(h.calls[0].args.p_workspace_id, 'workspace-A');
  assert.equal(h.calls[0].args.p_customer_id, 'customer-A');
  assert.deepEqual(h.ui, []);
  assert.match(h.messages.at(-1), /munkafotók/);
  assert.equal(h.pendingActions.size, 0);
});

test('successful atomic deletion clears the currently selected deleted customer', async () => {
  const h = deletionHarness({ error: null });
  assert.equal(await h.run(), true);
  assert.ok(h.ui.includes('selection'));
  assert.ok(h.ui.includes('navigate'));
  assert.match(h.messages.at(-1), /törölve/);
  assert.equal(h.pendingActions.size, 0);
});

test('deletion from the map clears the deleted selection but keeps the map open', async () => {
  const h = deletionHarness({ error: null });
  assert.equal(await h.run({ stayOnMap: true }), true);
  assert.ok(h.ui.includes('customers'));
  assert.ok(h.ui.includes('selection'));
  assert.ok(h.ui.includes('quote'));
  assert.ok(h.ui.includes('draft'));
  assert.ok(!h.ui.includes('navigate'));
  assert.match(h.messages.at(-1), /törölve/);
});

test('duplicate deletion waits for the same workspace and customer operation to finish', async () => {
  let resolve;
  const h = deletionHarness(new Promise(r => { resolve = r; }));
  const first = h.run({ stayOnMap: true });
  assert.equal(h.pendingActions.size, 1);
  assert.equal(await h.run({ stayOnMap: true }), false);
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.calls.length, 1);
  resolve({ error: null });
  assert.equal(await first, true);
  assert.equal(h.pendingActions.size, 0);
});

test('late deletion response cannot clear another selected customer', async () => {
  let resolve;
  const h = deletionHarness(new Promise(r => { resolve = r; }));
  const pending = h.run();
  h.selectedCustomerIdRef.current = 'customer-B';
  resolve({ error: null });
  assert.equal(await pending, true);
  assert.ok(h.ui.includes('customers'));
  assert.ok(!h.ui.includes('selection'));
  assert.ok(!h.ui.includes('navigate'));
});

test('late deletion result cannot change another workspace UI', async () => {
  let resolve;
  const h = deletionHarness(new Promise(r => { resolve = r; }));
  const pending = h.run();
  h.switchWorkspace();
  resolve({ error: null });
  assert.equal(await pending, false);
  assert.deepEqual(h.ui, []);
  assert.deepEqual(h.messages, ['Ügyfél törlése folyamatban...']);
  assert.equal(h.pendingActions.size, 0);
});

test('a rejected late deletion response does not replace another workspace feedback', async () => {
  let resolve;
  const h = deletionHarness(new Promise(r => { resolve = r; }));
  const pending = h.run({ stayOnMap: true });
  h.switchWorkspace();
  resolve({ error: { message: 'Other workspace failure' } });
  assert.equal(await pending, false);
  assert.deepEqual(h.ui, []);
  assert.deepEqual(h.messages, ['Ügyfél törlése folyamatban...']);
  assert.equal(h.pendingActions.size, 0);
});
