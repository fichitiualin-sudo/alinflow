const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./helpers.cjs');
class ApiError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const workspace = '10000000-0000-4000-8000-000000000001';
const customer = '20000000-0000-4000-8000-000000000001';
const appointment = '30000000-0000-4000-8000-000000000001';

function fixture(options = {}) {
  const entries = new Map(), requests = [], calls = [];
  let counter = 0;
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    SZAMLAZZ_WORKSPACE_ID: workspace, SZAMLAZZ_LABOR_AGENT_KEY: 'synthetic-issuer', ...options.env };
  const admin = { async rpc(name, args) {
    calls.push({ name, args });
    if (options.rpcError) return { error: { message: 'synthetic database error' } };
    const key = [args.p_workspace_id, args.p_customer_id, args.p_appointment_id, args.p_invoice_kind].join('/');
    let entry = entries.get(key);
    if (name === 'claim_invoice_delivery') {
      if (options.claimStatus) return { data: { status: options.claimStatus } };
      if (entry?.state === 'confirmed') return { data: { status: 'confirmed', ...entry.receipt } };
      if (entry?.state === 'processing') return { data: { status: 'busy' } };
      if (entry?.state === 'uncertain') return { data: { status: 'needs_review' } };
      entry = { state: 'processing', token: `claim-${++counter}` }; entries.set(key, entry);
      return { data: { status: 'send', claim_token: entry.token } };
    }
    if (options.finishError) return { error: { message: 'lost completion' } };
    assert.equal(args.p_claim_token, entry.token);
    entry.state = args.p_outcome;
    entry.receipt = { invoice_number: args.p_invoice_number, net_amount: args.p_net_amount,
      gross_amount: args.p_gross_amount, email_sent: args.p_email_sent };
    return { data: { status: args.p_outcome } };
  } };
  const h = harness({ process: { env }, ...(options.now ? { Date: class extends Date { constructor(...args) { super(...(args.length ? args : [options.now])); } } } : {}),
    fetch: async (_url, init) => {
      const xml = await init.body.get('action-xmlagentxmlfile').text(); requests.push(xml);
      return options.provider ? options.provider(xml, requests.length) : new Response('<reply><sikeres>true</sikeres><szamlaszam>SYNTHETIC-1</szamlaszam><szamlanetto>10000</szamlanetto><szamlabrutto>10000</szamlabrutto></reply>');
    },
  }, {
    '@supabase/supabase-js': { createClient: (_url, key) => { assert.equal(key, 'synthetic-service'); return admin; } },
    '@/lib/alinflow/server-auth': { ApiError,
      authorizeCustomerRequest: async (_request, body) => ({ workspaceId: workspace, userId: 'synthetic-user', appointment: body.customer.activeAppointmentId ? { id: body.customer.activeAppointmentId } : null }),
      apiErrorResponse: error => Response.json({ error: error.message }, { status: error.status || 500 }),
    },
  });
  const post = (patch = {}) => h.load('src/app/api/create-invoice/route.ts').POST(new Request('https://example.invalid', {
    method: 'POST', body: JSON.stringify({ kind: 'labor', amount: 10000, sendEmail: false,
      customer: { id: customer, activeAppointmentId: appointment, name: 'Synthetic customer', email: 'synthetic@example.invalid' }, ...patch }),
  }));
  return { h, post, entries, requests, calls, options };
}

for (const [instant, date] of [
  ['2026-10-11T22:30:00.000Z', '2026-10-12'], ['2026-01-11T23:30:00.000Z', '2026-01-12'],
  ['2026-03-28T23:30:00.000Z', '2026-03-29'], ['2026-10-25T00:30:00.000Z', '2026-10-25'],
]) test(`invoice issue/performance dates use Budapest at ${instant}`, async () => {
  const f = fixture({ now: instant });
  assert.equal((await f.post()).status, 200);
  for (const tag of ['keltDatum','teljesitesDatum','fizetesiHataridoDatum']) assert.ok(f.requests[0].includes(`<${tag}>${date}</${tag}>`));
});

