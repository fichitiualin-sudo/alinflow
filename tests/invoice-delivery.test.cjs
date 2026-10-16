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
      authorizeCustomerRequest: async (_request, body) => ({ workspaceId: workspace, userId: 'synthetic-user', appointment: body.customer.activeAppointmentId ? { id: body.customer.activeAppointmentId, appointment_type: options.appointmentType, status: options.appointmentStatus, cancelled_at: options.appointmentCancelledAt } : null }),
      apiErrorResponse: error => Response.json({ error: error.message }, { status: error.status || 500 }),
    },
  });
  const post = (patch = {}) => h.load('src/app/api/create-invoice/route.ts').POST(new Request('https://example.invalid', {
    method: 'POST', body: JSON.stringify({ kind: 'labor', amount: 10000, sendEmail: false,
      customer: { id: customer, activeAppointmentId: appointment, name: 'Synthetic customer', email: 'synthetic@example.invalid' }, ...patch }),
  }));
  return { h, post, entries, requests, calls, options };
}

const mixedItems = [
  { productId: '', itemType: 'climate', customName: 'Teszt klíma', quantity: 2, customPrice: 100000, customInstallPrice: 30000 },
  { productId: '', itemType: 'extra', customName: 'Faláttörés', quantity: 3, customPrice: 10000 },
  { productId: '', itemType: 'extra', customName: 'Kábel', quantity: 2, customPrice: 5000, customInstallPrice: 2000 },
];
const invoiceGross = xml => [...xml.matchAll(/<bruttoErtek>(\d+)<\/bruttoErtek>/g)].reduce((sum, match) => sum + Number(match[1]), 0);

test('extra items retain their explicit seller split and do not inflate climate quantities', async () => {
  const expected = { device: 176000, labor: 64000, combined: 240000 };
  for (const [kind, amount] of Object.entries(expected)) {
    const f = fixture({ appointmentType: 'installation', env: { SZAMLAZZ_DEVICE_AGENT_KEY: 'synthetic-device', SZAMLAZZ_COMBINED_AGENT_KEY: 'synthetic-combined' } });
    const billing = f.h.load('src/lib/alinflow/billing.ts');
    assert.deepEqual(JSON.parse(JSON.stringify(billing.billingAmountsForAppointment(mixedItems, 'installation'))), expected);
    assert.equal((await f.post({ kind, amount, quoteItems: mixedItems })).status, 200);
    const xml = f.requests[0];
    assert.equal(invoiceGross(xml), amount);
    assert.doesNotMatch(xml, /(?:Faláttörés|Kábel) \+ szerelési anyagok/);
    assert.doesNotMatch(xml, /7 db Légkondicionáló telepítés/);
    if (kind !== 'labor') {
      assert.match(xml, /2 db Teszt klíma \+ szerelési anyagok/);
      assert.match(xml, /3 db Faláttörés/);
    }
    if (kind !== 'device') assert.match(xml, /2 db Légkondicionáló telepítés és beüzemelés/);
    if (kind === 'labor') {
      assert.match(xml, /2 db Kábel/);
      assert.doesNotMatch(xml, /Faláttörés/);
      assert.match(xml, /<bruttoErtek>60000<\/bruttoErtek>/);
      assert.match(xml, /<bruttoErtek>4000<\/bruttoErtek>/);
    }
  }
  const maintenance = fixture();
  assert.equal((await maintenance.post({ kind: 'maintenance', amount: 12000, quoteItems: mixedItems })).status, 200);
  assert.match(maintenance.requests[0], /2 db Légkondicionáló karbantartás/);
  assert.doesNotMatch(maintenance.requests[0], /7 db/);
});

