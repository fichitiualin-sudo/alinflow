import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Real isolated PostgreSQL, synthetic fixtures only. Never connects to Supabase.
const require = createRequire(import.meta.url);
const { PGlite } = process.env.PGLITE_MODULE_PATH ? require(process.env.PGLITE_MODULE_PATH)
  : createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');
const db = new PGlite();
const migration = await readFile(new URL('../docs/sql/20261011_SHARED_MAINTENANCE_ACCESS.sql', import.meta.url), 'utf8');
const historyMigration = await readFile(new URL('../docs/sql/20261012_SHARED_MAINTENANCE_HISTORY.sql', import.meta.url), 'utf8');
const optOutMigration = await readFile(new URL('../docs/sql/20261027_SHARED_MAINTENANCE_OPT_OUT.sql', import.meta.url), 'utf8');
const source = '10000000-0000-0000-0000-000000000001', target = '10000000-0000-0000-0000-000000000002';
const owner = '90000000-0000-0000-0000-000000000001', partner = '90000000-0000-0000-0000-000000000002';
const stranger = randomUUID(), otherMember = randomUUID();
const installation = '40000000-0000-0000-0000-000000000001', customer = '20000000-0000-0000-0000-000000000001';
const secondInstallation = '40000000-0000-0000-0000-000000000002';
let passed = 0, grant, handoff;
async function check(label, fn) { await fn(); passed++; console.log(`PASS ${label}`); }
async function actor(id, role = 'authenticated') {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
}
async function scalar(sql, args = []) { return Object.values((await db.query(sql, args)).rows[0])[0]; }
const rpc = (name, args) => scalar(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args);
const denied = (promise, code = '42501') => assert.rejects(promise, error => error.code === code);
const grantAccess = (reference = 'Signed processor agreement TEST-2026-10') => rpc('grant_shared_maintenance_access', [source, partner, target, reference]);
const received = () => rpc('list_received_maintenance_installations', [target]);
const accept = (id = installation, confirmed = true, grantId = grant.id) => rpc('accept_shared_maintenance_order', [grantId, id, confirmed]);
const setOptOut = (checked, id = installation, grantId = grant.id) => rpc('set_shared_maintenance_opt_out', [grantId, id, checked]);
async function sourceSnapshot() {
  const result = {};
  for (const table of ['customers', 'appointments', 'quotes', 'quote_items', 'work_reports', 'documents', 'inventory_stock', 'material_inventory']) {
    result[table] = (await db.query(`select to_jsonb(t) as row from public.${table} t where workspace_id=$1 order by to_jsonb(t)::text`, [source])).rows;
  }
  return result;
}

