import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Disposable local PostgreSQL-compatible instance; this never contacts Supabase or Resend.
const { PGlite } = createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');
const migration = await readFile(new URL('../docs/sql/INSTALLATION_THANK_YOU.sql', import.meta.url), 'utf8');
const db = new PGlite();
const user = randomUUID(), other = randomUUID(), workspace = randomUUID(), foreignWorkspace = randomUUID();
const customer = randomUUID(), foreignCustomer = randomUUID();
const payload = JSON.stringify({ to: ['customer@example.test'], html: '<p>Köszönjük!</p>' });
const signature = 'a'.repeat(64);
let passed = 0;
async function check(label, action) { await action(); passed++; console.log(`PASS ${label}`); }
async function as(role, actor = '') {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
}
async function seed(type = 'installation', status = 'Lezárva') {
  const id = randomUUID();
  await as('postgres');
  await db.query('insert into appointments(id,workspace_id,customer_id,appointment_type,status) values($1,$2,$3,$4,$5)', [id, workspace, customer, type, status]);
  await as('authenticated', user);
  return id;
}
async function claim(appointment, opts = {}) {
  return (await db.query(`select claim_installation_thank_you($1,$2,$3,$4,$5) as result`,
    [opts.workspace || workspace, opts.customer || customer, appointment, opts.payload ?? payload, opts.signature ?? signature])).rows[0].result;
}
async function finish(appointment, token, outcome = 'sent', provider = 'provider-id', opts = {}) {
  return (await db.query(`select finish_installation_thank_you($1,$2,$3,$4,$5,$6,$7) as result`,
    [opts.workspace || workspace, opts.customer || customer, appointment, token, outcome, provider, null])).rows[0].result;
}
async function ledger(appointment) {
  await as('postgres');
  const row = (await db.query('select * from installation_thank_you_deliveries where appointment_id=$1', [appointment])).rows[0];
  await as('authenticated', user);
  return row;
}
async function age(appointment, interval) {
  await as('postgres');
  await db.query("update installation_thank_you_deliveries set first_attempt_at=now()-$2::interval,lease_expires_at=now()-interval '1 second' where appointment_id=$1", [appointment, interval]);
  await as('authenticated', user);
}
const denied = (promise, code = '42501') => assert.rejects(promise, error => error.code === code);

