import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const { PGlite } = createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');
const migrations = await Promise.all(['WORK_PHOTOS.sql', 'WORK_PHOTO_DELETION.sql', 'APPOINTMENT_DEVICES.sql']
  .map(name => readFile(new URL(`../docs/sql/${name}`, import.meta.url), 'utf8')));
const db = new PGlite();
const user = randomUUID(), other = randomUUID(), member = randomUUID();
const workspace = randomUUID(), foreignWorkspace = randomUUID();
const customer = randomUUID(), secondCustomer = randomUUID(), foreignCustomer = randomUUID();
const installation = randomUUID(), nextInstallation = randomUUID(), secondInstallation = randomUUID();
const maintenance = randomUUID(), foreignInstallation = randomUUID();
let passed = 0;
async function check(label, action) { await action(); passed++; console.log(`PASS ${label}`); }
async function as(role, actor = '') {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
}
const denied = (promise, code = '42501') => assert.rejects(promise, error => error.code === code);
async function insertDevice(opts = {}) {
  return (await db.query(`insert into appointment_devices(workspace_id,customer_id,appointment_id,product_key,product_name,unit_number,data)
    values($1,$2,$3,$4,$5,$6,$7) returning *`, [opts.workspace || workspace, opts.customer || customer, opts.appointment || installation,
    opts.key || 'product:test-ac', opts.name ?? 'Teszt klíma 3,5 kW', opts.unit ?? 1, opts.data ?? { indoorSerial: 'IN-001' }])).rows[0];
}
async function insertTariff(opts = {}) {
  return (await db.query(`insert into h_tariff_requests(workspace_id,customer_id,appointment_id,data) values($1,$2,$3,$4) returning *`,
    [opts.workspace || workspace, opts.customer || customer, opts.appointment || installation, opts.data ?? { provider: 'eon' }])).rows[0];
}
async function photo(opts = {}) {
  const id = randomUUID(), w = opts.workspace || workspace, c = opts.customer || customer, a = opts.appointment || installation;
  const path = `${w}/${c}/${a}/${id}.jpg`;
  await db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)', ['work-photos', path, user]);
  return (await db.query(`insert into work_photos(id,workspace_id,customer_id,appointment_id,appointment_type,work_date,storage_path,size_bytes,width,height${opts.extended ? ',device_id,device_side' : ''})
    values($1,$2,$3,$4,$5,'2026-09-14',$6,400000,1920,1080${opts.extended ? ',$7,$8' : ''}) returning *`,
    [id, w, c, a, opts.type || 'installation', path, ...(opts.extended ? [opts.device ?? null, opts.side ?? null] : [])])).rows[0];
}

