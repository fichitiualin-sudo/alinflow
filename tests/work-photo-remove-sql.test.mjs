import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Isolated PostgreSQL-compatible test runtime; no production dependency or live database.
const { PGlite } = createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');
const baseMigration = await readFile(new URL('../docs/sql/WORK_PHOTOS.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../docs/sql/WORK_PHOTO_DELETION.sql', import.meta.url), 'utf8');
const db = new PGlite();
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WA = '10000000-0000-4000-8000-000000000001';
const WB = '10000000-0000-4000-8000-000000000002';
const WS = '10000000-0000-4000-8000-000000000003';
const CA = '20000000-0000-4000-8000-000000000001';
const CB = '20000000-0000-4000-8000-000000000002';
const CS = '20000000-0000-4000-8000-000000000003';
const AA = '30000000-0000-4000-8000-000000000001';
const AB = '30000000-0000-4000-8000-000000000002';
const AS = '30000000-0000-4000-8000-000000000003';
const scopes = new Map([[CA, { workspace: WA, appointment: AA }], [CB, { workspace: WB, appointment: AB }], [CS, { workspace: WS, appointment: AS }]]);
let passed = 0;

async function check(label, run) {
  await run();
  passed += 1;
  console.log(`PASS ${label}`);
}
async function as(role, user = '') {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
}
async function denied(sql, params = [], code = '42501') {
  await assert.rejects(db.query(sql, params), (error) => error.code === code);
}
const objectPath = (customer, id) => `${scopes.get(customer).workspace}/${customer}/${scopes.get(customer).appointment}/${id}.jpg`;
const removeObject = (photo) => db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name', ['work-photos', photo.path]);
const finish = (photo, overrides = {}) => db.query(
  'select public.finish_work_photo_delete(p_photo_id=>$1,p_workspace_id=>$2,p_customer_id=>$3,p_appointment_id=>$4)',
  [photo.id, overrides.workspace || photo.workspace, overrides.customer || photo.customer, overrides.appointment || photo.appointment]);
async function seedPhoto(customer, owner = A, committed = true) {
  const scope = scopes.get(customer);
  const id = randomUUID();
  const photo = { id, customer, ...scope, path: objectPath(customer, id) };
  await as('authenticated', owner);
  await db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)', ['work-photos', photo.path, owner]);
  if (committed) await db.query(`insert into work_photos(id,workspace_id,customer_id,appointment_id,appointment_type,work_date,work_time,storage_path,size_bytes,width,height)
    values($1,$2,$3,$4,'installation','2026-09-13','08:00',$5,400000,1920,1080)`, [id, scope.workspace, customer, scope.appointment, photo.path]);
  return photo;
}
const count = async (table, column, value) => (await db.query(`select count(*)::int as n from ${table} where ${column}=$1`, [value])).rows[0].n;

