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
  create table workspaces(id uuid primary key,active boolean not null default true);
  insert into workspaces(id) values ('${W1}'),('${W2}'),('${WS}');
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


await db.exec(migration);
await db.exec(await readFile(new URL('../docs/sql/WORK_PHOTO_DELETION.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../docs/sql/APPOINTMENT_DEVICES.sql',import.meta.url),'utf8'));
const extraTables=['seller_companies','climate_products','inventory_stock','material_inventory','workspace_settings'];
for(const table of extraTables) await db.exec(`create table public.${table}(workspace_id uuid references workspaces(id),data text);
  alter table public.${table} enable row level security;
  grant select,insert,update,delete on public.${table} to authenticated;
  create policy existing_member on public.${table} for all to authenticated using(exists(select 1 from workspace_members m where m.workspace_id=${table}.workspace_id and m.user_id=auth.uid() and m.active)) with check(exists(select 1 from workspace_members m where m.workspace_id=${table}.workspace_id and m.user_id=auth.uid() and m.active));`);
const activeSql=await readFile(new URL('../docs/sql/20261012_ACTIVE_WORKSPACE_ACCESS.sql',import.meta.url),'utf8');
const beforePolicies=(await db.query('select * from pg_policies order by tablename,policyname')).rows;
await test('active workspace upgrade is idempotent and preserves previous permissive policies',async()=>{
  await db.exec(activeSql);await db.exec(activeSql);
  const after=(await db.query("select * from pg_policies where policyname not in ('active_workspace_guard','AlinFlow active workspace storage guard') order by tablename,policyname")).rows;
  assert.deepEqual(after,beforePolicies);
  assert.equal((await db.query("select count(*)::int n from pg_policies where policyname='active_workspace_guard' and permissive='RESTRICTIVE'")).rows[0].n,18);
});
await as('authenticated',A);
await upload(CA,P,A);await metadata(CA,P);
await db.query("insert into appointment_devices(workspace_id,customer_id,appointment_id,product_key,product_name,unit_number) values($1,$2,$3,'AC','Synthetic device',1)",[W1,CA,appointmentFor(CA)]);
await test('active workspace member still reads CRM, devices, photos and Storage',async()=>{
  for(const table of ['customers','appointments','appointment_devices','work_photos'])assert.equal((await db.query(`select * from ${table} where workspace_id=$1`,[W1])).rows.length,1);
  assert.equal((await db.query('select name from storage.objects where name=$1',[path(CA,P)])).rows.length,1);
  await db.query('select require_workspace_member($1)',[W1]);
});
await test('deactivation denies CRM/device/photo reads, writes, Storage and definer cleanup',async()=>{
  await as('postgres');await db.query('update workspaces set active=false where id=$1',[W1]);await as('authenticated',A);
  for(const table of [...graphTables,...extraTables,'appointment_devices','h_tariff_requests','work_photos'])assert.equal((await db.query(`select * from ${table} where workspace_id=$1`,[W1])).rows.length,0,table);
  assert.equal((await db.query('select name from storage.objects where name=$1',[path(CA,P)])).rows.length,0);
  assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[path(CA,P)])).rows.length,0);
  await denied('select require_workspace_member($1)',[W1]);
  await denied('select finish_work_photo_delete($1,$2,$3,$4)',[P,W1,CA,appointmentFor(CA)]);
  await assert.rejects(upload(CA,Q,A),e=>e.code==='42501');
  await assert.rejects(metadata(CA,Q),e=>e.code==='42501');
  await denied('insert into customers(id,workspace_id) values($1,$2)',[Q,W1]);
  assert.equal((await db.query('delete from customers where id=$1 returning id',[CA])).rows.length,0);
  assert.equal((await db.query("update appointment_devices set product_name='Wrong' where workspace_id=$1 returning id",[W1])).rows.length,0);
  await denied("insert into appointment_devices(workspace_id,customer_id,appointment_id,product_key,product_name,unit_number) values($1,$2,$3,'AC','Wrong',2)",[W1,CA,appointmentFor(CA)]);
});
await test('other active workspace and unrelated Storage bucket retain their previous access',async()=>{
  assert.equal((await db.query('select id from customers where id=$1',[SHARED])).rows.length,1);
  assert.equal((await db.query("select name from storage.objects where bucket_id='unrelated-public'")).rows.length,1);
  await upload(SHARED,R,A);await metadata(SHARED,R,{appointment_type:'maintenance'});
  await as('authenticated',B);assert.equal((await db.query('select id from customers where id=$1',[CB])).rows.length,1);
  assert.equal((await db.query('select id from work_photos where customer_id=$1',[SHARED])).rows.length,1);
});
await test('reactivation restores prior access and foreign/revoked members remain denied',async()=>{
  await as('postgres');await db.query('update workspaces set active=true where id=$1',[W1]);await as('authenticated',A);
  assert.equal((await db.query('select id from work_photos where id=$1',[P])).rows.length,1);
  assert.equal((await db.query('select name from storage.objects where name=$1',[path(CA,P)])).rows.length,1);
  assert.equal((await db.query('select active_workspace_member($1) allowed',[W2])).rows[0].allowed,false);
  await as('postgres');await db.query('update workspace_members set active=false where workspace_id=$1 and user_id=$2',[W1,A]);await as('authenticated',A);
  assert.equal((await db.query('select id from customers where id=$1',[CA])).rows.length,0);
  await denied('select require_workspace_member($1)',[W1]);
  await as('anon');await denied('select active_workspace_member($1)',[W1]);
});
await db.close();console.log(`Completed ${passed} active-workspace PostgreSQL checks.`);