try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table workspaces(id uuid primary key);
    create table workspace_members(workspace_id uuid references workspaces(id),user_id uuid references auth.users(id),active boolean not null,primary key(workspace_id,user_id));
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
    create policy old_storage on storage.objects for all to anon,authenticated using(true) with check(true);
  `);
  for (const name of ['quotes', 'quote_items', 'jobs', 'work_reports', 'work_checklists', 'documents', 'purchase_declarations', 'maintenance_appointment_items']) {
    await db.exec(`create table ${name}(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid);`);
  }
  await db.query('insert into auth.users values($1),($2),($3)', [user, other, member]);
  await db.query('insert into workspaces values($1),($2)', [workspace, foreignWorkspace]);
  await db.query('insert into workspace_members values($1,$2,true),($3,$4,true),($1,$5,true)', [workspace, user, foreignWorkspace, other, member]);
  await db.query('insert into customers values($1,$2),($3,$2),($4,$5)', [customer, workspace, secondCustomer, foreignCustomer, foreignWorkspace]);
  for (const row of [[installation, workspace, customer, 'installation'], [nextInstallation, workspace, customer, 'installation'],
    [secondInstallation, workspace, secondCustomer, 'installation'], [maintenance, workspace, customer, 'maintenance'],
    [foreignInstallation, foreignWorkspace, foreignCustomer, 'installation']]) {
    await db.query('insert into appointments values($1,$2,$3,$4)', row);
  }
  await db.exec(migrations[0]); await db.exec(migrations[1]);
  await as('authenticated', user);
  const savedPhoto = await photo();
  await as('postgres');
  await check('additive migration preserves existing photo and allows repeat/CRLF execution', async () => {
    await db.exec(migrations[2]); await db.exec(migrations[2]); await db.exec(migrations[2].replace(/\r?\n/g, '\r\n'));
    const row = (await db.query('select * from work_photos where id=$1', [savedPhoto.id])).rows[0];
    assert.equal(row.device_id, null); assert.equal(row.device_side, null);
    delete row.device_id; delete row.device_side; assert.deepEqual(row, savedPhoto);
    assert.equal((await db.query('select count(*)::int n from appointment_devices')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from h_tariff_requests')).rows[0].n, 0);
  });
  await check('anonymous access and direct deletes remain unavailable', async () => {
    for (const table of ['appointment_devices', 'h_tariff_requests']) {
      const result = (await db.query(`select has_table_privilege('anon',$1,'SELECT,INSERT,UPDATE,DELETE') anon_access,
        has_table_privilege('authenticated',$1,'DELETE') member_delete`, [table])).rows[0];
      assert.equal(result.anon_access, false); assert.equal(result.member_delete, false);
    }
  });
  await as('authenticated', user);
  const first = await insertDevice();
  await check('multiple physical units remain separate and the same slot cannot duplicate', async () => {
    const second = await insertDevice({ unit: 2, data: { indoorSerial: 'IN-002' } });
    assert.notEqual(second.id, first.id); assert.equal(second.data.indoorSerial, 'IN-002');
    await denied(insertDevice(), '23505');
    const next = await insertDevice({ appointment: nextInstallation }); assert.notEqual(next.id, first.id);
  });
  await check('device JSON and identity size constraints reject corrupt input', async () => {
    await denied(insertDevice({ unit: 0 }), '23514');
    await denied(insertDevice({ unit: 1001 }), '23514');
    await denied(insertDevice({ unit: 3, name: ' ' }), '23514');
    await denied(insertDevice({ unit: 3, data: ['wrong'] }), '23514');
    await denied(insertDevice({ unit: 3, data: { data: 'a'.repeat(33000) } }), '23514');
  });
  await check('maintenance and mismatched customer/appointment scopes cannot receive a device or tariff', async () => {
    for (const insert of [insertDevice, insertTariff]) {
      await denied(insert({ appointment: maintenance }));
      await denied(insert({ appointment: secondInstallation }));
      await denied(insert({ customer: secondCustomer }));
      await denied(insert({ workspace: foreignWorkspace, customer: foreignCustomer, appointment: foreignInstallation }));
    }
  });
  const tariff = await insertTariff();
  await check('H tariff stores one request per exact installation and validates JSON', async () => {
    assert.equal(tariff.appointment_id, installation); assert.equal(tariff.data.provider, 'eon');
    await denied(insertTariff(), '23505');
    await denied(insertTariff({ appointment: nextInstallation, data: ['wrong'] }), '23514');
    await denied(insertTariff({ appointment: nextInstallation, data: { data: 'x'.repeat(33000) } }), '23514');
  });
  await check('scope and physical unit identity cannot be moved by UPDATE', async () => {
    for (const [column, value] of [['workspace_id', foreignWorkspace], ['customer_id', secondCustomer], ['appointment_id', nextInstallation],
      ['id', randomUUID()], ['product_key', 'different'], ['unit_number', 4], ['created_at', '2000-01-01T00:00:00Z']]) {
      await denied(db.query(`update appointment_devices set ${column}=$1 where id=$2`, [value, first.id]));
    }
    for (const [column, value] of [['workspace_id', foreignWorkspace], ['customer_id', secondCustomer], ['appointment_id', nextInstallation],
      ['created_at', '2000-01-01T00:00:00Z']]) {
      await denied(db.query(`update h_tariff_requests set ${column}=$1 where appointment_id=$2`, [value, installation]));
    }
  });
  await check('data edits advance server version and stale version update affects no rows', async () => {
    const changed = (await db.query('update appointment_devices set data=$1,updated_at=$2 where id=$3 and updated_at=$4 returning *',
      [{ indoorSerial: 'CORRECTED' }, '2000-01-01T00:00:00Z', first.id, first.updated_at])).rows[0];
    assert.equal(changed.data.indoorSerial, 'CORRECTED'); assert.notEqual(changed.updated_at, first.updated_at);
    assert.equal((await db.query('update appointment_devices set data=$1 where id=$2 and updated_at=$3 returning id', [{ indoorSerial: 'stale' }, first.id, first.updated_at])).rows.length, 0);
    const request = (await db.query('update h_tariff_requests set data=$1 where appointment_id=$2 returning *', [{ provider: 'mvm' }, installation])).rows[0];
    assert.equal(request.data.provider, 'mvm'); assert.notEqual(request.updated_at, tariff.updated_at);
  });
  await as('authenticated', other);
  await check('foreign workspace cannot read or edit saved device and tariff', async () => {
    assert.equal((await db.query('select * from appointment_devices')).rows.length, 0);
    assert.equal((await db.query('select * from h_tariff_requests')).rows.length, 0);
    assert.equal((await db.query('update appointment_devices set data=$1 where id=$2 returning id', [{ indoorSerial: 'foreign' }, first.id])).rows.length, 0);
    await denied(insertDevice({ unit: 5 })); await denied(insertTariff({ appointment: nextInstallation }));
  });
  await as('authenticated', member);
  await check('another active member may edit the same workspace without crossing the work scope', async () => {
    assert.equal((await db.query('update appointment_devices set data=$1 where id=$2 returning id', [{ indoorSerial: 'TEAM' }, first.id])).rows.length, 1);
    await denied(db.query('update appointment_devices set appointment_id=$1 where id=$2', [nextInstallation, first.id]));
  });
  await as('postgres'); await db.query('update workspace_members set active=false where user_id=$1', [member]); await as('authenticated', member);
  await check('removed member loses read and write access', async () => {
    assert.equal((await db.query('select * from appointment_devices')).rows.length, 0);
    assert.equal((await db.query('select * from h_tariff_requests')).rows.length, 0);
    await denied(insertDevice({ unit: 6 }));
  });
  await as('authenticated', user);
  const label = await photo({ extended: true, device: first.id, side: 'indoor' });
  await check('label photo references exact device and side while ordinary work photos still work', async () => {
    assert.equal(label.device_id, first.id); assert.equal(label.device_side, 'indoor');
    assert.equal((await photo({ extended: true })).device_id, null);
    assert.equal((await photo({ type: 'maintenance', appointment: maintenance, extended: true })).device_id, null);
  });
  await check('photo/device composite FK rejects another work, customer, workspace and missing device', async () => {
    await denied(photo({ extended: true, device: first.id, side: 'indoor', appointment: nextInstallation }), '23503');
    await denied(photo({ extended: true, device: first.id, side: 'indoor', appointment: secondInstallation, customer: secondCustomer }), '23503');
    await denied(photo({ extended: true, device: randomUUID(), side: 'indoor' }), '23503');
    await as('authenticated', other);
    const foreignDevice = await insertDevice({ workspace: foreignWorkspace, customer: foreignCustomer, appointment: foreignInstallation });
    await as('authenticated', user);
    await denied(photo({ extended: true, device: foreignDevice.id, side: 'outdoor' }), '23503');
  });
  await check('label side and device must be provided together and only for installation', async () => {
    await denied(photo({ extended: true, device: first.id }), '23514');
    await denied(photo({ extended: true, side: 'outdoor' }), '23514');
    await denied(photo({ extended: true, device: first.id, side: 'wrong' }), '23514');
    await denied(photo({ extended: true, device: first.id, side: 'indoor', type: 'maintenance', appointment: maintenance }), '23514');
  });
  await check('photo deletion still frees its object before removing only the metadata', async () => {
    await denied(db.query('delete from appointment_devices where id=$1', [first.id]));
    await db.query('delete from storage.objects where bucket_id=$1 and name=$2', ['work-photos', label.storage_path]);
    await db.query('select finish_work_photo_delete($1,$2,$3,$4)', [label.id, workspace, customer, installation]);
    assert.equal((await db.query('select * from work_photos where id=$1', [label.id])).rows.length, 0);
    assert.equal((await db.query('select * from appointment_devices where id=$1', [first.id])).rows.length, 1);
  });
  await check('repeat migration preserves existing device edits, tariff and ordinary photo', async () => {
    const before = (await db.query('select * from appointment_devices order by id')).rows;
    await as('postgres'); await db.exec(migrations[2]); await as('authenticated', user);
    assert.deepEqual((await db.query('select * from appointment_devices order by id')).rows, before);
    assert.equal((await db.query('select * from work_photos where id=$1', [savedPhoto.id])).rows.length, 1);
  });
  await check('disabled exact-scope trigger is rejected instead of silently accepting weaker protection', async () => {
    await as('postgres');
    await db.exec('alter table appointment_devices disable trigger installation_device_scope;');
    await assert.rejects(db.exec(migrations[2]), /trigger/); await db.exec('rollback;');
    await db.exec('alter table appointment_devices enable trigger installation_device_scope;');
  });
  await check('unknown same-name policy is rejected rather than adopted', async () => {
    await as('postgres');
    await db.exec('comment on policy device_read on appointment_devices is null;');
    await assert.rejects(db.exec(migrations[2]), /policy/); await db.exec('rollback;');
  });
  console.log(`${passed} appointment device SQL checks passed.`);
} finally { await db.close(); }
