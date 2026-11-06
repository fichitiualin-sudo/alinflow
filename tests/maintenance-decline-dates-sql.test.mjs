import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Isolated real PostgreSQL, synthetic rows only. Never connects to Supabase.
const require=createRequire(import.meta.url);
const {PGlite}=process.env.PGLITE_MODULE_PATH?require(process.env.PGLITE_MODULE_PATH)
  :createRequire(new URL('../.photo-test/package.json',import.meta.url))('@electric-sql/pglite');
const db=new PGlite();
const sql=name=>readFile(new URL(`../docs/sql/${name}`,import.meta.url),'utf8');
const source='10000000-0000-0000-0000-000000000001',target='10000000-0000-0000-0000-000000000002';
const owner='90000000-0000-0000-0000-000000000001',partner='90000000-0000-0000-0000-000000000002';
const installation='40000000-0000-0000-0000-000000000001',excluded='40000000-0000-0000-0000-000000000002';
const unaccepted='40000000-0000-0000-0000-000000000003',survey='40000000-0000-0000-0000-000000000004';
const customer='20000000-0000-0000-0000-000000000001',own=randomUUID(),manual=randomUUID(),otherMember=randomUUID(),outsider=randomUUID();
const scalar=async(query,args=[])=>Object.values((await db.query(query,args)).rows[0])[0];
const rpc=(name,args)=>scalar(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args);
const list=ws=>rpc('list_maintenance_contact_preferences',[ws]);
const get=async(ws,id)=>(await list(ws)).find(p=>p.installationId===id);
const whole=(ws,id,choice,version=null,grant=null)=>rpc('set_maintenance_contact_preference',[ws,id,choice,version,grant]);
const device=(unitNumber,productName='AC')=>({productName,unitNumber});
const toggle=(ws,id,unit,declined,version=null,grant=null)=>rpc('set_maintenance_device_preference',[ws,id,JSON.stringify(typeof unit==='number'?device(unit):unit),declined,version,grant]);
const denied=(promise,code='42501')=>assert.rejects(promise,error=>error.code===code);
async function actor(id=owner,role='authenticated') {
  await db.exec(`reset role;set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);
}
let passed=0,grant,mirror;
async function check(label,fn){await fn();passed++;console.log(`PASS ${label}`);}
async function snapshot(tables){await db.exec('reset role');return Object.fromEntries(await Promise.all(tables.map(async table=>
  [table,(await db.query(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`)).rows])));}
