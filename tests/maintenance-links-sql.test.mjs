import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Isolated PostgreSQL fixtures only. Never connects to Supabase.
const require = createRequire(import.meta.url);
const { PGlite } = process.env.PGLITE_MODULE_PATH ? require(process.env.PGLITE_MODULE_PATH)
  : createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');
const db = new PGlite();
const workspace = '10000000-0000-0000-0000-000000000001';
const otherWorkspace = '10000000-0000-0000-0000-000000000002';
const user = '90000000-0000-0000-0000-000000000001';
const otherUser = '90000000-0000-0000-0000-000000000002';
const customer = '20000000-0000-0000-0000-000000000001';
const foreignCustomer = '20000000-0000-0000-0000-000000000002';
const first = '40000000-0000-0000-0000-000000000001';
const second = '40000000-0000-0000-0000-000000000002';
const third = '40000000-0000-0000-0000-000000000003';
const survey = '40000000-0000-0000-0000-000000000004';
const maintenance = randomUUID(), sharedInstallation = randomUUID();
let passed = 0;
const source = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
async function check(label, fn) { await fn(); passed++; console.log(`PASS ${label}`); }
async function actor(id = user, role = 'authenticated') {
  await db.exec(`reset role;set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
}
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const replace = (ids, work = maintenance, client = customer, ws = workspace) => scalar(
  'select replace_maintenance_appointment_links($1,$2,$3,$4) saved', [ws, work, client, ids]);
const links = async (work = maintenance) => (await db.query(
  'select * from maintenance_appointment_items where maintenance_appointment_id=$1 order by installation_appointment_id', [work])).rows;
const denied = (promise, code = '42501') => assert.rejects(promise, error => error.code === code);

try {
  await db.exec(await source('tests/fixtures/schema.sql'));
  await db.exec(`
    create table public.workspaces(id uuid primary key,active boolean not null default true);
    insert into workspaces(id) values('${workspace}'),('${otherWorkspace}');
    create table auth.users(id uuid primary key);
    insert into auth.users values('${user}'),('${otherUser}');
    create table public.maintenance_appointment_items(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),
      customer_id uuid not null references customers(id),maintenance_appointment_id uuid not null references appointments(id),
      installation_appointment_id uuid not null references appointments(id),created_at timestamptz not null default now(),
      created_by uuid references auth.users(id),legacy_source_key text unique,
      unique(maintenance_appointment_id,installation_appointment_id));
    grant select,insert,update,delete on maintenance_appointment_items to authenticated;
    alter table maintenance_appointment_items enable row level security;
    create policy member_all on maintenance_appointment_items for all to authenticated
      using(exists(select 1 from workspace_members m where m.workspace_id=maintenance_appointment_items.workspace_id and m.user_id=auth.uid() and m.active))
      with check(exists(select 1 from workspace_members m where m.workspace_id=maintenance_appointment_items.workspace_id and m.user_id=auth.uid() and m.active));
    insert into appointments(id,workspace_id,customer_id,appointment_type,status)
      values('${maintenance}','${workspace}','${customer}','maintenance','Időpont foglalva'),
      ('${sharedInstallation}','${workspace}','${customer}','installation','Lezárva');
    insert into maintenance_appointment_items(workspace_id,customer_id,maintenance_appointment_id,installation_appointment_id,legacy_source_key)
      values('${workspace}','${customer}','${maintenance}','${first}','original-link-provenance');
  `);
  const activeSql = await source('docs/sql/20261012_ACTIVE_WORKSPACE_ACCESS.sql');
  for (const name of ['active_workspace_member', 'require_workspace_member']) {
    await db.exec(activeSql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`))[0]);
  }
  await db.exec(`
    revoke all on function active_workspace_member(uuid),require_workspace_member(uuid) from public,anon;
    grant execute on function active_workspace_member(uuid),require_workspace_member(uuid) to authenticated;
    create policy active_workspace_guard on maintenance_appointment_items as restrictive for all to authenticated
      using(public.active_workspace_member(workspace_id)) with check(public.active_workspace_member(workspace_id));
  `);
  const migration = await source('docs/sql/20261015_ATOMIC_MAINTENANCE_LINKS.sql');
  const initialLinks = await links();
  const originalReports = (await db.query('select * from work_reports order by id')).rows;
  const originalDocuments = (await db.query('select * from documents order by id')).rows;
  const policiesBefore = (await db.query('select * from pg_policies order by tablename,policyname')).rows;
  await check('migration is repeatable and leaves historical links, documents, RLS and FKs intact', async () => {
    const constraints = (await db.query("select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='maintenance_appointment_items'::regclass order by conname")).rows;
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual(await links(), initialLinks);
    assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows, policiesBefore);
    assert.deepEqual((await db.query("select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='maintenance_appointment_items'::regclass order by conname")).rows, constraints);
    const definition = (await db.query("select prosecdef,proconfig from pg_proc where oid='replace_maintenance_appointment_links(uuid,uuid,uuid,uuid[])'::regprocedure")).rows[0];
    assert.equal(definition.prosecdef, false);
    assert.deepEqual(definition.proconfig, ['search_path=pg_catalog, pg_temp']);
  });
  await actor();
  await check('duplicate input and unchanged retries preserve the original link identity and provenance', async () => {
    assert.deepEqual(await replace([first, first]), [first]);
    assert.deepEqual(await links(), initialLinks);
    assert.deepEqual(await replace([first]), [first]);
    assert.deepEqual(await links(), initialLinks);
  });
  await check('valid replacement preserves unchanged links and creates only the added canonical installation', async () => {
    assert.deepEqual(await replace([second, first]), [first, second]);
    const saved = await links();
    assert.deepEqual(saved.find(row => row.installation_appointment_id === first), initialLinks[0]);
    assert.equal(saved.find(row => row.installation_appointment_id === second).created_by, user);
    assert.deepEqual(await replace([first, second, second]), [first, second]);
    assert.deepEqual(await links(), saved);
  });
  await check('nonexistent and job-mirror UUIDs fail before replacement and keep every original link', async () => {
    const before = await links(), job = randomUUID();
    await db.query('insert into jobs(id,workspace_id,customer_id,legacy_source_key) values($1,$2,$3,$4)', [job, workspace, customer, `appointments:${first}`]);
    for (const invalid of [randomUUID(), job]) {
      await denied(replace([third, invalid]), '23514');
      assert.deepEqual(await links(), before);
    }
  });
  await check('foreign workspace/customer installations and wrong work types cannot enter the link set', async () => {
    await db.exec('reset role');
    const otherCustomer = randomUUID(), sameWorkspaceForeign = randomUUID(), foreign = randomUUID();
    await db.query('insert into customers(id,workspace_id) values($1,$2)', [otherCustomer, workspace]);
    await db.query("insert into appointments(id,workspace_id,customer_id,appointment_type) values($1,$2,$3,'installation'),($4,$5,$6,'installation')",
      [sameWorkspaceForeign, workspace, otherCustomer, foreign, otherWorkspace, foreignCustomer]);
    // Even membership in both workspaces cannot authorize cross-workspace links.
    await db.query('insert into workspace_members values($1,$2,true)', [otherWorkspace, user]);
    await actor(); const before = await links();
    for (const invalid of [sameWorkspaceForeign, foreign, survey, maintenance]) {
      await denied(replace([third, invalid]), '23514'); assert.deepEqual(await links(), before);
    }
    for (const args of [[first, customer, workspace], [maintenance, otherCustomer, workspace], [maintenance, customer, otherWorkspace]]) {
      await denied(replace([first], ...args)); assert.deepEqual(await links(), before);
    }
  });
  await check('missing arguments never mean clear all; an explicit empty list clears atomically', async () => {
    const before = await links();
    for (const ids of [null, [null], [first, null]]) {
      await denied(replace(ids), '22023'); assert.deepEqual(await links(), before);
    }
    assert.deepEqual(await replace([]), []); assert.deepEqual(await links(), []);
    await replace([first, second]);
  });
  await check('historically inconsistent appointment/customer scopes cannot authorize new links', async () => {
    await db.exec('reset role');
    const badMaintenance = randomUUID(), badInstallation = randomUUID();
    await db.query("insert into appointments(id,workspace_id,customer_id,appointment_type) values($1,$2,$3,'maintenance'),($4,$2,$3,'installation')",
      [badMaintenance, workspace, foreignCustomer, badInstallation]);
    await actor(); const before = await links();
    await denied(replace([badInstallation], badMaintenance, foreignCustomer));
    assert.deepEqual(await links(), before); assert.deepEqual(await links(badMaintenance), []);
  });
  await check('anonymous, expired identity, inactive membership and inactive workspace are rejected', async () => {
    await actor(null, 'anon'); await denied(replace([]));
    await actor(null); await denied(replace([]));
    await actor(otherUser); await denied(replace([]));
    await db.exec('reset role');
    await db.query('update workspace_members set active=false where workspace_id=$1 and user_id=$2', [workspace, user]);
    await actor(); await denied(replace([]));
    await db.exec('reset role');
    await db.query('update workspace_members set active=true where workspace_id=$1 and user_id=$2', [workspace, user]);
    await db.query('update workspaces set active=false where id=$1', [workspace]);
    await actor(); await denied(replace([]));
    await db.exec('reset role'); await db.query('update workspaces set active=true where id=$1', [workspace]);
    await actor(); assert.equal((await links()).length, 2);
  });
  await check('legacy null installation type remains usable without changing the historical appointment', async () => {
    await db.query('update appointments set appointment_type=null where id=$1', [third]);
    const before = (await db.query('select * from appointments where id=$1', [third])).rows[0];
    assert.deepEqual(await replace([third]), [third]);
    assert.deepEqual((await db.query('select * from appointments where id=$1', [third])).rows[0], before);
    await replace([first]);
  });
  await check('an insert RLS failure after deletion rolls the entire replacement back', async () => {
    const before = await links(); await db.exec('reset role');
    await db.exec(`create policy test_reject_insert on maintenance_appointment_items as restrictive for insert to authenticated with check(installation_appointment_id<>'${second}');`);
    await actor(); await denied(replace([second])); assert.deepEqual(await links(), before);
    await db.exec('reset role'); await db.exec('drop policy test_reject_insert on maintenance_appointment_items');
    await actor();
  });
  await check('existing shared-completion trigger still rejects late unsigned links and restores deleted links', async () => {
    await db.exec('reset role');
    await db.exec(`
      alter table work_reports add column signed_at timestamptz,add column signer_name text,add column privacy_notice jsonb;
      create table shared_maintenance_handoffs(target_installation_id uuid,target_workspace_id uuid,target_customer_id uuid);
      create table shared_maintenance_work_origins(appointment_id uuid primary key,workspace_id uuid,customer_id uuid);
      insert into shared_maintenance_handoffs values('${sharedInstallation}','${workspace}','${customer}');
    `);
    const sharedSql = await source('docs/sql/20261011_SHARED_MAINTENANCE_ACCESS.sql');
    for (const name of ['shared_maintenance_has_signed_notice', 'guard_shared_maintenance_completion']) {
      await db.exec(sharedSql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`))[0]);
    }
    await db.exec(`
      create trigger shared_maintenance_completion_guard before insert or update on appointments
        for each row execute function guard_shared_maintenance_completion();
      create trigger shared_maintenance_link_completion_guard before insert or update on maintenance_appointment_items
        for each row execute function guard_shared_maintenance_completion();
    `);
    await actor();
    await db.query("update appointments set status='Lezárva' where id=$1", [maintenance]);
    const before = await links();
    await denied(replace([sharedInstallation]), '23514');
    assert.deepEqual(await links(), before);
    await db.exec('reset role');
    assert.equal(await scalar('select count(*)::int from shared_maintenance_work_origins'), 0);
    await actor();
  });
  await check('unchanged completed links do not re-run completion or rewrite signed records', async () => {
    const signedAt = '2026-10-15T12:00:00.000Z', signature = 'data:image/png;base64,QUJD', signer = 'Synthetic signer';
    const notice = { version: '2026-10-11.2', signedAt, signatureDataUrl: signature, signerName: signer };
    await db.query('insert into work_reports(workspace_id,customer_id,appointment_id,appointment_type,signed_at,signature_data_url,signer_name,privacy_notice) values($1,$2,$3,$4,$5,$6,$7,$8)',
      [workspace, customer, maintenance, 'maintenance', signedAt, signature, signer, notice]);
    await replace([sharedInstallation]);
    const before = await links();
    const report = (await db.query('select * from work_reports where appointment_id=$1', [maintenance])).rows;
    assert.deepEqual(await replace([sharedInstallation, sharedInstallation]), [sharedInstallation]);
    assert.deepEqual(await links(), before);
    assert.deepEqual((await db.query('select * from work_reports where appointment_id=$1', [maintenance])).rows, report);
    // A harmless retry must also preserve a historical completed link after a
    // saved notice becomes unavailable; no new delegation or completion occurs.
    await db.query('delete from work_reports where appointment_id=$1', [maintenance]);
    assert.deepEqual(await replace([sharedInstallation]), [sharedInstallation]);
    assert.deepEqual(await links(), before);
    await denied(db.query("update appointments set status='Lezárva' where id=$1", [maintenance]), '23514');
  });
  await check('unrelated signed reports and documents remain unchanged across every operation', async () => {
    await db.exec('reset role');
    const after = (await db.query('select id,workspace_id,customer_id,appointment_id,appointment_type,work_date,work_time,signature_data_url from work_reports order by id')).rows;
    assert.deepEqual(after, originalReports);
    assert.deepEqual((await db.query('select * from documents order by id')).rows, originalDocuments);
  });
  console.log(`${passed} maintenance link SQL checks passed.`);
} finally { await db.close(); }
