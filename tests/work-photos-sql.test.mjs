import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Isolated optional test runtime; no extra production/build dependency.
// Install once: npm install --prefix .photo-test --no-package-lock --no-audit --no-fund @electric-sql/pglite
const { PGlite } = createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');

const db = new PGlite();
const migration = await readFile(new URL('../docs/sql/WORK_PHOTOS.sql', import.meta.url), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CA = '11111111-1111-4111-8111-111111111111';
const CB = '22222222-2222-4222-8222-222222222222';
const SHARED = '33333333-3333-4333-8333-333333333333';
const P = '44444444-4444-4444-8444-444444444444';
const Q = '55555555-5555-4555-8555-555555555555';
const R = '66666666-6666-4666-8666-666666666666';
const CFAIL = '77777777-7777-4777-8777-777777777777';
const COK = '88888888-8888-4888-8888-888888888888';
const W1 = '10000000-0000-4000-8000-000000000001';
const W2 = '10000000-0000-4000-8000-000000000002';
const WS = '10000000-0000-4000-8000-000000000003';
const workspaceFor = (customer) => customer === CB ? W2 : customer === SHARED ? WS : W1;
const appointmentFor = (customer) => customer.slice(0, -1) + '9';
const path = (customer, photo) => `${workspaceFor(customer)}/${customer}/${appointmentFor(customer)}/${photo}.jpg`;
const rpc = (customer, workspace = workspaceFor(customer)) => db.query('select delete_customer_preserving_photos(p_customer_id => $1, p_workspace_id => $2)', [customer, workspace]);
let passed = 0;

async function as(role, user = '') {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
}
async function test(label, run) {
  await run();
  passed += 1;
  console.log(`PASS ${label}`);
}
async function denied(sql, params = [], code = '42501') {
  await assert.rejects(db.query(sql, params), (error) => error.code === code);
}
async function upload(customer, photo, user) {
  return db.query('insert into storage.objects (bucket_id, name, owner_id) values ($1,$2,$3) returning name',
    ['work-photos', path(customer, photo), user]);
}
async function metadata(customer, photo, patch = {}) {
  const row = { id: photo, workspace_id: workspaceFor(customer), customer_id: customer, appointment_id: appointmentFor(customer), appointment_type: 'installation',
    work_date: '2026-09-13', work_time: '08:00', storage_path: path(customer, photo),
    size_bytes: 400000, width: 1920, height: 1080, ...patch };
  const fields = Object.keys(row);
  return db.query(`insert into public.work_photos (${fields.join(',')}) values (${fields.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(row));
}

await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key);
  insert into auth.users values ('${A}'),('${B}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create table workspaces(id uuid primary key);
  insert into workspaces values ('${W1}'),('${W2}'),('${WS}');
  create table workspace_members(workspace_id uuid references workspaces(id),user_id uuid references auth.users(id),active boolean not null,primary key(workspace_id,user_id));
  insert into workspace_members values ('${W1}','${A}',true),('${W2}','${B}',true),('${WS}','${A}',true),('${WS}','${B}',true);
  alter table workspace_members enable row level security;
  create policy member_self on workspace_members for select to authenticated using(user_id=auth.uid());
  create table customers(id uuid primary key,workspace_id uuid not null references workspaces(id) on delete restrict);
  create table quotes(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),customer_id uuid not null references customers(id) on delete cascade,appointment_id uuid);
  create table appointments(id uuid primary key,workspace_id uuid not null references workspaces(id),customer_id uuid not null references customers(id) on delete cascade,
    quote_id uuid references quotes(id) on delete set null,appointment_type text not null,scheduled_date date,scheduled_time text,stock_deducted_at timestamptz);
  alter table quotes add foreign key(appointment_id) references appointments(id) on delete set null;
  create table jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),customer_id uuid not null references customers(id) on delete cascade,quote_id uuid references quotes(id) on delete set null);
  create table quote_items(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),quote_id uuid not null references quotes(id) on delete cascade);
  create table work_reports(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),customer_id uuid not null references customers(id) on delete cascade,
    appointment_id uuid references appointments(id) on delete set null,appointment_type text,work_date date,work_time text);
  create table work_checklists(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),customer_id uuid not null references customers(id) on delete cascade,appointment_id uuid references appointments(id) on delete set null);
  create table documents(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),customer_id uuid not null references customers(id) on delete cascade,appointment_id uuid references appointments(id) on delete set null);
  create table purchase_declarations(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),customer_id uuid not null references customers(id) on delete cascade,
    appointment_id uuid references appointments(id) on delete set null,work_report_id uuid references work_reports(id) on delete set null);
  create table maintenance_appointment_items(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),customer_id uuid not null references customers(id) on delete cascade,
    maintenance_appointment_id uuid not null references appointments(id) on delete cascade,installation_appointment_id uuid not null references appointments(id) on delete cascade);
  create table storage.buckets(id text primary key,name text not null unique,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text,unique(bucket_id,name));
  alter table storage.objects enable row level security;
  grant usage on schema public,auth,storage to anon,authenticated;
  grant select on workspaces,workspace_members to authenticated;
  grant select,insert,update,delete on storage.objects to anon,authenticated;
  create policy legacy_wide_open on storage.objects for all to anon,authenticated using(true) with check(true);
  insert into storage.buckets(id,name,public) values('unrelated-public','unrelated-public',true);
  insert into storage.objects(bucket_id,name) values('unrelated-public','public.jpg');
`);
const graphTables=['customers','appointments','quotes','quote_items','jobs','documents','work_checklists','work_reports','purchase_declarations','maintenance_appointment_items'];
for (const table of graphTables) {
  await db.exec(`alter table ${table} enable row level security;
    grant select,insert,update,delete on ${table} to authenticated;
    create policy member_all on ${table} for all to authenticated
      using(exists(select 1 from workspace_members wm where wm.workspace_id=${table}.workspace_id and wm.user_id=auth.uid() and wm.active))
      with check(exists(select 1 from workspace_members wm where wm.workspace_id=${table}.workspace_id and wm.user_id=auth.uid() and wm.active));`);
}
// Exercise the real deployed guard, including quote/appointment SET NULL restrictions.
const auditSql=await readFile(new URL('../docs/sql/20260906_AUDIT_DATA_SAFETY.sql',import.meta.url),'utf8');
const guardStart=auditSql.indexOf('create or replace function public.guard_work_scope()');
const guardEnd=auditSql.indexOf('\n$$;',guardStart)+4;
assert(guardStart>=0&&guardEnd>guardStart);
await db.exec(auditSql.slice(guardStart,guardEnd));
for (const table of ['appointments','quotes','work_reports','work_checklists']) {
  await db.exec(`create trigger ${table}_guard before ${table==='appointments'?'update':'insert or update'} on ${table} for each row execute function public.guard_work_scope()`);
}
async function seedCustomer(customer) {
  const workspace=workspaceFor(customer), appointment=appointmentFor(customer);
  await db.query('insert into customers(id,workspace_id) values($1,$2) on conflict do nothing',[customer,workspace]);
  await db.query("insert into appointments(id,workspace_id,customer_id,appointment_type,scheduled_date,scheduled_time) values($1,$2,$3,$4,'2026-09-13','08:00') on conflict do nothing",[appointment,workspace,customer,customer===SHARED?'maintenance':'installation']);
}
for(const customer of [CA,CB,SHARED]) await seedCustomer(customer);
async function seedGraph(customer) {
  await seedCustomer(customer);
  const workspace=workspaceFor(customer),appointment=appointmentFor(customer);
  const quote=(await db.query('insert into quotes(workspace_id,customer_id,appointment_id) values($1,$2,$3) returning id',[workspace,customer,appointment])).rows[0].id;
  await db.query('update appointments set quote_id=$1 where id=$2',[quote,appointment]);
  await db.query('insert into jobs(workspace_id,customer_id,quote_id) values($1,$2,$3)',[workspace,customer,quote]);
  await db.query('insert into quote_items(workspace_id,quote_id) values($1,$2)',[workspace,quote]);
  for(const table of ['documents','work_checklists'])
    await db.query(`insert into ${table}(workspace_id,customer_id,appointment_id) values($1,$2,$3)`,[workspace,customer,appointment]);
  const report=(await db.query("insert into work_reports(workspace_id,customer_id,appointment_id,appointment_type,work_date,work_time) values($1,$2,$3,'installation','2026-09-13','08:00') returning id",[workspace,customer,appointment])).rows[0].id;
  await db.query('insert into purchase_declarations(workspace_id,customer_id,appointment_id,work_report_id) values($1,$2,$3,$4)',[workspace,customer,appointment,report]);
  await db.query('insert into maintenance_appointment_items(workspace_id,customer_id,maintenance_appointment_id,installation_appointment_id) values($1,$2,$3,$3)',[workspace,customer,appointment]);
}
async function graphCounts(customer) {
  const counts={};
  for(const table of ['documents','work_checklists','work_reports','jobs','quotes','appointments','purchase_declarations','maintenance_appointment_items'])
    counts[table]=(await db.query(`select count(*)::int as n from ${table} where customer_id=$1`,[customer])).rows[0].n;
  counts.quote_items=(await db.query('select count(*)::int as n from quote_items where quote_id in(select id from quotes where customer_id=$1)',[customer])).rows[0].n;
  counts.customers=(await db.query('select count(*)::int as n from customers where id=$1',[customer])).rows[0].n;
  return counts;
}

await test('migration executes against PostgreSQL', async () => db.exec(migration));
await test('same migration is idempotent on second run', async () => db.exec(migration));
await test('CRLF and LF migration copies are both idempotent', async () => db.exec(migration.replace(/\r?\n/g, '\r\n')));
await test('bucket is private with exact JPEG and 500000-byte limits', async () => {
  const result = await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id='work-photos'");
  assert.deepEqual(result.rows, [{ public: false, file_size_limit: 500000, allowed_mime_types: ['image/jpeg'] }]);
});
await as('authenticated', A);
await test('owner can upload visible-customer UUID path', async () => {
  assert.equal((await upload(CA, P, A)).rows.length, 1);
});
await test('owner can reconcile its upload before metadata exists', async () => {
  assert.equal((await db.query('select name from storage.objects where name=$1', [path(CA, P)])).rows.length, 1);
});
await test('metadata insert and customer photo reload work', async () => {
  await metadata(CA, P);
  assert.equal((await db.query('select id from work_photos where customer_id=$1', [CA])).rows.length, 1);
});
await test('registered photo cannot be removed even by its uploader', async () => {
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [path(CA, P)])).rows.length, 0);
});
await test('photo cannot be updated despite broad legacy Storage policy', async () => {
  assert.equal((await db.query('update storage.objects set owner_id=$1 where name=$2 returning id', [B, path(CA, P)])).rows.length, 0);
});
await test('photo cannot be overwritten with INSERT conflict UPDATE', async () => {
  await denied('insert into storage.objects (bucket_id,name,owner_id) values ($1,$2,$3) on conflict (bucket_id,name) do update set owner_id=excluded.owner_id',
    ['work-photos', path(CA, P), A]);
});
await test('metadata UPDATE and DELETE are denied', async () => {
  await denied('update work_photos set work_date=$1 where id=$2', ['2027-01-01', P]);
  await denied('delete from work_photos where id=$1', [P]);
});
await test('new Storage object must have current owner', async () => {
  await denied('insert into storage.objects(bucket_id,name,owner_id) values ($1,$2,$3)', ['work-photos', path(CA, Q), B]);
});
await test('noncanonical path and extension are rejected', async () => {
  for (const name of ['filename.jpg', `${CA}/${Q}.png`, `${CA}/nested/${Q}.jpg`, `${CA}/${Q}.jpg/extra`]) {
    await denied('insert into storage.objects(bucket_id,name,owner_id) values ($1,$2,$3)', ['work-photos', name, A]);
  }
});
await test('inaccessible customer upload and metadata are denied', async () => {
  await assert.rejects(upload(CB, Q, A), (error) => error.code === '42501');
  await assert.rejects(metadata(CB, Q), (error) => error.code === '42501');
});
await test('metadata cannot spoof created_by', async () => {
  await assert.rejects(metadata(CA, Q, { created_by: B }), (error) => error.code === '42501');
});
await test('metadata requires exact workspace customer appointment and type', async () => {
  for (const patch of [
    { workspace_id: W2 }, { appointment_id: appointmentFor(CB) }, { appointment_type: 'maintenance' },
  ]) await assert.rejects(metadata(CA, Q, patch), (error) => error.code === '42501');
  const invalidPath = `${W1}/${CA}/${appointmentFor(CB)}/${Q}.jpg`;
  await denied('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)', ['work-photos', invalidPath, A]);
});
await test('metadata validates sizes, dimensions, type, date, and exact path', async () => {
  for (const patch of [{ size_bytes: 0 }, { size_bytes: 500001 }, { width: 0 }, { width: 1921 },
    { height: 0 }, { height: 1921 }, { storage_path: path(CB, Q) }]) {
    await assert.rejects(metadata(CA, Q, patch), (error) => error.code === '23514');
  }
  await assert.rejects(metadata(CA, Q, { work_date: null }), (error) => error.code === '23502');
});
await test('owner can remove unreferenced upload for compensation', async () => {
  await upload(CA, Q, A);
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [path(CA, Q)])).rows.length, 1);
});
await upload(SHARED, Q, A);
await metadata(SHARED, Q, { appointment_type: 'maintenance' });
await upload(SHARED, R, A);