try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${A}'),('${B}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table workspaces(id uuid primary key);
    insert into workspaces values('${WA}'),('${WB}'),('${WS}');
    create table workspace_members(workspace_id uuid references workspaces(id),user_id uuid references auth.users(id),active boolean not null,primary key(workspace_id,user_id));
    insert into workspace_members values('${WA}','${A}',true),('${WB}','${B}',true),('${WS}','${A}',true),('${WS}','${B}',true);
    alter table workspace_members enable row level security;
    create policy self_member on workspace_members for select to authenticated using(user_id=auth.uid());
    create table customers(id uuid primary key,workspace_id uuid not null references workspaces(id));
    create table appointments(id uuid primary key,workspace_id uuid not null references workspaces(id),customer_id uuid not null references customers(id),appointment_type text not null);
    alter table customers enable row level security; alter table appointments enable row level security;
    create policy customer_member on customers for select to authenticated using(exists(select 1 from workspace_members wm where wm.workspace_id=customers.workspace_id and wm.user_id=auth.uid() and wm.active));
    create policy appointment_member on appointments for select to authenticated using(exists(select 1 from workspace_members wm where wm.workspace_id=appointments.workspace_id and wm.user_id=auth.uid() and wm.active));
    create table storage.buckets(id text primary key,name text not null unique,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated;
    grant select on workspace_members,workspaces,customers,appointments to authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    create policy legacy_wide_open on storage.objects for all to anon,authenticated using(true) with check(true);
    insert into storage.buckets(id,name,public) values('other-bucket','other-bucket',true);
    insert into storage.objects(bucket_id,name) values('other-bucket','unrelated.jpg');
  `);
  for (const table of ['quotes', 'quote_items', 'jobs', 'work_reports', 'work_checklists', 'documents', 'purchase_declarations', 'maintenance_appointment_items']) {
    await db.exec(`create table ${table}(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid);`);
  }
  for (const [customer, scope] of scopes) {
    await db.query('insert into customers(id,workspace_id) values($1,$2)', [customer, scope.workspace]);
    await db.query("insert into appointments(id,workspace_id,customer_id,appointment_type) values($1,$2,$3,'installation')", [scope.appointment, scope.workspace, customer]);
  }
  await db.exec(baseMigration);
  const original = await seedPhoto(CA);
  const unrelated = await seedPhoto(CA);
  await check('predecessor guard still blocks removal of an existing registered photo', async () => {
    assert.equal((await removeObject(original)).rows.length, 0);
  });
  await as('postgres');
  await check('new migration upgrades the known predecessor without changing saved photo data', async () => {
    const before = (await db.query('select * from work_photos order by id')).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from work_photos order by id')).rows, before);
    assert.equal(await count('storage.objects', 'bucket_id', 'work-photos'), 2);
  });
  await check('same migration and CRLF copy are both idempotent', async () => {
    await db.exec(migration);
    await db.exec(migration.replace(/\r?\n/g, '\r\n'));
  });
  await check('only authenticated callers can execute the narrow definer; direct metadata DELETE remains absent', async () => {
    const result = (await db.query(`select
      has_table_privilege('authenticated','public.work_photos','DELETE') as direct_delete,
      has_function_privilege('authenticated','public.finish_work_photo_delete(uuid,uuid,uuid,uuid)','EXECUTE') as member_execute,
      has_function_privilege('anon','public.finish_work_photo_delete(uuid,uuid,uuid,uuid)','EXECUTE') as anon_execute,
      p.prosecdef, p.proconfig from pg_proc p where p.oid='public.finish_work_photo_delete(uuid,uuid,uuid,uuid)'::regprocedure`)).rows[0];
    assert.equal(result.direct_delete, false);
    assert.equal(result.member_execute, true);
    assert.equal(result.anon_execute, false);
    assert.equal(result.prosecdef, true);
    assert.ok(result.proconfig.includes('row_security=off'));
  });
  await as('authenticated', A);
  await check('existing physical file blocks metadata finalization and preserves the registered photo', async () => {
    await assert.rejects(finish(original), (error) => error.code === '55000');
    assert.equal(await count('work_photos', 'id', original.id), 1);
    assert.equal(await count('storage.objects', 'name', original.path), 1);
    await denied('delete from work_photos where id=$1', [original.id]);
  });
  await check('owner removes the file first, then exactly its metadata; another photo remains', async () => {
    assert.equal((await removeObject(original)).rows.length, 1);
    assert.equal(await count('work_photos', 'id', original.id), 1);
    await finish(original);
    assert.equal(await count('work_photos', 'id', original.id), 0);
    assert.equal(await count('storage.objects', 'name', original.path), 0);
    assert.equal(await count('work_photos', 'id', unrelated.id), 1);
    assert.equal(await count('storage.objects', 'name', unrelated.path), 1);
  });
  await check('lost successful finalization response is safely repeatable', async () => {
    await finish(original);
    await finish(original);
    assert.equal(await count('work_photos', 'id', unrelated.id), 1);
  });
  const shared = await seedPhoto(CS);
  await as('authenticated', B);
  await check('another active workspace member may remove a registered photo and retry its remaining metadata', async () => {
    assert.equal((await removeObject(shared)).rows.length, 1);
    assert.equal(await count('work_photos', 'id', shared.id), 1);
    assert.equal(await count('storage.objects', 'name', shared.path), 0);
    await finish(shared);
    await finish(shared);
    assert.equal(await count('work_photos', 'id', shared.id), 0);
  });
  await check('other workspace cannot read, remove or finalize an inaccessible photo', async () => {
    assert.equal(await count('work_photos', 'id', unrelated.id), 0);
    assert.equal((await removeObject(unrelated)).rows.length, 0);
    await assert.rejects(finish(unrelated), (error) => error.code === '42501');
    await assert.rejects(finish(unrelated, { workspace: WB, customer: CB, appointment: AB }), (error) => error.code === '42501');
  });
  const exact = await seedPhoto(CS);
  await check('wrong customer or appointment is rejected even for a member of the supplied workspace', async () => {
    await assert.rejects(finish(exact, { customer: CA }), (error) => error.code === '42501');
    await assert.rejects(finish(exact, { appointment: AA }), (error) => error.code === '42501');
    assert.equal(await count('work_photos', 'id', exact.id), 1);
  });
  const orphan = await seedPhoto(CS, A, false);
  await as('authenticated', B);
  await check('another member cannot remove the uploader orphan, and hidden physical data blocks the definer', async () => {
    assert.equal(await count('storage.objects', 'name', orphan.path), 0);
    assert.equal((await removeObject(orphan)).rows.length, 0);
    await assert.rejects(finish(orphan), (error) => error.code === '55000');
  });
  await as('authenticated', A);
  await check('owner-only compensation of an unreferenced upload remains available', async () => {
    assert.equal((await removeObject(orphan)).rows.length, 1);
    await finish(orphan);
  });
  await as('postgres');
  await db.query('update workspace_members set active=false where workspace_id=$1 and user_id=$2', [WS, B]);
  await as('authenticated', B);
  await check('inactive membership blocks removal and finalization even after metadata is already absent', async () => {
    assert.equal((await removeObject(exact)).rows.length, 0);
    await assert.rejects(finish(exact), (error) => error.code === '42501');
    await assert.rejects(finish(shared), (error) => error.code === '42501');
  });
  await as('postgres');
  await db.query('update workspace_members set active=true where workspace_id=$1 and user_id=$2', [WS, B]);
  await as('anon');
  await check('anonymous users cannot remove photos or call finalization despite a broad legacy Storage policy', async () => {
    assert.equal((await removeObject(exact)).rows.length, 0);
    await assert.rejects(finish(exact), (error) => error.code === '42501');
    await denied('delete from work_photos where id=$1', [exact.id]);
  });
  await check('other buckets keep their existing delete permissions', async () => {
    assert.equal((await db.query("delete from storage.objects where bucket_id='other-bucket' and name='unrelated.jpg' returning id")).rows.length, 1);
  });
  await as('authenticated');
  await check('authenticated role without a user identity cannot finalize an absent photo', async () => {
    await assert.rejects(finish(original), (error) => error.code === '42501');
  });
  await as('authenticated', A);
  await check('photo size/path constraints and overwrite protections remain intact', async () => {
    assert.equal((await db.query('update storage.objects set name=name where bucket_id=$1 and name=$2 returning id', ['work-photos', exact.path])).rows.length, 0);
    await denied('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)', ['work-photos', 'invalid.jpg', A]);
    await denied('update work_photos set size_bytes=1 where id=$1', [exact.id]);
    const oversizedId = randomUUID();
    await denied(`insert into work_photos(id,workspace_id,customer_id,appointment_id,appointment_type,work_date,work_time,storage_path,size_bytes,width,height)
      values($1,$2,$3,$4,'installation','2026-09-13','08:00',$5,500001,1920,1080)`,
    [oversizedId, WS, CS, AS, objectPath(CS, oversizedId)], '23514');
  });
  await as('postgres');
  await check('unknown or drifted cleanup guard aborts without overwriting it', async () => {
    await db.exec('begin; alter policy "AlinFlow work photos storage cleanup guard" on storage.objects using(true);');
    await assert.rejects(db.exec(migration), /eltérő vagy ismeretlen Storage törlési policy/);
    await db.exec('rollback');
    await db.exec(migration);
  });
  await check('unknown finalization body aborts without silently replacing a changed function', async () => {
    await db.exec(`begin; create or replace function public.finish_work_photo_delete(p_photo_id uuid,p_workspace_id uuid,p_customer_id uuid,p_appointment_id uuid)
      returns void language plpgsql security definer set search_path='' set row_security=off as $$ begin return; end $$;`);
    await assert.rejects(db.exec(migration), /eltérő vagy ismeretlen befejező függvény/);
    await db.exec('rollback');
    await db.exec(migration);
  });
  await check('migration preserves every remaining work, customer and unrelated saved photo', async () => {
    assert.equal((await db.query('select count(*)::int as n from customers')).rows[0].n, 3);
    assert.equal((await db.query('select count(*)::int as n from appointments')).rows[0].n, 3);
    assert.equal(await count('work_photos', 'id', unrelated.id), 1);
    assert.equal(await count('storage.objects', 'name', unrelated.path), 1);
    assert.equal(await count('work_photos', 'id', exact.id), 1);
  });
  console.log(`\n${passed} work-photo deletion SQL/RLS checks passed (local PGlite, no live database).`);
} finally {
  await db.close();
}