try {
  await db.exec(await readFile(new URL('./fixtures/schema.sql',import.meta.url),'utf8'));
  await db.exec(`
    create role service_role;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
    create table workspaces(id uuid primary key,name text,active boolean);
    create table workspace_settings(workspace_id uuid primary key,document_settings jsonb);
    alter table workspace_members add column role text not null default 'owner';
    alter table customers add column phone text,add column email text,add column postal_code text,add column city text,
      add column address text,add column source text,add column need text,add column notes text,add column created_by uuid,
      add column created_at timestamptz not null default now();
    alter table appointments add column maintenance_origin text not null default 'own',add column maintenance_source_name text,
      add column latitude double precision,add column longitude double precision,add column maintenance_opt_out boolean not null default false,
      add column maintenance_opt_out_at timestamptz;
    alter table work_reports add column signed_at timestamptz,add column privacy_notice jsonb,add column signer_name text;
    alter table quote_items alter column quantity type integer,alter column unit_price type integer,alter column total_price type integer;
    alter table quotes alter column total_amount type integer;
    create table maintenance_appointment_items(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid,
      installation_appointment_id uuid references appointments(id),maintenance_appointment_id uuid references appointments(id));
    insert into auth.users values('${owner}',now(),null,null),('${partner}',now(),null,null),('${otherMember}',now(),null,null),('${outsider}',now(),null,null);
    insert into workspaces values('${source}','Source business',true),('${target}','Partner business',true);
    insert into workspace_members values('${target}','${otherMember}',true,'member');
    insert into appointments(id,workspace_id,customer_id,appointment_type,status,maintenance_origin,scheduled_date,created_at)
      values('${own}','${source}','${customer}','installation','Lezárva','own',current_date-500,now()-interval '2 years'),
      ('${manual}','${source}','${customer}','installation','Lezárva','external',current_date-500,now()-interval '2 years');
    update appointments set status='Lezárva',scheduled_date=current_date-500,created_at=now()-interval '2 years' where appointment_type='installation';
    update quote_items set quantity=4;
    insert into quote_items(workspace_id,quote_id,product_name,description,quantity,unit_price,total_price)
      values('${source}','30000000-0000-0000-0000-000000000001','Pipe','|item_type=extra',10,100,1000);
  `);
  for(const id of [unaccepted,own,manual]){
    const quote=randomUUID();
    await db.query('insert into quotes(id,workspace_id,customer_id,appointment_id) values($1,$2,$3,$4)',[quote,source,customer,id]);
    await db.query('update appointments set quote_id=$1 where id=$2',[quote,id]);
    await db.query("insert into quote_items(workspace_id,quote_id,product_name,description,quantity,unit_price,total_price) values($1,$2,'AC','ac|install_price=0',2,100,200),($1,$2,'AC','ac|install_price=0',2,100,200)",[source,quote]);
  }
  const config={privacyNotice:{enabled:true,serviceProvider:{legalName:'Synthetic Partner',address:'Synthetic Address',email:'partner@example.test'},retentionText:'Test',recipientsText:'Test',internationalTransfersText:'Test'}};
  await db.query('insert into workspace_settings values($1,$2)',[target,config]);
  for(const file of ['20261011_SHARED_MAINTENANCE_ACCESS.sql','20261012_SHARED_MAINTENANCE_HISTORY.sql','20261016_EXTRA_ITEMS_SHARED_MAINTENANCE.sql','20261027_SHARED_MAINTENANCE_OPT_OUT.sql','20261029_MAINTENANCE_CONTACT_CHOICE.sql']) await db.exec(await sql(file));
  // This migration depends only on these two private unit helpers from the
  // separately tested partial-maintenance migration, not on any history write.
  const partial=await sql('20261106_PARTIAL_MAINTENANCE.sql');
  for(const name of ['normalize_maintenance_device_selection','validate_maintenance_device_selection'])
    await db.exec(partial.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`))[0]);
  await db.exec('revoke all on function validate_maintenance_device_selection(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role');

  await db.exec(await sql('20261106_MAINTENANCE_DEVICE_PREFERENCES.sql'));
  if(process.env.DECLINE_DATES_PREFLIGHT_PATH){
    const exported=await readFile(process.env.DECLINE_DATES_PREFLIGHT_PATH,'utf8');
    const definitions=exported.match(/CREATE OR REPLACE FUNCTION public\.(?:list_maintenance_contact_preferences|set_maintenance_contact_preference|set_maintenance_device_preference)\([\s\S]*?AS \$function\$[\s\S]*?\$function\$/g);
    assert.equal(definitions?.length,3);
    for(const definition of definitions)await db.exec(definition+';');
  }
  await actor();grant=await rpc('grant_shared_maintenance_access',[source,partner,target,'Synthetic signed agreement']);
  await whole(source,installation,'declined');
  await toggle(source,own,1,true);
  await actor(partner);await rpc('set_shared_maintenance_opt_out',[grant.id,unaccepted,true]);
  mirror=await rpc('accept_shared_maintenance_order',[grant.id,installation,true]);
  await db.exec('reset role');
  await db.query("update appointments set maintenance_opt_out=true,maintenance_opt_out_at='2025-01-01T12:00:00Z' where id=$1",[excluded]);
  await db.exec("update maintenance_contact_preferences set updated_at='2025-02-03T12:00:00Z'");
  const immutable=['customers','quotes','quote_items','work_reports','documents','work_checklists','inventory_stock','material_inventory','maintenance_appointment_items','shared_maintenance_grants','shared_maintenance_contacts','shared_maintenance_handoffs','shared_maintenance_preferences','shared_maintenance_events'];
  let before=await snapshot(immutable);
  const appointmentRows=(await db.query("select to_jsonb(a)-'maintenance_opt_out'-'maintenance_opt_out_at' row from appointments a order by id")).rows;
  const oldPreferences=(await db.query('select to_jsonb(p) row from maintenance_contact_preferences p order by source_installation_id')).rows;
  const policies=(await db.query('select * from pg_policies order by tablename,policyname')).rows;
  const metadataQuery="select to_jsonb(p)-'prosrc' from pg_proc p where proname in('list_maintenance_contact_preferences','set_maintenance_contact_preference','set_maintenance_device_preference') order by proname";
  const metadata=(await db.query(metadataQuery)).rows;
  const migration=await sql('20261106_MAINTENANCE_DECLINE_DATES.sql');
  const dateFor=(p,n)=>p.declinedDeviceDates?.find(d=>d.unitNumber===n&&d.productName==='AC')?.declinedAt;
  const dateMap=p=>Object.fromEntries((p.declinedDeviceDates||[]).map(d=>[d.unitNumber,d.declinedAt]));
  const current=async id=>get(source,id);
  await check('migration runs twice without backfilling dates or changing old data, ACL and metadata',async()=>{
    await db.exec(migration);await db.exec(migration);
    assert.deepEqual(await snapshot(immutable),before);
    assert.deepEqual((await db.query("select to_jsonb(p)-'declined_at'-'declined_device_dates' row from maintenance_contact_preferences p order by source_installation_id")).rows,oldPreferences);
    assert.deepEqual((await db.query(metadataQuery)).rows,metadata);
    assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows,policies);
    assert.equal(await scalar('select count(*)::int from maintenance_contact_preferences where declined_at is not null or declined_device_dates is not null'),0);
  });
  await check('a newly refused device gets server time and a repeated checked save preserves its exact date',async()=>{
    await actor();const started=Date.now();
    let p=await toggle(source,manual,1,true);
    assert.equal(p.declinedAt,null);assert.ok(Date.parse(dateFor(p,1))>=started-1000);
    assert.ok(Date.parse(dateFor(p,1))<=Date.now()+1000);
    const first=dateFor(p,1),version=p.updatedAt;
    p=await toggle(source,manual,device(1,' ac '),true,p.updatedAt);
    assert.equal(dateFor(p,1),first);assert.notEqual(p.updatedAt,version);
    assert.deepEqual(p.declinedDeviceDates,[{...device(1),declinedAt:first}]);
    assert.deepEqual(await current(manual),p);
  });
  await check('toggling other devices and normalization to whole decline preserves every earlier device date',async()=>{
    let p=await current(manual);const first=dateFor(p,1);
    p=await toggle(source,manual,2,true,p.updatedAt);const second=dateFor(p,2);
    assert.equal(dateFor(p,1),first);assert.notEqual(second,first);
    p=await toggle(source,manual,3,true,p.updatedAt);const third=dateFor(p,3);
    p=await toggle(source,manual,4,true,p.updatedAt);
    assert.equal(p.choice,'declined');assert.equal(p.declinedDevices,null);assert.ok(p.declinedAt);
    assert.equal(dateFor(p,1),first);assert.equal(dateFor(p,2),second);assert.equal(dateFor(p,3),third);
    assert.equal(p.declinedDeviceDates.length,4);assert.equal(dateFor(p,4),p.declinedAt);
    const allDates=dateMap(p),wholeDate=p.declinedAt;
    p=await whole(source,manual,'declined',p.updatedAt);
    assert.deepEqual(dateMap(p),allDates);assert.equal(p.declinedAt,wholeDate);
  });
  await check('unchecking and rechecking one unit changes only its active date',async()=>{
    let p=await current(manual);const allDates=dateMap(p),first=p.declinedAt;
    p=await toggle(source,manual,2,false,p.updatedAt);
    assert.equal(p.choice,'open');assert.equal(p.declinedAt,null);assert.equal(dateFor(p,2),undefined);
    for(const n of [1,3,4])assert.equal(dateFor(p,n),allDates[n]);
    p=await toggle(source,manual,2,true,p.updatedAt);
    assert.equal(p.choice,'declined');assert.notEqual(dateFor(p,2),allDates[2]);assert.notEqual(p.declinedAt,first);
    for(const n of [1,3,4])assert.equal(dateFor(p,n),allDates[n]);
  });
  await check('whole controls clear active refusals then stamp new ones without replacing existing subset dates',async()=>{
    let p=await current(manual);
    p=await whole(source,manual,'open',p.updatedAt);
    assert.equal(p.declinedAt,null);assert.equal(p.declinedDeviceDates,null);
    p=await toggle(source,manual,3,true,p.updatedAt);const prior=dateFor(p,3);
    p=await whole(source,manual,'declined',p.updatedAt);
    assert.equal(dateFor(p,3),prior);
    for(const n of [1,2,4])assert.equal(dateFor(p,n),p.declinedAt);
    assert.notEqual(p.declinedAt,prior);
    const allDates=dateMap(p),marked=p.declinedAt;
    p=await whole(source,manual,'declined',p.updatedAt);
    assert.deepEqual(dateMap(p),allDates);assert.equal(p.declinedAt,marked);
  });
  await check('old partial refusal dates stay unknown when new refusals produce a whole decline',async()=>{
    let p=await current(own);
    assert.equal(p.declinedAt,null);assert.equal(p.declinedDeviceDates,null);
    p=await toggle(source,own,2,true,p.updatedAt);
    const second=dateFor(p,2);assert.ok(second);assert.equal(dateFor(p,1),undefined);
    p=await whole(source,own,'declined',p.updatedAt);
    assert.equal(p.choice,'declined');assert.ok(p.declinedAt);
    assert.equal(dateFor(p,1),undefined);assert.equal(dateFor(p,2),second);
    assert.equal(p.declinedDeviceDates.length,3);
    const before=dateMap(p);p=await whole(source,own,'declined',p.updatedAt);
    assert.deepEqual(dateMap(p),before);assert.equal(dateFor(p,1),undefined);
  });
  await check('old explicit whole refusal does not use row updatedAt and only a newly rechecked unit gets a date',async()=>{
    let p=await current(installation);assert.equal(p.declinedAt,null);assert.equal(p.declinedDeviceDates,null);
    p=await whole(source,installation,'declined',p.updatedAt);
    assert.equal(p.declinedAt,null);assert.equal(p.declinedDeviceDates,null);
    p=await toggle(source,installation,1,false,p.updatedAt);
    assert.equal(p.declinedDeviceDates,null);
    p=await toggle(source,installation,1,true,p.updatedAt);
    assert.ok(p.declinedAt);assert.deepEqual(p.declinedDeviceDates,[{...device(1),declinedAt:p.declinedAt}]);
    assert.ok(!JSON.stringify(p.declinedDeviceDates).includes('2025-02-03'));
  });
  await check('legacy source flags remain undated rather than being silently relabelled as today',async()=>{
    let p=await toggle(source,excluded,1,false);
    assert.equal(p.declinedAt,null);assert.equal(p.declinedDeviceDates,null);
    p=await toggle(source,excluded,1,true,p.updatedAt);
    assert.equal(p.declinedDeviceDates.length,1);assert.equal(dateFor(p,1),p.declinedAt);
    assert.ok(!JSON.stringify(p.declinedDeviceDates).includes('2025-01-01'));
  });
  await check('partner and original installer see identical dates; contact-only legacy dates survive acceptance as unknown',async()=>{
    await actor(partner);
    let p=await get(target,mirror.installationId),prior=dateFor(p,1);
    p=await toggle(target,mirror.installationId,2,false,p.updatedAt);
    assert.equal(dateFor(p,1),prior);
    p=await toggle(target,mirror.installationId,2,true,p.updatedAt);
    await actor();assert.deepEqual((await current(installation)).declinedDeviceDates,p.declinedDeviceDates);
    await actor(partner);p=await toggle(target,unaccepted,1,false,null,grant.id);
    assert.equal(p.declinedDeviceDates,null);
    p=await toggle(target,unaccepted,1,true,p.updatedAt,grant.id);const dated=p.declinedDeviceDates;
    assert.equal(dated.length,1);
    assert.deepEqual(await snapshot(immutable),before);await actor(partner);
    const accepted=await rpc('accept_shared_maintenance_order',[grant.id,unaccepted,true]);
    before=await snapshot(immutable);await actor(partner);
    const received=await get(target,accepted.installationId);
    assert.deepEqual(received.declinedDeviceDates,dated);assert.equal(received.declinedAt,p.declinedAt);
  });
  await check('concurrent stale saves and denied actors cannot alter dates or clear other devices',async()=>{
    await actor();let p=await current(manual);const stale=p.updatedAt;
    p=await toggle(source,manual,1,false,p.updatedAt);
    await denied(toggle(source,manual,2,false,stale),'40001');
    await denied(whole(source,manual,'open',stale),'40001');
    await denied(toggle(source,manual,device(1,'Pipe'),true,p.updatedAt),'23514');
    assert.deepEqual(await current(manual),p);
    await denied(db.query('update maintenance_contact_preferences set declined_at=now()'),'42501');
    await denied(db.query('select record_maintenance_decline_dates()'),'42501');
    for(const role of ['anon','service_role']){await actor(null,role);await denied(toggle(source,manual,1,true,p.updatedAt));}
    await actor(otherMember);await denied(toggle(target,installation,1,true,null,grant.id));
    await actor();assert.deepEqual(await current(manual),p);
  });
  await check('whole refusal still works without a recorded device list',async()=>{
    const unknown=randomUUID();
    await db.query("insert into appointments(id,workspace_id,customer_id,appointment_type,status) values($1,$2,$3,'installation','Lezárva')",[unknown,source,customer]);
    let p=await whole(source,unknown,'declined');assert.ok(p.declinedAt);assert.equal(p.declinedDeviceDates,null);
    const marked=p.declinedAt;p=await whole(source,unknown,'declined',p.updatedAt);assert.equal(p.declinedAt,marked);
    p=await whole(source,unknown,'open',p.updatedAt);assert.equal(p.declinedAt,null);
  });
  await check('postflight confirms private trigger and original dates, histories, documents, RLS and ACL remain intact',async()=>{
    assert.deepEqual(await snapshot(immutable),before);
    for(const old of appointmentRows){
      const now=await scalar("select to_jsonb(a)-'maintenance_opt_out'-'maintenance_opt_out_at' from appointments a where id=$1",[old.row.id]);
      assert.deepEqual(now,old.row);
    }
    assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows,policies);
    assert.deepEqual((await db.query(metadataQuery)).rows,metadata);
    await db.exec(await sql('VERIFY_20261106_MAINTENANCE_DECLINE_DATES.sql'));
  });
  console.log(passed+' maintenance-decline-date SQL checks passed.');
} finally{await db.close();}