test('transfer due date starts from the Budapest issue day', async () => {
  const f = fixture({ now: '2026-10-11T22:30:00.000Z' });
  assert.equal((await f.post({ paymentMethod: 'transfer', transferDueDays: 2 })).status, 200);
  assert.match(f.requests[0], /<fizetesiHataridoDatum>2026-10-14<\/fizetesiHataridoDatum>/);
});

test('a confirmed invoice survives a new request and returns its original email choice without another provider call', async () => {
  const f = fixture();
  const first = await (await f.post({ sendEmail: true })).json();
  const again = await (await f.post({ amount: 20000, sendEmail: false })).json();
  assert.deepEqual(again, first); assert.equal(again.invoiceNumber, 'SYNTHETIC-1'); assert.equal(again.emailSent, true);
  assert.equal(f.requests.length, 1);
});

test('provider acceptance with lost network response cannot create another invoice on retry', async () => {
  const f = fixture({ provider: () => { throw Error('synthetic response lost after acceptance'); } });
  assert.equal((await f.post()).status, 502);
  const retry = await f.post(); assert.equal(retry.status, 409);
  assert.match((await retry.json()).error, /bizonytalan/);
  assert.equal(f.requests.length, 1); assert.equal([...f.entries.values()][0].state, 'uncertain');
});

test('parallel requests cannot reach the invoice provider twice', async () => {
  let release, entered; const pending = new Promise(resolve => { entered = resolve; });
  const f = fixture({ provider: () => { entered(); return new Promise(resolve => { release = resolve; }); } });
  const first = f.post(); await pending;
  assert.equal((await f.post()).status, 409); assert.equal(f.requests.length, 1);
  release(new Response('<reply><sikeres>true</sikeres><szamlaszam>SYNTHETIC-1</szamlaszam></reply>'));
  assert.equal((await first).status, 200);
});

test('only an explicit rejection releases an invoice operation for a corrected retry', async () => {
  const f = fixture({ provider: (_xml, count) => new Response(count === 1
    ? '<reply><sikeres>false</sikeres><hibauzenet>invalid request</hibauzenet></reply>'
    : '<reply><sikeres>true</sikeres><szamlaszam>CORRECTED</szamlaszam></reply>') });
  assert.equal((await f.post()).status, 502); assert.equal([...f.entries.values()][0].state, 'rejected');
  assert.equal((await f.post()).status, 200); assert.equal(f.requests.length, 2);
  assert.notEqual(f.calls[1].args.p_claim_token, f.calls[3].args.p_claim_token);
});

for (const body of ['', '<reply><sikeres>true</sikeres></reply>', '<reply><sikeres>false</sikeres><szamlaszam>CONTRADICTORY</szamlaszam></reply>']) {
  test(`malformed provider result remains closed: ${body || 'empty'}`, async () => {
    const f = fixture({ provider: () => new Response(body) });
    assert.equal((await f.post()).status, 502); assert.equal((await f.post()).status, 409); assert.equal(f.requests.length, 1);
  });
}

test('lost completion after acceptance leaves a closed claim and reports the real invoice number', async () => {
  const f = fixture({ finishError: true });
  const first = await f.post(); assert.equal(first.status, 503); assert.match((await first.json()).error, /SYNTHETIC-1/);
  assert.equal((await f.post()).status, 409); assert.equal(f.requests.length, 1);
});

test('missing service setup or migration, legacy recorded invoices and uncertain claims fail before the provider', async () => {
  for (const options of [{ env: { SUPABASE_SERVICE_ROLE_KEY: '' } }, { rpcError: true }, { claimStatus: 'already_recorded' }, { claimStatus: 'needs_review' }]) {
    const f = fixture(options); assert.ok((await f.post()).status >= 400); assert.equal(f.requests.length, 0);
  }
});

test('different saved appointments keep independent invoice operations', async () => {
  const f = fixture(); assert.equal((await f.post()).status, 200);
  assert.equal((await f.post({ customer: { id: customer, activeAppointmentId: '30000000-0000-4000-8000-000000000002' } })).status, 200);
  assert.equal(f.requests.length, 2);
});