try {
  await db.exec(await readFile(new URL('./fixtures/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`
    create role service_role;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
    create table public.workspaces(id uuid primary key,name text,active boolean);
    create table public.workspace_settings(workspace_id uuid primary key,document_settings jsonb);
    alter table workspace_members add column role text not null default 'owner';
    alter table customers add column phone text,add column email text,add column postal_code text,add column city text,
      add column address text,add column source text,add column need text,add column notes text,add column created_by uuid,
      add column created_at timestamptz not null default now();
    alter table appointments add column maintenance_origin text not null default 'own',add column maintenance_source_name text,
      add column latitude double precision,add column longitude double precision,add column maintenance_opt_out boolean not null default false,
      add column maintenance_opt_out_at timestamptz;
    alter table work_reports add column signed_at timestamptz,add column privacy_notice jsonb,add column signer_name text;
    -- Match the fresh production metadata audit, not the older numeric fixture.
    alter table quote_items alter column quantity type integer,alter column unit_price type integer,alter column total_price type integer;
    alter table quotes alter column total_amount type integer;
    create table maintenance_appointment_items(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid,
      installation_appointment_id uuid references appointments(id),maintenance_appointment_id uuid references appointments(id));
    insert into auth.users values('${owner}',now(),null,null),('${partner}',now(),null,null),('${stranger}',now(),null,null),('${otherMember}',now(),null,null);
    insert into workspaces values('${source}','Source business',true),('${target}','Partner business',true);
    insert into workspace_members values('${source}','${stranger}',true,'member'),('${target}','${otherMember}',true,'member');
    update customers set phone='123456',email='customer@example.test',postal_code='1234',city='Test City',address='Test Street',
      notes='SECRET-INTERNAL-NOTE',need='SECRET-SALES-NEED' where id='${customer}';
    update appointments set status='Lezárva',scheduled_date=current_date-500,created_at=now()-interval '2 years',
      latitude=47,longitude=19 where id in('${installation}','${secondInstallation}');
    create table google_calendar_connections(workspace_id uuid primary key,sync_from timestamptz);
    create table google_calendar_sync_queue(workspace_id uuid,appointment_id uuid,appointment_deleted boolean,
      desired_version int not null default 1,next_attempt_at timestamptz,last_error text,updated_at timestamptz,
      primary key(workspace_id,appointment_id));
    insert into google_calendar_connections values('${target}',now()-interval '1 day');
  `);
  const calendarSql = await readFile(new URL('../docs/sql/GOOGLE_CALENDAR_SYNC.sql', import.meta.url), 'utf8');
  await db.exec(calendarSql.match(/create or replace function public\.enqueue_google_calendar_appointment[\s\S]*?\$enqueue\$;/)[0]);
  await db.exec(calendarSql.match(/create or replace function public\.queue_google_calendar_appointment_change[\s\S]*?\$appointment\$;/)[0]);
  await db.exec(`create trigger google_calendar_appointment_change after insert or update or delete on appointments
    for each row execute function queue_google_calendar_appointment_change();`);
  const config = { privacyNotice: { enabled: true, serviceProvider: { legalName: 'Partner EV', address: 'Test Address', email: 'partner@example.test' },
    retentionText: 'Test retention', recipientsText: 'Test recipients', internationalTransfersText: 'Test transfer terms' } };
  await db.query('insert into workspace_settings values($1,$2)', [target, config]);
  const before = await sourceSnapshot();
  const policiesBefore = (await db.query('select * from pg_policies order by tablename,policyname')).rows;
  const calendarMetadata = await scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='enqueue_google_calendar_appointment(uuid,uuid,timestamptz,boolean)'::regprocedure");

  await check('migration is idempotent, creates no grant, preserves source rows and existing RLS', async () => {
    await db.exec(migration); await db.exec(migration);
    await db.exec(historyMigration); await db.exec(historyMigration);
    await db.exec(optOutMigration); await db.exec(optOutMigration);
    assert.equal(await scalar('select count(*)::int from shared_maintenance_grants'), 0);
    assert.equal(await scalar('select count(*)::int from shared_maintenance_preferences'), 0);
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.shared_maintenance_preferences'::regclass"), true);
    assert.deepEqual(await sourceSnapshot(), before);
    assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows, policiesBefore);
    assert.deepEqual(await scalar("select to_jsonb(p)-'prosrc' from pg_proc p where oid='enqueue_google_calendar_appointment(uuid,uuid,timestamptz,boolean)'::regprocedure"), calendarMetadata);
  });
  await check('all new functions use a fixed search path; helpers and tables are inaccessible directly', async () => {
    const functions = (await db.query("select proname,proconfig,prosecdef from pg_proc where proname like '%shared_maintenance%' or proname like '%received_maintenance%'")).rows;
    assert.ok(functions.length >= 9);
    for (const fn of functions) { assert.equal(fn.prosecdef, true, fn.proname); assert.deepEqual(fn.proconfig, ['search_path=pg_catalog, pg_temp']); }
    for (const role of ['anon','authenticated','service_role']) {
      await actor(partner, role);
      await denied(db.query('select * from shared_maintenance_grants'));
      await denied(db.query('select * from shared_maintenance_preferences'));
      await denied(db.query('update shared_maintenance_preferences set maintenance_opt_out=false'));
      await denied(db.query('insert into shared_maintenance_events(grant_id,action,actor_id) values($1,$2,$3)', [randomUUID(),'granted',partner]));
      await denied(rpc('shared_maintenance_installation_rows', [target]));
      await denied(rpc('copy_shared_maintenance_opt_out', []));
      if (role !== 'authenticated') await denied(rpc('set_shared_maintenance_opt_out', [randomUUID(),installation,true]));
    }
    await actor(null, 'anon'); await denied(received()); await denied(grantAccess());
  });
  await check('source non-admin and foreign users cannot grant, revoke or list source grants', async () => {
    for (const user of [stranger, partner]) {
      await actor(user); await denied(grantAccess());
      await denied(rpc('list_shared_maintenance_grants', [source]));
      await denied(rpc('revoke_shared_maintenance_access', [randomUUID()]));
    }
  });
  await check('a real agreement reference and configured recipient privacy notice are required', async () => {
    await actor(owner); for (const ref of [null,'','  ','ab','line\nbreak']) await denied(grantAccess(ref), '22023');
    await db.exec('reset role'); await db.query('update workspace_settings set document_settings=$2 where workspace_id=$1', [target, {}]);
    await actor(owner); await denied(grantAccess(), '22023');
    await db.exec('reset role'); await db.query('update workspace_settings set document_settings=$2 where workspace_id=$1', [target, config]);
    await actor(owner); grant = await grantAccess();
    assert.equal(grant.scope, 'historical_installations'); assert.equal(grant.revokedAt, null);
    assert.equal((await rpc('list_shared_maintenance_grants', [source])).length, 1);
  });
  await check('recipient sees only explicit contact/device allowlist; tenant tables remain isolated', async () => {
    await actor(partner);
    const rows = await received(); assert.equal(rows.length, 3);
    const row = rows.find(item => item.installationId === installation);
    assert.deepEqual(row.climates, [{ productName: 'AC', quantity: 2 }]);
    assert.equal(row.customer.email, 'customer@example.test');
    assert.ok(!JSON.stringify(rows).includes('SECRET'));
    for (const forbidden of ['unit_price','total_price','customPrice','signature','notes','agreementReference','sourceCustomerId']) assert.ok(!JSON.stringify(rows).includes(forbidden), forbidden);
    assert.equal(await scalar('select count(*)::int from customers where workspace_id=$1', [source]), 0);
    await actor(otherMember); assert.deepEqual(await received(), [], 'same target workspace does not authorize another user');
    await actor(owner); await denied(received());
  });
  await check('opt-out, cancelled, external, future and newly imported after grant records are excluded', async () => {
    const mutations = [
      ['maintenance_opt_out=true','maintenance_opt_out=false'], ["status='Lemondva'","status='Lezárva'"],
      ["maintenance_origin='external'","maintenance_origin='own'"],
      ['scheduled_date=current_date+1','scheduled_date=current_date-500'],
      ["created_at=now()+interval '1 minute'","created_at=now()-interval '2 years'"],
    ];
    for (const [change, restore] of mutations) {
      await db.exec('reset role'); await db.query(`update appointments set ${change} where id=$1`, [installation]);
      await actor(partner); assert.ok(!(await received()).some(row => row.installationId === installation));
      await denied(accept());
      await denied(setOptOut(true));
      await db.exec('reset role'); await db.query(`update appointments set ${restore} where id=$1`, [installation]);
      if (change.startsWith('created_at=')) await db.query('update appointments set created_at=$2 where id=$1',
        [installation,before.appointments.find(item => item.row.id===installation).row.created_at]);
    }
  });
  await check('inactive/banned/deleted users and inactive source or target workspaces cannot receive data', async () => {
    const edits = [
      ["update workspace_members set active=false where user_id=$1","update workspace_members set active=true where user_id=$1",partner,true],
      ["update auth.users set banned_until=now()+interval '1 day' where id=$1","update auth.users set banned_until=null where id=$1",partner,true],
      ["update auth.users set deleted_at=now() where id=$1","update auth.users set deleted_at=null where id=$1",partner,true],
      ["update workspaces set active=false where id=$1","update workspaces set active=true where id=$1",target,true],
      ["update workspaces set active=false where id=$1","update workspaces set active=true where id=$1",source,false],
    ];
    for (const [edit, restore, id, reject] of edits) {
      await db.exec('reset role'); await db.query(edit, [id]); await actor(partner);
      if (reject) await denied(received()); else assert.deepEqual(await received(), []);
      await denied(accept());
      await denied(setOptOut(true));
      await db.exec('reset role'); await db.query(restore, [id]);
    }
  });
  await check('recipient opt-out stays visible, is reversible and changes no source or business records', async () => {
    await db.exec('reset role');
    const businessBefore = await sourceSnapshot();
    const targetBefore = (await db.query('select to_jsonb(a) as row from appointments a where workspace_id=$1 order by id',[target])).rows;
    const grantsBefore = await scalar('select count(*)::int from shared_maintenance_grants');
    for (const user of [stranger,otherMember,owner]) {
      await actor(user); await denied(setOptOut(true));
    }
    await actor(partner); await denied(setOptOut(null),'22023');
    await denied(setOptOut(true,randomUUID())); await denied(setOptOut(true,installation,randomUUID()));
    const initial=(await received()).find(row=>row.installationId===installation);
    assert.equal(initial.maintenanceOptOut,false); assert.equal(initial.maintenanceOptOutAt,null);
    const enabled=await setOptOut(true);
    assert.equal(enabled.maintenanceOptOut,true); assert.ok(enabled.maintenanceOptOutAt); assert.equal(enabled.targetInstallationId,null);
    assert.deepEqual(await setOptOut(true),enabled,'a repeated checkbox save preserves its opt-out time');
    const rows=await received(); assert.equal(rows.length,3);
    assert.equal(rows.find(row=>row.installationId===installation).maintenanceOptOut,true);
    assert.equal(rows.find(row=>row.installationId===secondInstallation).maintenanceOptOut,false,'preference is per installation');
    const disabled=await setOptOut(false);
    assert.deepEqual(disabled,{maintenanceOptOut:false,maintenanceOptOutAt:null,targetInstallationId:null});
    assert.equal((await received()).find(row=>row.installationId===installation).maintenanceOptOut,false);
    await setOptOut(true); // The next acceptance must retain this existing preference.
    await db.exec('reset role');
    assert.deepEqual(await sourceSnapshot(),businessBefore);
    assert.deepEqual((await db.query('select to_jsonb(a) as row from appointments a where workspace_id=$1 order by id',[target])).rows,targetBefore);
    assert.equal(await scalar('select count(*)::int from shared_maintenance_grants'),grantsBefore);
    assert.equal(await scalar('select count(*)::int from shared_maintenance_contacts'),0);
    assert.equal(await scalar('select count(*)::int from shared_maintenance_handoffs'),0);
    assert.equal(await scalar('select updated_by from shared_maintenance_preferences where source_installation_id=$1',[installation]),partner);
  });
  await check('own-service handoff requires explicit order, checks IDs and does not create contacts during browsing', async () => {
    await db.exec('reset role'); assert.equal(await scalar('select count(*)::int from shared_maintenance_handoffs'), 0);
    assert.equal(await scalar('select count(*)::int from customers where workspace_id=$1',[target]), 1);
    await actor(partner); await denied(accept(installation, false), '22023');
    await denied(accept(installation, null), '22023'); await denied(accept(randomUUID()));
    await denied(accept(installation, true, randomUUID()));
    await actor(otherMember); await denied(accept());
    await actor(partner); handoff = await accept();
    assert.equal(handoff.created, true); assert.notEqual(handoff.customerId, customer); assert.notEqual(handoff.installationId, installation);
  });
  await check('handoff is idempotent and copies only needed contact and zero-price identification snapshot', async () => {
    assert.deepEqual(await accept(), { ...handoff, created: false });
    const contact = (await db.query('select * from customers where id=$1',[handoff.customerId])).rows[0];
    assert.equal(contact.workspace_id,target); assert.equal(contact.notes,null); assert.equal(contact.need,null);
    assert.equal(contact.source,'Karbantartási átvétel');
    const mirror = (await db.query('select * from appointments where id=$1',[handoff.installationId])).rows[0];
    assert.equal(mirror.maintenance_origin,'external'); assert.equal(mirror.status,'Lezárva');
    assert.ok(new Date(mirror.created_at).valueOf() >= Date.now()-120000, 'actual creation time is not backdated');
    const items = (await db.query('select * from quote_items where quote_id=$1',[mirror.quote_id])).rows;
    assert.equal(items.length,1); assert.equal(Number(items[0].unit_price),0); assert.equal(Number(items[0].total_price),0);
    assert.equal(items[0].description,'|install_price=0');
    assert.equal(await scalar('select count(*)::int from work_reports where workspace_id=$1',[target]),0);
    assert.equal(await scalar('select count(*)::int from documents where workspace_id=$1',[target]),0);
    const second = await accept(secondInstallation); assert.equal(second.customerId,handoff.customerId);
    assert.notEqual(second.installationId,handoff.installationId);
    await db.exec('reset role'); assert.deepEqual(await sourceSnapshot(),before);
  });
  await check('historical references never enqueue Google Calendar; real subsequent maintenance does', async () => {
    assert.equal(await scalar('select count(*)::int from google_calendar_sync_queue where appointment_id=$1',[handoff.installationId]),0);
    const job = randomUUID();
    await db.query(`insert into appointments(id,workspace_id,customer_id,scheduled_date,scheduled_time,appointment_type,status)
      values($1,$2,$3,current_date,'10:00','maintenance','Időpont foglalva')`,[job,target,handoff.customerId]);
    assert.equal(await scalar('select count(*)::int from google_calendar_sync_queue where appointment_id=$1',[job]),1);
  });
  await check('acceptance preserves opt-out and the owned mirror then remains authoritative', async () => {
    await actor(partner);
    const inherited=(await received()).find(row=>row.installationId===installation);
    assert.equal(inherited.maintenanceOptOut,true); assert.ok(inherited.maintenanceOptOutAt);
    assert.equal(await scalar('select maintenance_opt_out from appointments where id=$1',[handoff.installationId]),true);
    await db.query('update appointments set maintenance_opt_out=false,maintenance_opt_out_at=null where id=$1',[handoff.installationId]);
    assert.equal((await received()).find(row=>row.installationId===installation).maintenanceOptOut,false,'ordinary own edits override the pre-acceptance preference');
    const enabled=await setOptOut(true);
    assert.equal(enabled.targetInstallationId,handoff.installationId);
    assert.equal(await scalar('select maintenance_opt_out from appointments where id=$1',[handoff.installationId]),true);
    await db.exec('reset role');
    const mirrorBefore=await scalar('select to_jsonb(a) from appointments a where id=$1',[handoff.installationId]);
    await db.exec(optOutMigration); await db.exec(optOutMigration);
    assert.deepEqual(await scalar('select to_jsonb(a) from appointments a where id=$1',[handoff.installationId]),mirrorBefore,'migration never rewrites an existing mirror');
    assert.deepEqual(await sourceSnapshot(),before);
    await actor(partner); const disabled=await setOptOut(false);
    assert.equal(disabled.maintenanceOptOutAt,null);
    assert.equal(await scalar('select maintenance_opt_out from appointments where id=$1',[handoff.installationId]),false);
    assert.equal((await received()).find(row=>row.installationId===installation).maintenanceOptOut,false);
    assert.deepEqual(await accept(),{...handoff,created:false});
    await db.exec('reset role');
  });
  await check('delegated completion requires the exact new signed notice; source receives only a narrow summary', async () => {
    const job = randomUUID(), report = randomUUID();
    await db.query(`insert into appointments(id,workspace_id,customer_id,scheduled_date,scheduled_time,appointment_type,status)
      values($1,$2,$3,current_date,'12:00','maintenance','Időpont foglalva')`,[job,target,handoff.customerId]);
    await db.query('insert into maintenance_appointment_items(workspace_id,customer_id,installation_appointment_id,maintenance_appointment_id) values($1,$2,$3,$4)',[target,handoff.customerId,handoff.installationId,job]);
    await denied(db.query("update appointments set status='Lezárva' where id=$1",[job]),'23514');
    await actor(owner); assert.deepEqual(await rpc('list_shared_maintenance_results',[source]),[]);
    await db.exec('reset role');
    const signature = 'data:image/png;base64,U0lHTkFUVVJF', signedAt = '2026-10-11T12:00:00.000Z';
    await db.query(`insert into work_reports(id,workspace_id,customer_id,appointment_id,appointment_type,signature_data_url,signed_at,privacy_notice,signer_name)
      values($1,$2,$3,$4,'maintenance',$5,$6,'{}','Minta ügyfél')`,[report,target,handoff.customerId,job,signature,signedAt]);
    await actor(owner); assert.deepEqual(await rpc('list_shared_maintenance_results',[source]),[], 'an empty/fabricated notice does not publish completion');
    await db.exec('reset role');
    const valid = {version:'2026-10-11.2',signatureDataUrl:signature,signedAt,signerName:'Minta ügyfél'};
    for (const patch of [{},{...valid,signatureDataUrl:'other'},{...valid,signedAt:'not-a-date'},
      {...valid,signedAt:'2026-10-10T12:00:00.000Z'},{...valid,signerName:'Másik név'},{...valid,version:'2026-10-11.1'}]) {
      await db.query('update work_reports set privacy_notice=$2 where id=$1',[report,patch]);
      await denied(db.query("update appointments set status='Lezárva' where id=$1",[job]),'23514');
    }
    await db.query('update work_reports set privacy_notice=$2 where id=$1',[report,valid]);
    await db.query('update work_reports set appointment_id=$2 where id=$1',[report,secondInstallation]);
    await denied(db.query("update appointments set status='Lezárva' where id=$1",[job]),'23514');
    await db.query('update work_reports set appointment_id=$2 where id=$1',[report,job]);
    await db.query("update appointments set status='Lezárva' where id=$1",[job]);
    await actor(owner); const results = await rpc('list_shared_maintenance_results',[source]);
    assert.equal(results.length,1); assert.equal(results[0].installationId,installation);
    assert.deepEqual(Object.keys(results[0]).sort(),['date','installationId','providerName','status']);
    assert.ok(!JSON.stringify(results).includes(signature));
    await actor(partner); await denied(rpc('list_shared_maintenance_results',[source]));
  });
  await check('new recipient receives prior signed partner history without counting its own work twice', async () => {
    await db.exec('reset role');
    const third = randomUUID();
    await db.query("insert into workspaces values($1,'Next maintenance provider',true)",[third]);
    await db.query("insert into workspace_members values($1,$2,true,'owner')",[third,stranger]);
    await db.query('insert into workspace_settings values($1,$2)',[third,config]);
    const ownJob=randomUUID();
    await db.query("insert into appointments(id,workspace_id,customer_id,scheduled_date,scheduled_time,appointment_type,status) values($1,$2,$3,current_date-20,'10:00','maintenance','Lezárva')",[ownJob,source,customer]);
    await db.query('insert into maintenance_appointment_items(workspace_id,customer_id,installation_appointment_id,maintenance_appointment_id) values($1,$2,$3,$4)',[source,customer,installation,ownJob]);
    const unchanged=await sourceSnapshot();
    await actor(owner);const thirdGrant=await rpc('grant_shared_maintenance_access',[source,stranger,third,'Written processor agreement NEXT-PROVIDER']);
    const thirdReceived=()=>rpc('list_received_maintenance_installations',[third]);
    await actor(stranger);
    const row=(await thirdReceived()).find(value=>value.installationId===installation);
    assert.equal(row.maintenanceCount,2);assert.equal(row.lastMaintenanceProviderName,'Partner business');
    assert.equal(row.lastMaintenanceDate,await scalar('select current_date::text'));
    assert.ok(!JSON.stringify(row).includes('signatureDataUrl'));
    assert.equal(row.maintenanceOptOut,false);
    await rpc('set_shared_maintenance_opt_out',[thirdGrant.id,installation,true]);
    assert.equal((await thirdReceived()).find(value=>value.installationId===installation).maintenanceOptOut,true);
    await actor(partner);
    const recipientOwn=(await received()).find(value=>value.installationId===installation);
    assert.equal(recipientOwn.maintenanceOptOut,false,'another recipient workspace has an independent preference');
    assert.equal(recipientOwn.maintenanceCount,1,'recipient own completed work is merged locally exactly once');
    assert.equal(recipientOwn.lastMaintenanceProviderName,'Source business');
    assert.equal(recipientOwn.lastMaintenanceDate,await scalar('select (current_date-20)::text'));
    await db.exec('reset role');assert.deepEqual(await sourceSnapshot(),unchanged);
    const completed=(await db.query("select ma.id,wr.id report_id from appointments ma join work_reports wr on wr.appointment_id=ma.id where ma.workspace_id=$1 and ma.status='Lezárva' and ma.appointment_type='maintenance'",[target])).rows[0];
    const notice=await scalar('select privacy_notice from work_reports where id=$1',[completed.report_id]);
    for(const [edit,restore] of [
      ["update appointments set scheduled_date=current_date+1 where id=$1","update appointments set scheduled_date=current_date where id=$1"],
      ["update appointments set status='Lemondva' where id=$1","update appointments set status='Lezárva' where id=$1"],
      ["update appointments set cancelled_at=now() where id=$1","update appointments set cancelled_at=null where id=$1"],
    ]) {
      await db.query(edit,[completed.id]);await actor(stranger);
      const filtered=(await thirdReceived()).find(value=>value.installationId===installation);
      assert.equal(filtered.maintenanceCount,1);assert.equal(filtered.lastMaintenanceProviderName,'Source business');
      await db.exec('reset role');await db.query(restore,[completed.id]);
    }
    await db.query("update work_reports set privacy_notice='{}' where id=$1",[completed.report_id]);
    await actor(stranger);assert.equal((await thirdReceived()).find(value=>value.installationId===installation).maintenanceCount,1,'unsigned partner work never advances received due dates');
    await db.exec('reset role');await db.query('update work_reports set privacy_notice=$2 where id=$1',[completed.report_id,notice]);
    await db.query('update work_reports set customer_id=$2 where id=$1',[completed.report_id,customer]);
    await actor(stranger);assert.equal((await thirdReceived()).find(value=>value.installationId===installation).maintenanceCount,1,'notice must match provider customer as well as work');
    await db.exec('reset role');await db.query('update work_reports set customer_id=$2 where id=$1',[completed.report_id,handoff.customerId]);
    await actor(owner);await rpc('revoke_shared_maintenance_access',[thirdGrant.id]);
    await actor(stranger);assert.deepEqual(await thirdReceived(),[],'revocation removes both contact and new history summary');
    await denied(rpc('set_shared_maintenance_opt_out',[thirdGrant.id,installation,false]));
    await db.exec('reset role');
  });
  await check('late-link and wrong-customer/workspace bypasses fail; ordinary own maintenance stays compatible', async () => {
    await db.exec('reset role');
    const job=randomUUID(), foreignCustomer='20000000-0000-0000-0000-000000000002';
    await db.query(`insert into appointments(id,workspace_id,customer_id,scheduled_date,scheduled_time,appointment_type,status)
      values($1,$2,$3,current_date,'14:00','maintenance','Lezárva')`,[job,target,handoff.customerId]);
    const link=(workspaceId=target,customerId=handoff.customerId)=>db.query('insert into maintenance_appointment_items(workspace_id,customer_id,installation_appointment_id,maintenance_appointment_id) values($1,$2,$3,$4)',[workspaceId,customerId,handoff.installationId,job]);
    await denied(link(),'23514');
    await db.query("update appointments set status='Időpont foglalva' where id=$1",[job]);
    await denied(link(target,foreignCustomer),'23514'); await denied(link(source),'23514');
    await link();
    await db.query('delete from maintenance_appointment_items where maintenance_appointment_id=$1',[job]);
    await denied(db.query("update appointments set status='Lezárva' where id=$1",[job]),'23514');
    await link();
    await db.query("update workspace_settings set document_settings='{}' where workspace_id=$1",[target]);
    await denied(db.query("update appointments set status='Lezárva' where id=$1",[job]),'23514');
    await db.query('update workspace_settings set document_settings=$2 where workspace_id=$1',[target,config]);
  });
  await check('handoff reuse fails closed when local customer/installation scope has been changed', async () => {
    await db.exec('reset role');
    await db.query('update appointments set workspace_id=$2 where id=$1',[handoff.installationId,source]);
    await actor(partner); await denied(accept(),'23514');
    await denied(setOptOut(true),'23514');
    await db.exec('reset role');
    await db.query('update appointments set workspace_id=$2 where id=$1',[handoff.installationId,target]);
  });
  await check('mutable origin labels cannot turn a delegated reference into an onward processor grant',async()=>{
    await db.exec('reset role');
    await db.query('insert into workspace_settings values($1,$2)',[source,config]);
    await db.query("update appointments set maintenance_origin='own',maintenance_source_name=null where id=$1",[handoff.installationId]);
    await actor(partner);
    await rpc('grant_shared_maintenance_access',[target,owner,source,'Separate real written agreement TEST-2']);
    await actor(owner);assert.deepEqual(await rpc('list_received_maintenance_installations',[source]),[]);
    await db.exec('reset role');
    await db.query("update appointments set maintenance_origin='external',maintenance_source_name='Source business' where id=$1",[handoff.installationId]);
  });
  await check('revocation immediately stops browse and handoff; prior independent service records survive', async () => {
    await actor(owner); const revoked = await rpc('revoke_shared_maintenance_access',[grant.id]); assert.ok(revoked.revokedAt);
    assert.deepEqual(await rpc('revoke_shared_maintenance_access',[grant.id]),revoked);
    await actor(partner); assert.deepEqual(await received(),[]); await denied(accept());
    await denied(setOptOut(true));
    assert.equal(await scalar('select count(*)::int from customers where id=$1',[handoff.customerId]),1);
    assert.equal(await scalar('select count(*)::int from appointments where id=$1',[handoff.installationId]),1);
    await db.exec('reset role');
    assert.equal(await scalar("select count(*)::int from shared_maintenance_events where action='revoked'"),2);
    assert.equal(await scalar("select count(*)::int from shared_maintenance_events where action='order_accepted'"),2);
  });
  await check('read-only opt-out postflight returns passing schema and permission flags without identities', async () => {
    const verification=await readFile(new URL('../docs/sql/VERIFY_20261027_SHARED_MAINTENANCE_OPT_OUT.sql',import.meta.url),'utf8');
    const rows=(await db.exec(verification)).flatMap(result=>result.rows);
    assert.ok(rows.some(row=>row.preference_rows!==undefined));
    for (const row of rows) {
      for (const [key,value] of Object.entries(row)) {
        if (typeof value==='boolean') assert.equal(value,true,key);
        assert.ok(!['customer_id','workspace_id','user_id','installation_id','grant_id'].includes(key));
      }
      if (row.inconsistent_timestamp_rows!==undefined) assert.equal(Number(row.inconsistent_timestamp_rows),0);
    }
  });
  console.log(`Completed ${passed} shared-maintenance PostgreSQL checks.`);
} finally { await db.close(); }
