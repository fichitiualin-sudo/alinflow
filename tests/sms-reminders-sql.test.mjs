import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '../.photo-test/node_modules/@electric-sql/pglite');
const migration = await readFile(new URL('../docs/sql/20261017_APPOINTMENT_SMS_RECEIPTS.sql', import.meta.url), 'utf8');
const activeMigration = await readFile(new URL('../docs/sql/20261012_ACTIVE_WORKSPACE_ACCESS.sql', import.meta.url), 'utf8');
const activeFunction = activeMigration.match(/create or replace function public\.active_workspace_member[\s\S]+?\n\$\$;/)?.[0];
assert.ok(activeFunction);
const db = new PGlite();
const user = randomUUID(), teammate = randomUUID(), outsider = randomUUID();
const workspace = randomUUID(), foreignWorkspace = randomUUID();
const customer = randomUUID(), secondCustomer = randomUUID(), foreignCustomer = randomUUID();
const version = '2026-10-01T08:00:00.000Z';
const nextVersion = '2026-10-01T09:00:00.000Z';
const key = 'a'.repeat(64), nextKey = 'b'.repeat(64);
let passed = 0;
async function check(label, action) { await action(); passed++; console.log('PASS ' + label); }
async function as(role, actor = '') {
  await db.exec('reset role; set role ' + role);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
}
const denied = (promise, code = '42501') => assert.rejects(promise, error => error.code === code);
async function seed(options = {}) {
  await as('postgres');
  const id = randomUUID();
  await db.query("insert into appointments(id,workspace_id,customer_id,appointment_type,status,scheduled_date,scheduled_time,cancelled_at,updated_at,stock_deducted_at) values($1,$2,$3,$4,$5,(statement_timestamp() at time zone 'Europe/Budapest')::date+$6::int,$7,$8,$9,$10)",
    [id, options.workspace || workspace, options.customer || customer, options.type || 'installation',
      options.status || 'Időpont foglalva', options.days ?? 2, options.time ?? '08:00', options.cancelledAt ?? null, options.version || version, options.stockDeductedAt ?? null]);
  await as('authenticated', user);
  return id;
}
async function ack(appointment, options = {}) {
  return (await db.query('select to_jsonb(acknowledge_appointment_sms($1,$2,$3,$4,$5,$6)) receipt',
    [options.workspace || workspace, options.customer || customer, appointment, options.key ?? key,
      options.appointmentVersion ?? version, options.customerVersion ?? version])).rows[0].receipt;
}
async function insert(appointment, options = {}) {
  return db.query('insert into appointment_sms_receipts(workspace_id,customer_id,appointment_id,content_key,appointment_updated_at,customer_updated_at) values($1,$2,$3,$4,$5,$6) returning *',
    [options.workspace || workspace, options.customer || customer, appointment, options.key ?? key,
      options.appointmentVersion ?? version, options.customerVersion ?? version]);
}
async function receipts(appointment) {
  return (await db.query('select * from appointment_sms_receipts where workspace_id=$1 and appointment_id=$2', [workspace, appointment])).rows;
}
async function marker(appointment, type, options = {}) {
  await as('postgres');
  await db.query('insert into documents(id,workspace_id,customer_id,appointment_id,document_type) values($1,$2,$3,$4,$5)',
    [randomUUID(), options.workspace || workspace, options.customer || customer, appointment, type]);
  await as('authenticated', user);
}
async function businessSnapshot() {
  const result = {};
  for (const table of ['workspaces', 'workspace_members', 'customers', 'appointments', 'documents', 'profiles']) {
    result[table] = (await db.query('select to_jsonb(t) row from ' + table + ' t order by to_jsonb(t)::text')).rows;
  }
  result.policies = (await db.query("select * from pg_policies where tablename <> 'appointment_sms_receipts' order by tablename,policyname")).rows;
  result.grants = (await db.query("select * from information_schema.role_table_grants where table_schema='public' and table_name <> 'appointment_sms_receipts' order by table_name,grantee,privilege_type")).rows;
  return result;
}

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $uid$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $uid$;
    create table workspaces(id uuid primary key,active boolean not null default true);
    create table workspace_members(workspace_id uuid references workspaces(id),user_id uuid,active boolean not null,primary key(workspace_id,user_id));
    alter table workspace_members enable row level security;
    create policy self_member on workspace_members for select to authenticated using(user_id=auth.uid());
    create table customers(id uuid primary key,workspace_id uuid not null references workspaces(id),phone text,updated_at timestamptz not null);
    create table appointments(id uuid primary key,workspace_id uuid not null references workspaces(id),customer_id uuid not null references customers(id),
      appointment_type text not null,status text not null,scheduled_date date not null,scheduled_time text,
      cancelled_at timestamptz,updated_at timestamptz not null,stock_deducted_at timestamptz);
    create table documents(id uuid primary key,workspace_id uuid,customer_id uuid,appointment_id uuid,document_type text);
    create table profiles(id uuid primary key,full_name text);
    alter table profiles enable row level security;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant select on workspace_members,workspaces to authenticated;
    grant select,update on customers,appointments to authenticated;
    grant select on documents to authenticated;
    ${activeFunction}
    revoke all on function active_workspace_member(uuid) from public,anon;
    grant execute on function active_workspace_member(uuid) to authenticated;
  `);
  for (const table of ['customers', 'appointments', 'documents']) {
    await db.exec('alter table ' + table + ' enable row level security; create policy member_all on ' + table +
      ' for all to authenticated using(active_workspace_member(workspace_id)) with check(active_workspace_member(workspace_id));');
  }
  await db.query('insert into workspaces values($1,true),($2,true)', [workspace, foreignWorkspace]);
  await db.query('insert into workspace_members values($1,$2,true),($1,$3,true),($4,$5,true)', [workspace, user, teammate, foreignWorkspace, outsider]);
  await db.query('insert into customers values($1,$2,$3,$4),($5,$2,$3,$4),($6,$7,$3,$4)',
    [customer, workspace, '+36301234567', version, secondCustomer, foreignCustomer, foreignWorkspace]);
  await db.query('insert into profiles values($1,$2)', [outsider, 'Private fixture']);
  const installation = await seed(), foreignAppointment = await seed({ workspace: foreignWorkspace, customer: foreignCustomer });
  await as('postgres');
  const baseline = await businessSnapshot();

  await check('non-retryable conflict/error codes and no new definer functions', async () => {
    assert.doesNotMatch(migration, /40001|40P01/i);
    assert.doesNotMatch(migration, /security\s+definer/i);
    assert.match(migration, /errcode='PT409'/);
    assert.match(migration, /errcode='PT400'/);
    assert.match(migration, /set local lock_timeout='5s'/);
    assert.match(migration, /set local statement_timeout='15s'/);
  });
  await check('migration is additive and repeatable, including CRLF', async () => {
    await db.exec(migration); await db.exec(migration); await db.exec(migration.replace(/\r?\n/g, '\r\n'));
    assert.deepEqual(await businessSnapshot(), baseline);
    assert.equal((await db.query('select count(*)::int n from appointment_sms_receipts')).rows[0].n, 0);
    assert.deepEqual((await db.query("select column_name from information_schema.columns where table_name='appointment_sms_receipts' order by ordinal_position")).rows.map(r => r.column_name),
      ['workspace_id','customer_id','appointment_id','content_key','appointment_updated_at','customer_updated_at','acknowledged_at','acknowledged_by']);
    assert.equal((await db.query("select count(*)::int n from pg_proc where proname in ('guard_appointment_sms_receipt','acknowledge_appointment_sms') and prosecdef")).rows[0].n, 0);
  });
  await check('valid acknowledgement is server stamped and repeated clicks preserve the original event', async () => {
    await as('authenticated', user);
    const first = await ack(installation);
    assert.equal(first.acknowledged_by, user);
    assert.ok(Number.isFinite(Date.parse(first.acknowledged_at)));
    assert.equal(first.content_key, key);
    await as('authenticated', teammate);
    assert.deepEqual(await ack(installation), first);
    assert.equal((await receipts(installation)).length, 1);
    await as('authenticated', user);
    await ack(installation, { key: nextKey });
    assert.equal((await receipts(installation)).length, 2);
  });
  await check('all three requested appointment types can record separate acknowledgements', async () => {
    for (const type of ['installation','maintenance','survey']) {
      const appointment = await seed({ type });
      assert.equal((await ack(appointment)).appointment_id, appointment);
    }
  });
  await check('saved zero seconds are valid and Budapest dates do not depend on the database timezone', async () => {
    await db.exec("set timezone='Pacific/Honolulu'");
    const appointment = await seed({ days:1, time:'08:00:00' });
    assert.equal((await ack(appointment)).appointment_id, appointment);
    const today = await seed({ days:0 });
    await denied(ack(today), 'PT400');
    await db.exec("set timezone='UTC'");
  });
  await check('scope spoofing and missing bindings fail closed', async () => {
    await denied(ack(foreignAppointment));
    await denied(ack(foreignAppointment, { workspace: foreignWorkspace, customer: foreignCustomer }));
    await denied(ack(installation, { customer: secondCustomer }));
    await denied(insert(installation, { customer: foreignCustomer, key: 'c'.repeat(64) }));
    await denied(ack(randomUUID()));
    const inconsistent = await seed({ customer: foreignCustomer });
    await denied(ack(inconsistent, { customer: foreignCustomer }));
    await as('authenticated', outsider);
    assert.equal((await receipts(installation)).length, 0);
    await denied(ack(installation));
    await as('authenticated', user);
  });
  await check('current appointment and customer versions are required, with HTTP 409 SQL codes', async () => {
    const appointment = await seed();
    await ack(appointment);
    await as('postgres');
    await db.query("update appointments set scheduled_time='11:00',updated_at=$2 where id=$1", [appointment,nextVersion]);
    await as('authenticated', user);
    await denied(ack(appointment), 'PT409');
    await denied(insert(appointment, { key: nextKey }), 'PT409');
    await ack(appointment, { key: nextKey, appointmentVersion: nextVersion });
    assert.equal((await receipts(appointment)).length, 2);
    await as('postgres');
    await db.query("update customers set phone='+36307654321',updated_at=$2 where id=$1", [customer,nextVersion]);
    await as('authenticated', user);
    await denied(ack(appointment, { appointmentVersion: nextVersion }), 'PT409');
    await ack(appointment, { key: 'c'.repeat(64), appointmentVersion: nextVersion, customerVersion: nextVersion });
    await as('postgres');
    await db.query("update customers set phone='+36301234567',updated_at=$2 where id=$1", [customer,version]);
    await as('authenticated', user);
  });
  await check('membership revocation immediately hides receipts and blocks even duplicate acknowledgements', async () => {
    await as('postgres');
    await db.query('update workspace_members set active=false where workspace_id=$1 and user_id=$2', [workspace,user]);
    await as('authenticated', user);
    assert.equal((await receipts(installation)).length, 0);
    await denied(ack(installation));
    await denied(insert(installation, { key: 'c'.repeat(64) }));
    await as('postgres');
    await db.query('update workspace_members set active=true where workspace_id=$1 and user_id=$2', [workspace,user]);
    await as('authenticated', user);
  });
  await check('inactive workspaces fail closed without changing membership', async () => {
    await as('postgres');
    await db.query('update workspaces set active=false where id=$1', [workspace]);
    await as('authenticated', user);
    assert.equal((await receipts(installation)).length, 0);
    await denied(ack(installation));
    await as('postgres');
    await db.query('update workspaces set active=true where id=$1', [workspace]);
    await as('authenticated', user);
  });
  await check('same-day, past, cancelled, completed and unsupported appointments are rejected', async () => {
    for (const options of [{ days:0 }, { days:-1 }, { status:'Lemondva' }, { status:'Lezárva' },
      { status:'Szerelés kész – admin folyamatban' }, { status:'Visszahívandó' }, { cancelledAt:version }, { stockDeductedAt:version }, { type:'other' }, { time:'' }, { time:'25:00' }, { time:'08:60' }, { time:'08:00+11:00' }, { time:'08:00:01' }]) {
      const appointment = await seed(options);
      await denied(ack(appointment), 'PT400');
    }
  });
  await check('installation stock completion never blocks a future maintenance appointment', async () => {
    const appointment = await seed({ type:'maintenance', stockDeductedAt:version });
    assert.equal((await ack(appointment)).appointment_id, appointment);
  });
  await check('completion markers apply only to the exact appointment and workspace', async () => {
    for (const type of ['survey_done','maintenance_done','installation_done','work_closed']) {
      const appointment = await seed();
      await marker(appointment,type);
      await denied(ack(appointment), 'PT400');
    }
    const appointment = await seed(), completedSibling = await seed();
    await marker(completedSibling,'maintenance_done');
    await marker(null,'work_closed');
    await marker(appointment,'survey_done',{ workspace:foreignWorkspace });
    assert.equal((await ack(appointment)).appointment_id, appointment);
  });
  await check('hashes are opaque SHA-256 values and invalid inputs cannot create receipts', async () => {
    const appointment = await seed();
    for (const invalidKey of ['sms body', '+36301234567', 'a'.repeat(63), 'A'.repeat(64)]) {
      await denied(ack(appointment,{ key:invalidKey }), '23514');
    }
    await denied(db.query('select acknowledge_appointment_sms($1,$2,$3,$4,null,$5)', [workspace,customer,appointment,key,version]), 'PT409');
    assert.equal((await receipts(appointment)).length, 0);
  });
  await check('authenticated users cannot falsify actors/timestamps or update/delete history', async () => {
    const appointment = await seed();
    await insert(appointment);
    await denied(db.query('insert into appointment_sms_receipts(workspace_id,customer_id,appointment_id,content_key,appointment_updated_at,customer_updated_at,acknowledged_by) values($1,$2,$3,$4,$5,$5,$6)',
      [workspace,customer,appointment,nextKey,version,outsider]));
    await denied(db.query('insert into appointment_sms_receipts(workspace_id,customer_id,appointment_id,content_key,appointment_updated_at,customer_updated_at,acknowledged_at) values($1,$2,$3,$4,$5,$5,$5)',
      [workspace,customer,appointment,nextKey,version]));
    await denied(db.query('update appointment_sms_receipts set content_key=$1 where appointment_id=$2', [nextKey,appointment]));
    await denied(db.query('delete from appointment_sms_receipts where appointment_id=$1', [appointment]));
    await denied(db.query('select * from profiles'));
    assert.equal((await receipts(appointment)).length, 1);
  });
  await check('anonymous and service roles receive no table or RPC access', async () => {
    for (const role of ['anon','service_role']) {
      await as(role);
      await denied(db.query('select * from appointment_sms_receipts'));
      await denied(ack(installation));
      await denied(insert(installation));
    }
    await as('postgres');
  });
  await check('repeat migration retains acknowledgement history and original business grants', async () => {
    const saved = (await db.query('select to_jsonb(r) row from appointment_sms_receipts r order by to_jsonb(r)::text')).rows;
    const before = await businessSnapshot();
    await db.exec(migration);
    assert.deepEqual((await db.query('select to_jsonb(r) row from appointment_sms_receipts r order by to_jsonb(r)::text')).rows, saved);
    assert.deepEqual(await businessSnapshot(), before);
  });
  await check('unknown schema/policies are rejected rather than overwritten', async () => {
    await db.exec('alter table appointment_sms_receipts add column unexpected text');
    await assert.rejects(db.exec(migration), /eltérő vagy ismeretlen napló/);
    await db.exec('rollback; alter table appointment_sms_receipts drop column unexpected');
    await db.exec('create policy unexpected_read on appointment_sms_receipts for select to authenticated using(true)');
    await assert.rejects(db.exec(migration), /ismeretlen naplójogosultság/);
    await db.exec('rollback; drop policy unexpected_read on appointment_sms_receipts');
  });
  console.log(passed + ' SMS receipt SQL checks passed.');
} finally {
  await db.close();
}
