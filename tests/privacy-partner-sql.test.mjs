import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Real isolated PostgreSQL evaluation; synthetic fixtures only, never Supabase.
// node tests/privacy-partner-sql.test.mjs
const require = createRequire(import.meta.url);
const { PGlite } = process.env.PGLITE_MODULE_PATH
  ? require(process.env.PGLITE_MODULE_PATH)
  : createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');
const db = new PGlite();
const migration = await readFile(new URL('../docs/sql/20261011_PRIVACY_PARTNER_LOOKUP.sql', import.meta.url), 'utf8');
const user = '20000000-0000-4000-8000-000000000001';
const otherUser = '20000000-0000-4000-8000-000000000002';
const workspace = '10000000-0000-4000-8000-000000000001';
const otherWorkspace = '10000000-0000-4000-8000-000000000002';
const party = { legalName: 'Minta Karbantartó EV', address: '1000 Teszt, Minta utca 1.', email: 'business@example.test', phone: '123', taxNumber: 'test' };
const lookup = async (email = null, userId = null, workspaceId = null) => (await db.query('select * from public.lookup_privacy_partner($1,$2,$3)', [email, userId, workspaceId])).rows;
const role = name => db.exec(`reset role; set role ${name}`);
const denied = promise => assert.rejects(promise, error => error.code === '42501');
let passed = 0;
async function check(label, fn) { await fn(); passed++; console.log(`PASS ${label}`); }
async function snapshot() {
  const output = {};
  for (const table of ['auth.users', 'public.workspaces', 'public.workspace_members', 'public.workspace_settings']) {
    output[table] = (await db.query(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`)).rows;
  }
  output.policies = (await db.query('select * from pg_policies order by tablename, policyname')).rows;
  output.tableGrants = (await db.query("select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema in ('public','auth') order by 1,2,3,4")).rows;
  return output;
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz,
      encrypted_password text,raw_user_meta_data jsonb);
    create table public.workspaces(id uuid primary key,name text,active boolean);
    create table public.workspace_members(workspace_id uuid,user_id uuid,active boolean,role text,primary key(workspace_id,user_id));
    create table public.workspace_settings(workspace_id uuid primary key,document_settings jsonb,company_profile jsonb);
    alter table public.workspaces enable row level security;
    alter table public.workspace_members enable row level security;
    alter table public.workspace_settings enable row level security;
    create policy own_settings on public.workspace_settings for select to authenticated using(false);
    grant usage on schema public to anon,authenticated,service_role;
    insert into auth.users values
      ('${user}','Partner@Example.test',now(),null,null,'never-expose','{"private":"secret"}'),
      ('${otherUser}','other@example.test',now(),null,null,'never-expose-other','{}');
    insert into public.workspaces values ('${workspace}','Minta Klíma',true),('${otherWorkspace}','Másik Klíma',true);
    insert into public.workspace_members values ('${workspace}','${user}',true,'owner'),('${otherWorkspace}','${otherUser}',true,'owner');
  `);
  await db.query('insert into public.workspace_settings values($1,$2,$3)', [workspace,
    { privacyNotice: { serviceProvider: { ...party, hidden: 'hidden-party-key' }, partner: { legalName: 'Not the requested party' } }, secret: 'hidden-setting' },
    { email: 'not-requested@example.test', private: 'hidden-profile' }]);
  const before = await snapshot();

  await check('idempotent lookup migration changes no business/auth rows, policies or table permissions', async () => {
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
  });
  await check('function has fixed search path and no client/public execute permission', async () => {
    const functionRow = (await db.query("select prosecdef,provolatile,proconfig,proacl::text from pg_proc where oid='public.lookup_privacy_partner(text,uuid,uuid)'::regprocedure")).rows[0];
    assert.equal(functionRow.prosecdef, true);
    assert.equal(functionRow.provolatile, 's');
    assert.deepEqual(functionRow.proconfig, ['search_path=pg_catalog, pg_temp']);
    for (const actor of ['anon', 'authenticated']) {
      assert.equal((await db.query("select has_function_privilege($1,'public.lookup_privacy_partner(text,uuid,uuid)','execute') as allowed", [actor])).rows[0].allowed, false);
    }
    assert.equal((await db.query("select has_function_privilege('service_role','public.lookup_privacy_partner(text,uuid,uuid)','execute') as allowed")).rows[0].allowed, true);
    assert.equal((await db.query("select count(*)::int as n from pg_proc p,lateral aclexplode(p.proacl) a where p.oid='public.lookup_privacy_partner(text,uuid,uuid)'::regprocedure and a.grantee=0")).rows[0].n, 0);
  });
  await check('anon and authenticated cannot call either lookup mode or list auth accounts', async () => {
    for (const actor of ['anon', 'authenticated']) {
      await role(actor);
      await denied(lookup('partner@example.test'));
      await denied(lookup(null, user, workspace));
      await denied(db.query('select * from auth.users'));
    }
    await role('service_role');
    await denied(db.query('select * from auth.users'));
  });
  await check('service role exact case-insensitive trimmed email returns only matched business identity', async () => {
    const rows = await lookup('  PARTNER@example.test  ');
    assert.deepEqual(rows, [{ user_id: user, workspace_id: workspace, workspace_name: 'Minta Klíma', party }]);
    assert.ok(!JSON.stringify(rows).includes('secret'));
    assert.ok(!JSON.stringify(rows).includes('never-expose'));
    assert.ok(!JSON.stringify(rows).includes('hidden'));
    assert.ok(!JSON.stringify(rows).includes('Partner@Example.test'));
  });
  await check('empty, partial, wildcard and SQL-like email strings cannot enumerate users', async () => {
    for (const email of ['', ' ', 'partner', '%', 'partner%', '%@example.test', 'partner_@example.test', "' OR true --"]) {
      assert.deepEqual(await lookup(email), [], email);
    }
    assert.deepEqual(await lookup(), []);
  });
  await check('exact user/workspace pair validates membership and cannot be combined with email', async () => {
    assert.equal((await lookup(null, user, workspace)).length, 1);
    assert.deepEqual(await lookup(null, user, otherWorkspace), []);
    assert.deepEqual(await lookup(null, otherUser, workspace), []);
    assert.deepEqual(await lookup(null, user, null), []);
    assert.deepEqual(await lookup(null, null, workspace), []);
    assert.deepEqual(await lookup('partner@example.test', user, workspace), []);
    assert.deepEqual(await lookup('partner@example.test', user, null), []);
  });
  await check('unconfirmed, deleted, currently banned and inactive targets are excluded from both modes', async () => {
    const edits = [
      [`update auth.users set email_confirmed_at=null where id=$1`, `update auth.users set email_confirmed_at=now() where id=$1`, user],
      [`update auth.users set deleted_at=now() where id=$1`, `update auth.users set deleted_at=null where id=$1`, user],
      [`update auth.users set banned_until=now()+interval '1 day' where id=$1`, `update auth.users set banned_until=null where id=$1`, user],
      [`update public.workspace_members set active=false where user_id=$1`, `update public.workspace_members set active=true where user_id=$1`, user],
      [`update public.workspaces set active=false where id=$1`, `update public.workspaces set active=true where id=$1`, workspace],
    ];
    for (const [change, restore, id] of edits) {
      await db.exec('reset role');
      await db.query(change, [id]);
      await role('service_role');
      assert.deepEqual(await lookup('partner@example.test'), []);
      assert.deepEqual(await lookup(null, user, workspace), []);
      await db.exec('reset role');
      await db.query(restore, [id]);
    }
    await db.query("update auth.users set banned_until=now()-interval '1 day' where id=$1", [user]);
    await role('service_role');
    assert.equal((await lookup('partner@example.test')).length, 1, 'expired ban does not disable the account');
    await db.exec('reset role');
    await db.query('update auth.users set banned_until=null where id=$1', [user]);
  });
  await check('missing business settings returns an incomplete candidate, not another entity or a private fallback', async () => {
    await role('service_role');
    assert.deepEqual(await lookup('other@example.test'), [{ user_id: otherUser, workspace_id: otherWorkspace, workspace_name: 'Másik Klíma',
      party: { legalName: null, address: null, email: null, phone: null, taxNumber: null } }]);
  });
  await check('temporary names cannot redirect the explicitly qualified security-definer lookup', async () => {
    await db.exec('reset role');
    await db.exec('create temporary table workspace_members(workspace_id uuid,user_id uuid,active boolean)');
    await role('service_role');
    assert.equal((await lookup('partner@example.test')).length, 1);
  });
  await check('results are capped at ten active memberships in stable order and pair lookup can still revalidate any selection', async () => {
    await db.exec('reset role');
    for (let index = 10; index < 24; index++) {
      const id = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      await db.query('insert into public.workspaces values($1,$2,true)', [id, `Additional ${index}`]);
      await db.query("insert into public.workspace_members values($1,$2,true,'member')", [id, user]);
    }
    await role('service_role');
    const rows = await lookup('partner@example.test');
    assert.equal(rows.length, 10);
    assert.deepEqual(rows.map(row => row.workspace_name), Array.from({ length: 10 }, (_, i) => `Additional ${i + 10}`));
    assert.equal((await lookup(null, user, workspace)).length, 1);
  });
  console.log(`${passed} SQL checks passed`);
} finally { await db.close(); }