test('other work bills every priced item with the workspace own service issuer, without a device allocation', async () => {
  const f = fixture({ appointmentType: 'other', env: {
    SZAMLAZZ_WORKSPACE_ID: 'different-workspace', SZAMLAZZ_SPLIT_WORKSPACE_ID: workspace,
    SZAMLAZZ_SPLIT_LABOR_AGENT_KEY: 'synthetic-own-service', SZAMLAZZ_SPLIT_LABOR_VAT_KEY: 'AAM', SZAMLAZZ_SPLIT_LABOR_INVOICE_PREFIX: 'OWN',
    SZAMLAZZ_DEVICE_AGENT_KEY: 'must-not-use-device',
  } });
  const items = [
    { productId: '', itemType: 'extra', customName: 'Klíma leszerelése', quantity: 1, customPrice: 30000 },
    { productId: '', itemType: 'extra', customName: 'Hűtőközeg visszanyerése', quantity: 2, customPrice: 5000, customInstallPrice: 1000 },
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(f.h.load('src/lib/alinflow/billing.ts').billingAmountsForAppointment(items, 'other'))), { device: 0, labor: 40000, combined: 40000 });
  // The saved appointment wins even if an older browser sends installation.
  assert.equal((await f.post({ kind: 'labor', amount: 40000, quoteItems: items,
    customer: { id: customer, activeAppointmentId: appointment, name: 'Synthetic customer', appointmentType: 'installation' } })).status, 200);
  const xml = f.requests[0];
  assert.match(xml, /<szamlaagentkulcs>synthetic-own-service<\/szamlaagentkulcs>/);
  assert.match(xml, /<szamlaszamElotag>OWN<\/szamlaszamElotag>/);
  assert.match(xml, /Szolgáltatási díj számlája\./);
  assert.match(xml, /Klíma leszerelése/); assert.match(xml, /2 db Hűtőközeg visszanyerése/);
  assert.doesNotMatch(xml, /must-not-use-device|szerelési anyagok|telepítés és beüzemelés/);
  assert.equal(invoiceGross(xml), 40000);
  assert.equal(f.calls.find(call => call.name === 'claim_invoice_delivery').args.p_invoice_kind, 'labor');
});

test('saved other appointments reject device, combined and maintenance kinds before any invoice claim or provider call', async () => {
  for (const kind of ['device', 'combined', 'maintenance']) {
    const f = fixture({ appointmentType: 'other' });
    assert.equal((await f.post({ kind, customer: { id: customer, activeAppointmentId: appointment, appointmentType: 'installation' } })).status, 400);
    assert.equal(f.requests.length, 0); assert.equal(f.calls.length, 0);
  }
  const unsaved = fixture();
  assert.equal((await unsaved.post({ customer: { id: customer, appointmentType: 'other' } })).status, 400);
  assert.equal(unsaved.requests.length, 0); assert.equal(unsaved.calls.length, 0);
});

test('an unpriced service description keeps its name when the user later enters the invoice amount', async () => {
  const f = fixture({ appointmentType: 'other' });
  assert.equal((await f.post({ amount: 12500, quoteItems: [{ productId: '', itemType: 'extra', customName: 'Hibakeresés & javítás', quantity: 1, customPrice: 0 }] })).status, 200);
  assert.match(f.requests[0], /Hibakeresés &amp; javítás/);
  assert.equal(invoiceGross(f.requests[0]), 12500);
});

test('cancelled saved other appointments reject invoicing before any claim or provider call', async () => {
  for (const savedCancellation of [
    { appointmentStatus: 'Lemondva' },
    { appointmentStatus: 'Időpont egyeztetve', appointmentCancelledAt: '2026-10-16T08:00:00.000Z' },
  ]) {
    const f = fixture({ appointmentType: 'other', ...savedCancellation });
    // A stale browser claiming an active installation cannot override the saved service state.
    const response = await f.post({ customer: { id: customer, activeAppointmentId: appointment, appointmentType: 'installation', status: 'Időpont egyeztetve', cancelledAt: '' } });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /lemondott szolgáltatási időpont nem számlázható/);
    assert.equal(f.requests.length, 0);
    assert.equal(f.calls.length, 0);
  }
});

test('other service invoices cannot fall back to a combined-only workspace device issuer', async () => {
  const f = fixture({ appointmentType: 'other', env: { SZAMLAZZ_WORKSPACE_ID: 'different', SZAMLAZZ_COMBINED_WORKSPACE_IDS: workspace, SZAMLAZZ_DEVICE_AGENT_KEY: 'wrong-device-key' } });
  assert.equal((await f.post()).status, 403);
  assert.equal(f.requests.length, 0); assert.equal(f.calls.length, 0);
});

test('zero-priced extras keep their own description when the invoice amount is entered manually', async () => {
  for (const kind of ['device', 'labor', 'combined']) {
    const f = fixture({ env: { SZAMLAZZ_DEVICE_AGENT_KEY: 'synthetic-device', SZAMLAZZ_COMBINED_AGENT_KEY: 'synthetic-combined' } });
    assert.equal((await f.post({ kind, amount: 10000, quoteItems: [{ productId: '', itemType: 'extra', customName: 'Külön egyeztetett tétel', quantity: 1, customPrice: 0 }] })).status, 200);
    assert.match(f.requests[0], /<megnevezes>Külön egyeztetett tétel<\/megnevezes>/);
    assert.doesNotMatch(f.requests[0], /<megnevezes>[^<]*(?:szerelési anyagok|telepítés és beüzemelés)/);
    assert.equal(invoiceGross(f.requests[0]), 10000);
  }
});

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