try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table workspaces(id uuid primary key);
    create table workspace_members(workspace_id uuid references workspaces(id),user_id uuid,active boolean not null,primary key(workspace_id,user_id));
    create table customers(id uuid primary key,workspace_id uuid not null references workspaces(id),email text);
    create table appointments(id uuid primary key,workspace_id uuid not null references workspaces(id),customer_id uuid not null references customers(id),appointment_type text not null,status text not null);
    create table documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null,customer_id uuid not null,appointment_id uuid,document_type text,title text,status text,sent_at timestamptz,created_by uuid,
      unique(workspace_id,customer_id,document_type,appointment_id));
    grant usage on schema public,auth to anon,authenticated;
  `);
  await db.query('insert into workspaces values($1),($2)', [workspace, foreignWorkspace]);
  await db.query('insert into workspace_members values($1,$2,true),($3,$4,true)', [workspace, user, foreignWorkspace, other]);
  await db.query('insert into customers values($1,$2,$3),($4,$5,$6)', [customer, workspace, 'customer@example.test', foreignCustomer, foreignWorkspace, 'other@example.test']);
  await check('migration is additive, creates no pending emails and is repeatable with CRLF input', async () => {
    await db.exec(migration); await db.exec(migration); await db.exec(migration.replace(/\r?\n/g, '\r\n'));
    assert.equal((await db.query('select count(*)::int n from installation_thank_you_deliveries')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from documents')).rows[0].n, 0);
  });
  await check('ledger cannot be read or changed directly; only authenticated callers get the two definer RPCs', async () => {
    const rights = (await db.query(`select has_table_privilege('authenticated','installation_thank_you_deliveries','SELECT,INSERT,UPDATE,DELETE') as table_access,
      has_function_privilege('anon','claim_installation_thank_you(uuid,uuid,uuid,text,text)','EXECUTE') as anon_access,
      has_function_privilege('authenticated','claim_installation_thank_you(uuid,uuid,uuid,text,text)','EXECUTE') as member_access,
      p.prosecdef,p.proconfig from pg_proc p where p.oid='finish_installation_thank_you(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure`)).rows[0];
    assert.equal(rights.table_access, false); assert.equal(rights.anon_access, false); assert.equal(rights.member_access, true);
    assert.equal(rights.prosecdef, true); assert.ok(rights.proconfig.includes('search_path=""')); assert.ok(rights.proconfig.includes('row_security=off'));
  });
  await check('an unfinished installation and a closed maintenance cannot claim an email', async () => {
    await denied(claim(await seed('installation', 'Szerelés kész – admin folyamatban')), '22023');
    await denied(claim(await seed('maintenance')), '22023');
  });
  const first = await seed();
  await check('inactive, missing-auth and foreign workspace callers cannot claim', async () => {
    await as('authenticated', other); await denied(claim(first));
    await as('authenticated'); await denied(claim(first));
    await as('postgres'); await db.query('update workspace_members set active=false where workspace_id=$1 and user_id=$2', [workspace, user]);
    await as('authenticated', user); await denied(claim(first));
    await as('postgres'); await db.query('update workspace_members set active=true where workspace_id=$1 and user_id=$2', [workspace, user]);
    await as('authenticated', user);
  });
  await check('exact customer/appointment scope and the saved recipient are required', async () => {
    await denied(claim(first, { customer: foreignCustomer }), '22023');
    await denied(claim(first, { payload: JSON.stringify({ to: ['wrong@example.test'] }) }), '22023');
    await denied(claim(first, { payload: JSON.stringify({ to: [] }) }), '22023');
    await denied(claim(first, { signature: 'bad' }), '22023');
    assert.equal(await ledger(first), undefined);
  });
  const original = await claim(first);
  await check('claim uses a unique stable key and rejects a concurrent duplicate', async () => {
    assert.equal(original.status, 'send'); assert.equal(original.resuming, false);
    assert.equal(original.payload_text, payload); assert.equal(original.payload_signature, signature);
    assert.ok(original.idempotency_key.startsWith(`alinflow-thank-you/${workspace}/${first}/`));
    assert.ok(original.idempotency_key.length <= 256);
    assert.equal((await claim(first)).status, 'busy');
  });
  await check('invalid token, cross-scope or inactive finish cannot alter the ledger', async () => {
    await denied(finish(first, randomUUID()));
    await denied(finish(first, original.claim_token, 'sent', 'id', { customer: foreignCustomer }));
    await as('authenticated', other); await denied(finish(first, original.claim_token));
    await as('authenticated', user);
    assert.equal((await ledger(first)).state, 'sending');
  });
  await check('unknown provider outcome keeps the original payload and key despite changed input', async () => {
    await finish(first, original.claim_token, 'uncertain', null);
    const retried = await claim(first, { payload: JSON.stringify({ to: ['customer@example.test'], html: 'new template' }), signature: 'b'.repeat(64) });
    assert.equal(retried.resuming, true); assert.equal(retried.payload_text, payload);
    assert.equal(retried.payload_signature, signature); assert.equal(retried.idempotency_key, original.idempotency_key);
    assert.notEqual(retried.claim_token, original.claim_token);
    await denied(finish(first, original.claim_token));
    await finish(first, retried.claim_token, 'sent', 'provider-original');
  });
  await check('successful finish atomically records one document for exactly this appointment', async () => {
    const row = await ledger(first); assert.equal(row.state, 'sent'); assert.equal(row.provider_id, 'provider-original');
    await as('postgres');
    const docs = (await db.query("select * from documents where document_type='thank_you_email'")).rows;
    assert.equal(docs.length, 1); assert.equal(docs[0].appointment_id, first); assert.equal(docs[0].workspace_id, workspace);
    assert.equal(docs[0].customer_id, customer); assert.equal(docs[0].status, 'Elküldve'); assert.ok(docs[0].sent_at);
    await as('authenticated', user);
    assert.equal((await claim(first)).status, 'already_sent');
  });
  await check('sent ledger prevents resend even if its document was removed later', async () => {
    await as('postgres'); await db.query('delete from documents where appointment_id=$1', [first]); await as('authenticated', user);
    const result = await claim(first); assert.equal(result.status, 'already_sent'); assert.equal(result.provider_id, 'provider-original');
  });
  const second = await seed();
  await check('another installation for the same customer has an independent delivery', async () => {
    const result = await claim(second); assert.equal(result.status, 'send'); assert.notEqual(result.idempotency_key, original.idempotency_key);
    await finish(second, result.claim_token);
  });
  const legacy = await seed(), later = await seed();
  await check('previously sent exact-work document suppresses that work but leaves another appointment sendable', async () => {
    await as('postgres');
    await db.query("insert into documents(workspace_id,customer_id,appointment_id,document_type,status,sent_at) values($1,$2,$3,'thank_you_email','Elküldve',now())", [workspace, customer, legacy]);
    await as('authenticated', user);
    assert.equal((await claim(legacy)).status, 'already_sent'); assert.equal((await claim(later)).status, 'send');
  });
  const rejected = await seed();
  await check('definitively failed initial attempt can restart with corrected content and a new provider key', async () => {
    const before = await claim(rejected); await finish(rejected, before.claim_token, 'failed', null);
    const updated = JSON.stringify({ to: ['customer@example.test'], html: 'corrected' });
    const after = await claim(rejected, { payload: updated });
    assert.equal(after.resuming, false); assert.equal(after.payload_text, updated); assert.notEqual(after.idempotency_key, before.idempotency_key);
  });
  const abandoned = await seed();
  await check('expired lease resumes one provider operation inside its safe retry window', async () => {
    const before = await claim(abandoned); await age(abandoned, '5 minutes');
    const after = await claim(abandoned); assert.equal(after.status, 'send'); assert.equal(after.resuming, true);
    assert.equal(before.idempotency_key, after.idempotency_key);
  });
  await check('old sending/uncertain attempts cannot resend beyond the provider retention window', async () => {
    await age(abandoned, '24 hours'); assert.equal((await claim(abandoned)).status, 'needs_review');
    const unknown = await seed(), row = await claim(unknown); await finish(unknown, row.claim_token, 'uncertain', null);
    await age(unknown, '23 hours'); assert.equal((await claim(unknown)).status, 'needs_review');
  });
  const atomic = await seed();
  await check('document insertion failure rolls back sent state so retries retain their provider key', async () => {
    const row = await claim(atomic);
    await as('postgres');
    await db.exec("alter table documents add constraint test_document_failure check(document_type<>'thank_you_email') not valid;");
    await as('authenticated', user); await denied(finish(atomic, row.claim_token), '23514');
    assert.equal((await ledger(atomic)).state, 'sending');
    await as('postgres'); await db.exec('alter table documents drop constraint test_document_failure;'); await as('authenticated', user);
    await finish(atomic, row.claim_token); assert.equal((await claim(atomic)).status, 'already_sent');
  });
  await check('migration refuses an unknown edited function instead of overwriting it', async () => {
    await as('postgres');
    await db.exec("comment on function claim_installation_thank_you(uuid,uuid,uuid,text,text) is 'foreign implementation';");
    await assert.rejects(db.exec(migration), /ismeretlen függvény/);
    await db.exec('rollback;');
  });
  console.log(`${passed} SQL integration checks passed.`);
} finally { await db.close(); }
