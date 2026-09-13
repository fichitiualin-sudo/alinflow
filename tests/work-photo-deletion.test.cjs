const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers.cjs');

function deletionHarness(result) {
  let workspace = 'workspace-A';
  const selectedCustomerIdRef = { current: 'customer-A' };
  const calls = [], ui = [], messages = [];
  const mark = name => () => ui.push(name);
  const { deleteCustomer } = harness().functions(['deleteCustomer'], {
    window: { confirm: () => true },
    currentWorkspaceId: () => workspace,
    selectedCustomerIdRef,
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
  return { run: () => deleteCustomer({ id: 'customer-A', name: 'Synthetic customer' }),
    switchWorkspace: () => { workspace = 'workspace-B'; }, selectedCustomerIdRef, calls, ui, messages };
}

test('photo retention rejection never starts separate document deletes or changes cached records', async () => {
  const h = deletionHarness({ error: { message: 'Mentett munkafotók miatt nem törölhető.' } });
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'delete_customer_preserving_photos');
  assert.equal(h.calls[0].args.p_workspace_id, 'workspace-A');
  assert.equal(h.calls[0].args.p_customer_id, 'customer-A');
  assert.deepEqual(h.ui, []);
  assert.match(h.messages.at(-1), /munkafotók/);
});

test('successful atomic deletion clears the currently selected deleted customer', async () => {
  const h = deletionHarness({ error: null });
  await h.run();
  assert.ok(h.ui.includes('selection'));
  assert.ok(h.ui.includes('navigate'));
  assert.match(h.messages.at(-1), /törölve/);
});

test('late deletion response cannot clear another selected customer', async () => {
  let resolve;
  const h = deletionHarness(new Promise(r => { resolve = r; }));
  const pending = h.run();
  h.selectedCustomerIdRef.current = 'customer-B';
  resolve({ error: null });
  await pending;
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
  await pending;
  assert.deepEqual(h.ui, []);
  assert.deepEqual(h.messages, ['']);
});