await as('authenticated', B);
await test('other user cannot read inaccessible customer photo', async () => {
  assert.equal((await db.query('select id from work_photos where customer_id=$1', [CA])).rows.length, 0);
  assert.equal((await db.query('select name from storage.objects where name=$1', [path(CA, P)])).rows.length, 0);
});
await test('other permitted user can read shared-customer committed photo', async () => {
  assert.equal((await db.query('select id from work_photos where customer_id=$1', [SHARED])).rows.length, 1);
  assert.equal((await db.query('select name from storage.objects where name=$1', [path(SHARED, Q)])).rows.length, 1);
});
await test('other user cannot read or delete uploader orphan', async () => {
  assert.equal((await db.query('select name from storage.objects where name=$1', [path(SHARED, R)])).rows.length, 0);
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [path(SHARED, R)])).rows.length, 0);
});
await test('other permitted user cannot delete committed shared-customer photo', async () => {
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [path(SHARED, Q)])).rows.length, 0);
});

await as('anon');
await test('anon cannot query photo metadata', async () => denied('select * from work_photos'));
await test('anon cannot see work-photos but unrelated public bucket remains accessible', async () => {
  assert.deepEqual((await db.query('select name from storage.objects order by name')).rows, [{ name: 'public.jpg' }]);
});
await test('anon cannot insert photos despite wide legacy grant', async () => {
  await denied('insert into storage.objects(bucket_id,name,owner_id) values ($1,$2,$3)', ['work-photos', path(CA, Q), A]);
});
await test('anon cannot update or delete existing photo', async () => {
  assert.equal((await db.query('update storage.objects set name=name where bucket_id=$1 returning id', ['work-photos'])).rows.length, 0);
  assert.equal((await db.query('delete from storage.objects where bucket_id=$1 returning id', ['work-photos'])).rows.length, 0);
});
await test('other buckets retain existing anon write permissions', async () => {
  await db.query("insert into storage.objects(bucket_id,name) values ('unrelated-public','another.jpg')");
  assert.equal((await db.query("update storage.objects set name='renamed.jpg' where name='another.jpg' returning id")).rows.length, 1);
  assert.equal((await db.query("delete from storage.objects where name='renamed.jpg' returning id")).rows.length, 1);
});

