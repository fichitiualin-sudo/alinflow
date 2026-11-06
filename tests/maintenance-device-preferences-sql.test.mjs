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
  if(process.env.DEVICE_PREFERENCES_PREFLIGHT_PATH){
    const exported=await readFile(process.env.DEVICE_PREFERENCES_PREFLIGHT_PATH,'utf8');
    const definitions=exported.match(/CREATE OR REPLACE FUNCTION public\.(?:list_maintenance_contact_preferences|set_maintenance_contact_preference)\([\s\S]*?AS \$function\$[\s\S]*?\$function\$/g);
    assert.equal(definitions?.length,2);
    for(const definition of definitions) await db.exec(`${definition};`);
  }
  await actor();grant=await rpc('grant_shared_maintenance_access',[source,partner,target,'Synthetic signed agreement']);
  await actor(partner);await rpc('set_shared_maintenance_opt_out',[grant.id,installation,true]);
  mirror=await rpc('accept_shared_maintenance_order',[grant.id,installation,true]);
  await rpc('set_shared_maintenance_opt_out',[grant.id,unaccepted,true]);
  await db.exec('reset role');await db.query('update appointments set maintenance_opt_out=true,maintenance_opt_out_at=now() where id=$1',[excluded]);
  const immutable=['customers','quotes','quote_items','work_reports','documents','work_checklists','inventory_stock','material_inventory','maintenance_appointment_items','shared_maintenance_grants','shared_maintenance_contacts','shared_maintenance_handoffs','shared_maintenance_preferences','shared_maintenance_events'];
  let before=await snapshot(immutable);
  const appointmentsBefore=(await db.query("select to_jsonb(a)-'maintenance_opt_out'-'maintenance_opt_out_at' as row from appointments a order by id")).rows;
  const policies=(await db.query('select * from pg_policies order by tablename,policyname')).rows;
  const metadataQuery="select to_jsonb(p)-'prosrc' from pg_proc p where proname in('list_maintenance_contact_preferences','set_maintenance_contact_preference') order by proname";
  const metadata=(await db.query(metadataQuery)).rows;
  const migration=await sql('20261106_MAINTENANCE_DEVICE_PREFERENCES.sql');
  await check('migration is repeatable without migrating legacy choices, widening ACL, or touching business records',async()=>{
    await db.exec(migration);await db.exec(migration);
    assert.deepEqual(await snapshot(immutable),before);
    assert.deepEqual((await db.query(metadataQuery)).rows,metadata);
    assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows,policies);
    assert.equal(await scalar('select count(*)::int from maintenance_contact_preferences'),0);
  });
  await check('one of four can be declined with cumulative numbering; all and none normalize to existing whole choices',async()=>{
    await actor();let p=await toggle(source,own,4,true);
    assert.equal(p.choice,'open');assert.deepEqual(p.declinedDevices,[device(4)]);
    for(const n of [1,2,3])p=await toggle(source,own,n,true,p.updatedAt);
    assert.equal(p.choice,'declined');assert.equal(p.declinedDevices,null);
    p=await toggle(source,own,1,false,p.updatedAt);
    assert.equal(p.choice,'open');assert.deepEqual(p.declinedDevices,[device(2),device(3),device(4)]);
    for(const n of [2,3,4])p=await toggle(source,own,n,false,p.updatedAt);
    assert.equal(p.choice,'open');assert.equal(p.declinedDevices,null);
    assert.deepEqual(await get(source,own),p);
  });
  await check('legacy source whole-decline expands safely when reopening one unit and only source can reopen excluded rows',async()=>{
    await actor(partner);await denied(toggle(target,excluded,1,false,null,grant.id));
    await actor();const p=await toggle(source,excluded,1,false);
    assert.equal(p.choice,'open');assert.deepEqual(p.declinedDevices,[device(2),device(3),device(4)]);
    assert.equal(await scalar('select maintenance_opt_out from appointments where id=$1',[excluded]),false);
    assert.equal(await scalar('select maintenance_opt_out_at from appointments where id=$1',[excluded]),null);
  });
  await check('accepted partner mirrors use exact provenance, inherit their legacy choice and expose the same source preference',async()=>{
    await actor(partner);const p=await toggle(target,mirror.installationId,2,false);
    assert.equal(p.installationId,mirror.installationId);assert.equal(p.sourceInstallationId,installation);assert.equal(p.isSource,false);
    assert.deepEqual(p.declinedDevices,[device(1),device(3),device(4)]);
    await actor();const local=await get(source,installation);
    assert.deepEqual(local.declinedDevices,p.declinedDevices);assert.equal(local.updatedAt,p.updatedAt);
    // Recipient legacy state is preserved; explicit global decision now wins.
    await actor(partner);assert.equal(await scalar('select maintenance_opt_out from appointments where id=$1',[mirror.installationId]),true);
  });
  await check('contact-only partner choice survives acceptance and new mirror identity without duplicating preference rows',async()=>{
    await actor(partner);const p=await toggle(target,unaccepted,3,false,null,grant.id);
    assert.deepEqual(p.declinedDevices,[device(1),device(2),device(4)]);
    assert.deepEqual(await snapshot(immutable),before);await actor(partner);
    const accepted=await rpc('accept_shared_maintenance_order',[grant.id,unaccepted,true]);
    const received=await get(target,accepted.installationId);
    assert.equal(received.updatedAt,p.updatedAt);assert.deepEqual(received.declinedDevices,p.declinedDevices);
    // Acceptance is an intentional existing operation, separate from the new
    // preference write. Freeze its expected new customer/quote/handoff rows.
    before=await snapshot(immutable);await actor(partner);
    await denied(toggle(target,unaccepted,2,false,p.updatedAt),'42501');
    const updated=await toggle(target,accepted.installationId,2,false,p.updatedAt);
    assert.deepEqual(updated.declinedDevices,[device(1),device(4)]);
  });
  await check('old whole-choice API explicitly clears partial preferences and shares the same concurrency token',async()=>{
    await actor();let p=await get(source,own);
    p=await toggle(source,own,1,true,p.updatedAt);const stale=p.updatedAt;
    p=await whole(source,own,'declined',p.updatedAt);
    assert.equal(p.declinedDevices,null);assert.equal(p.choice,'declined');
    await denied(toggle(source,own,1,false,stale),'40001');
    p=await toggle(source,own,1,false,p.updatedAt);
    await denied(whole(source,own,'open',stale),'40001');
    p=await whole(source,own,'open',p.updatedAt);
    assert.equal(p.declinedDevices,null);assert.equal(p.choice,'open');
  });
  await check('invalid, extra, missing and cross-scope units are rejected without partial writes',async()=>{
    await actor();const p=await get(source,installation);
    for(const invalid of [device(5),device(1,'Pipe'),device(1,'Unknown')])await denied(toggle(source,installation,invalid,true,p.updatedAt),'23514');
    for(const invalid of [device(0),device(1.5),{...device(1),price:9},device('1')])await denied(toggle(source,installation,invalid,true,p.updatedAt),'22023');
    await denied(toggle(source,installation,1,null,p.updatedAt),'22023');
    await denied(toggle(source,survey,1,true),'42501');
    await denied(toggle(target,own,1,true),'42501');
    assert.deepEqual(await get(source,installation),p);
  });
  await check('unchanged ACL rejects anonymous, server, foreign member, revoked grant and relabelled mirror writes',async()=>{
    for(const role of ['anon','service_role']){await actor(null,role);await denied(toggle(source,own,1,true));}
    for(const id of [otherMember,outsider]){await actor(id);await denied(toggle(target,installation,1,true,null,grant.id));}
    await actor(partner);const p=await get(target,mirror.installationId);
    await denied(db.query('update maintenance_contact_preferences set declined_devices=null'),'42501');
    await db.exec('reset role');await db.query('update shared_maintenance_grants set revoked_at=now(),revoked_by=$2 where id=$1',[grant.id,owner]);
    await actor(partner);await denied(toggle(target,mirror.installationId,1,false,p.updatedAt));
    await db.exec('reset role');await db.query('update shared_maintenance_grants set revoked_at=null,revoked_by=null where id=$1',[grant.id]);
    await db.query('update workspace_members set active=false where workspace_id=$1 and user_id=$2',[target,partner]);
    await actor(partner);await denied(toggle(target,mirror.installationId,1,false,p.updatedAt));
    await db.exec('reset role');await db.query('update workspace_members set active=true where workspace_id=$1 and user_id=$2',[target,partner]);
    await db.query("update appointments set maintenance_origin='own' where id=$1",[mirror.installationId]);
    await actor(partner);await denied(toggle(target,mirror.installationId,1,false,p.updatedAt),'23514');
    await db.exec('reset role');await db.query("update appointments set maintenance_origin='external' where id=$1",[mirror.installationId]);
  });
  await check('manual external source installations retain their existing access without creating original-installer choices',async()=>{
    await actor();const p=await toggle(source,manual,2,true);
    assert.equal(p.isSource,true);assert.equal(p.choice,'open');assert.deepEqual(p.declinedDevices,[device(2)]);
  });
  await check('postflight succeeds and all installation dates, maintenance histories, documents, grants and RLS are unchanged',async()=>{
    assert.deepEqual(await snapshot(immutable),before);
    for(const old of appointmentsBefore){
      const current=await scalar("select to_jsonb(a)-'maintenance_opt_out'-'maintenance_opt_out_at' from appointments a where id=$1",[old.row.id]);
      assert.deepEqual(current,old.row);
    }
    assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows,policies);
    await db.exec(await sql('VERIFY_20261106_MAINTENANCE_DEVICE_PREFERENCES.sql'));
  });
  console.log(`${passed} maintenance-device-preference SQL checks passed.`);
} finally{await db.close();}