await as('postgres');
await test('customer deletion with committed photos is blocked by FK', async () => {
  await assert.rejects(db.query('delete from customers where id=$1', [CA]),
    (error) => ['23503', '23001'].includes(error.code) && error.constraint === 'work_photos_customer_id_fkey');
});
await seedGraph(CA);
await seedGraph(CFAIL);
await seedGraph(COK);
const fullGraph = { documents: 1, work_checklists: 1, work_reports: 1, jobs: 1, quotes: 1, appointments: 1, purchase_declarations: 1, maintenance_appointment_items: 1, quote_items: 1, customers: 1 };
await as('authenticated', A);
await test('atomic RPC rejects photo customer before deleting any historical records', async () => {
  await assert.rejects(rpc(CA), /mentett munkafotók tartoznak/);
  assert.deepEqual(await graphCounts(CA), fullGraph);
});
await as('postgres');
await db.exec(`create function public.fail_job_delete() returns trigger language plpgsql as $$
  begin
    if old.customer_id = '${CFAIL}' then raise exception 'simulated child deletion failure'; end if;
    return old;
  end; $$;
  create trigger fail_job_delete before delete on public.jobs for each row execute function public.fail_job_delete();`);
await as('authenticated', A);
await test('late child deletion failure rolls back all preceding deletes in RPC', async () => {
  await assert.rejects(rpc(CFAIL), /simulated child deletion failure/);
  assert.deepEqual(await graphCounts(CFAIL), fullGraph);
});
await test('successful authenticated RPC deletes the complete customer graph', async () => {
  await upload(COK, Q, A);
  await rpc(COK);
  assert.deepEqual(await graphCounts(COK), Object.fromEntries(Object.keys(fullGraph).map((key) => [key, 0])));
  assert.deepEqual(await graphCounts(CA), fullGraph);
  assert.deepEqual(await graphCounts(CFAIL), fullGraph);
});
await test('owner can clean up upload after customer deletion wins before metadata', async () => {
  assert.equal((await db.query('select name from storage.objects where name=$1', [path(COK, Q)])).rows.length, 1);
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id', [path(COK, Q)])).rows.length, 1);
});
await as('authenticated', B);
await test('RPC respects caller RLS and cannot delete an inaccessible customer', async () => {
  await assert.rejects(rpc(CFAIL), /nem található vagy nincs jogosultság|Nincs jogosultság ehhez/);
});
await as('anon');
await test('anon lacks RPC execute permission', async () => {
  await denied('select delete_customer_preserving_photos($1,$2)', [CA,W1]);
});
await as('postgres');
await test('RPC uses invoker rights and empty search_path', async () => {
  const result = (await db.query("select prosecdef, proconfig from pg_proc where oid='public.delete_customer_preserving_photos(uuid,uuid)'::regprocedure")).rows[0];
  assert.equal(result.prosecdef, false);
  assert.deepEqual(result.proconfig, ['search_path=""']);
});
await test('separate maintenance appointment keeps same-customer photos distinct', async () => {
  const maintenanceId = '90000000-0000-4000-8000-000000000001';
  const maintenancePhoto = '90000000-0000-4000-8000-000000000002';
  const maintenancePath = `${W1}/${CA}/${maintenanceId}/${maintenancePhoto}.jpg`;
  await as('authenticated', A);
  await db.query("insert into appointments(id,workspace_id,customer_id,appointment_type,scheduled_date,scheduled_time) values($1,$2,$3,'maintenance','2027-09-13','08:00')", [maintenanceId,W1,CA]);
  await db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)', ['work-photos',maintenancePath,A]);
  await metadata(CA,maintenancePhoto,{appointment_id:maintenanceId,appointment_type:'maintenance',storage_path:maintenancePath});
  assert.deepEqual((await db.query('select id from work_photos where appointment_id=$1',[appointmentFor(CA)])).rows,[{id:P}]);
  assert.deepEqual((await db.query('select id from work_photos where appointment_id=$1',[maintenanceId])).rows,[{id:maintenancePhoto}]);
  await as('postgres');
});
await test('retry after rescheduling retains original snapshot and appointment identity', async () => {
  const retryPhoto = '90000000-0000-4000-8000-000000000003';
  await as('authenticated', A);
  await db.query("update appointments set scheduled_date='2028-01-02',scheduled_time='12:00' where id=$1",[appointmentFor(CA)]);
  await upload(CA,retryPhoto,A); await metadata(CA,retryPhoto);
  const result=(await db.query('select appointment_id,work_time,work_date::text from work_photos where id=$1',[retryPhoto])).rows[0];
  assert.deepEqual(result,{appointment_id:appointmentFor(CA),work_time:'08:00',work_date:'2026-09-13'});
  await as('postgres');
});
await test('inactive membership removes photo access and upload authority', async () => {
  await db.query('update workspace_members set active=false where workspace_id=$1 and user_id=$2',[W1,A]);
  await as('authenticated',A);
  assert.equal((await db.query('select id from work_photos where workspace_id=$1',[W1])).rows.length,0);
  assert.equal((await db.query('select name from storage.objects where name=$1',[path(CA,P)])).rows.length,0);
  await assert.rejects(upload(CA,Q,A),(error)=>error.code==='42501');
  await as('postgres');
  await db.query('update workspace_members set active=true where workspace_id=$1 and user_id=$2',[W1,A]);
});
await test('customer workspace change cannot hide metadata then delete referenced file', async () => {
  await db.query('insert into workspace_members(workspace_id,user_id,active) values($1,$2,true)',[W2,A]);
  await as('authenticated',A);
  await db.query('update customers set workspace_id=$1 where id=$2',[W2,CA]);
  assert.equal((await db.query('select id from work_photos where id=$1',[P])).rows.length,1);
  assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[path(CA,P)])).rows.length,0);
  const before=await graphCounts(CA);
  await assert.rejects(rpc(CA,W2),/mentett munkafotók tartoznak/);
  assert.deepEqual(await graphCounts(CA),before);
  await assert.rejects(metadata(CA,Q),(error)=>error.code==='42501');
  await db.query('update customers set workspace_id=$1 where id=$2',[W1,CA]);
  await as('postgres');
  await db.query('delete from workspace_members where workspace_id=$1 and user_id=$2',[W2,A]);
});
await test('incompatible bucket configuration aborts without overwriting it', async () => {
  await db.exec("update storage.buckets set public=true where id='work-photos'");
  await assert.rejects(db.exec(migration), /létező work-photos bucket eltérő/);
  await db.exec('rollback');
  assert.equal((await db.query("select public from storage.buckets where id='work-photos'")).rows[0].public, true);
  await db.exec("update storage.buckets set public=false where id='work-photos'");
});
await test('existing table schema drift aborts rather than silently proceeding', async () => {
  await db.exec('alter table work_photos add column unexpected text');
  await assert.rejects(db.exec(migration), /eltérő vagy ismeretlen public.work_photos/);
  await db.exec('rollback; alter table work_photos drop column unexpected');
});
await test('existing policy drift aborts rather than silently broadening access', async () => {
  await db.exec('alter policy "AlinFlow work photos storage read guard" on storage.objects using (true)');
  await assert.rejects(db.exec(migration), /eltérő\/ismeretlen policy/);
  await db.exec('rollback');
});

console.log(`\n${passed} SQL/RLS regression checks passed (local PGlite, no live database).`);
await db.close();
