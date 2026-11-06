import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.PGLITE_MODULE_PATH);
const db=new PGlite();
const sql=name=>readFile(new URL(`../docs/sql/${name}`,import.meta.url),'utf8');
const source='10000000-0000-0000-0000-000000000001',target='10000000-0000-0000-0000-000000000002',third=randomUUID();
const owner='90000000-0000-0000-0000-000000000001',partner='90000000-0000-0000-0000-000000000002',thirdUser=randomUUID(),otherMember=randomUUID();
const customer='20000000-0000-0000-0000-000000000001',otherCustomer='20000000-0000-0000-0000-000000000002';
const installation='40000000-0000-0000-0000-000000000001',otherInstallation='40000000-0000-0000-0000-000000000003';
const scalar=async(query,args=[])=>Object.values((await db.query(query,args)).rows[0])[0];
const rpc=(name,args)=>scalar(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args);
const denied=(promise,code='42501')=>assert.rejects(promise,error=>error.code===code);
async function actor(id=owner,role='authenticated'){await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);}
let passed=0,grant,thirdGrant;
async function check(label,fn){await fn();passed++;console.log(`PASS ${label}`);}
const own=(id=randomUUID(),kind='initiated',at=null,appointment=null,client=customer,ws=source)=>rpc('record_customer_phone_call',[ws,client,appointment,kind,at,id]);
const shared=(id=randomUUID(),kind='initiated',at=null,inst=installation,g=grant?.id,ws=target)=>rpc('record_shared_maintenance_phone_call',[ws,g,inst,kind,at,id]);
const listOwn=(ws=source,client=customer)=>rpc('list_customer_phone_calls',[ws,client]);
const listShared=(ws=target,g=grant?.id,inst=installation)=>rpc('list_shared_maintenance_phone_calls',[ws,g,inst]);
async function snapshot(){await db.exec('reset role');return Object.fromEntries(await Promise.all(['customers','appointments','documents','shared_maintenance_handoffs','shared_maintenance_contacts'].map(async table=>
  [table,(await db.query(`select to_jsonb(t) ${table==='customers'?"- 'last_phone_call_at'":''} row from public.${table} t order by to_jsonb(t)::text`)).rows])));}
try {
  await db.exec(await readFile(new URL('./fixtures/schema.sql',import.meta.url),'utf8'));
  await db.exec(`create role service_role;
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
    create table maintenance_appointment_items(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid,
      installation_appointment_id uuid references appointments(id),maintenance_appointment_id uuid references appointments(id));
    insert into auth.users values('${owner}',now(),null,null),('${partner}',now(),null,null),('${thirdUser}',now(),null,null),('${otherMember}',now(),null,null);
    insert into workspaces values('${source}','Source business',true),('${target}','Partner business',true),('${third}','Third business',true);
    insert into workspace_members values('${target}','${otherMember}',true,'member'),('${third}','${thirdUser}',true,'owner');
    update customers set notes='SYNTHETIC PRIVATE NOTE';
    update appointments set status='Lezárva',scheduled_date=current_date-500,created_at=now()-interval '2 years' where appointment_type='installation';
  `);
  const notice={privacyNotice:{enabled:true,serviceProvider:{legalName:'Synthetic Partner',address:'Synthetic Address',email:'partner@example.test'},retentionText:'Test',recipientsText:'Test',internationalTransfersText:'Test'}};
  for(const ws of [target,third]) await db.query('insert into workspace_settings values($1,$2)',[ws,notice]);
  await db.exec(await sql('20261011_SHARED_MAINTENANCE_ACCESS.sql'));
  await actor();grant=await rpc('grant_shared_maintenance_access',[source,partner,target,'Synthetic signed agreement']);
  thirdGrant=await rpc('grant_shared_maintenance_access',[source,thirdUser,third,'Synthetic signed agreement']);
  const before=await snapshot();
  const migration=await sql('20261106_CUSTOMER_PHONE_CALLS.sql');
  await check('migration is repeatable and never changes notes, documents, orders or business rows',async()=>{
    await db.exec(migration);await db.exec(migration);assert.deepEqual(await snapshot(),before);
  });
  await check('own initiated event uses server time, retries once and is customer scoped',async()=>{
    await actor();const id=randomUUID();const first=await own(id);const retried=await own(id);
    assert.deepEqual(retried,first);assert.equal(first.kind,'initiated');assert.equal(first.actorName,'Source business');
    assert.equal((await listOwn()).length,1);assert.equal((await listOwn())[0].id,id);
    assert.ok(Math.abs(Date.parse(first.occurredAt)-Date.now())<10000);
    assert.equal(new Date(await scalar('select last_phone_call_at from customers where id=$1',[customer])).getTime(),Date.parse(first.occurredAt));
    await denied(own(id,'recorded','2020-01-01T10:00:00Z'),'23514');
    await denied(own(randomUUID(),'initiated',null,installation,otherCustomer));
    await denied(listOwn(source,otherCustomer));
  });
  await check('manual timestamps remain their actual supplied time; invalid or future claims do not append',async()=>{
    await actor();const previous=await scalar('select last_phone_call_at from customers where id=$1',[customer]);
    const at='2020-01-02T10:15:00Z',id=randomUUID();const saved=await own(id,'recorded',at,installation);
    assert.equal(Date.parse(saved.occurredAt),Date.parse(at));assert.equal(saved.kind,'recorded');assert.deepEqual(await own(id,'recorded',at,installation),saved);
    const count=(await listOwn()).length;
    await denied(own(randomUUID(),'recorded',null),'22023');await denied(own(randomUUID(),'recorded','2999-01-01T00:00:00Z'),'22023');
    await denied(own(randomUUID(),'initiated',at),'22023');await denied(own(randomUUID(),'answered',null),'22023');
    assert.equal((await listOwn()).length,count);
    assert.deepEqual(await scalar('select last_phone_call_at from customers where id=$1',[customer]),previous);
    assert.deepEqual(await snapshot(),before);
  });
  await check('contact-only partner records limited metadata without accepting a maintenance order',async()=>{
    await actor(partner);const saved=await shared();assert.equal(saved.installationId,installation);assert.equal(saved.actorName,'Partner business');
    assert.deepEqual(Object.keys(saved).sort(),['actorName','id','installationId','kind','occurredAt','recordedAt'].sort());
    assert.equal((await listShared()).length,1);assert.equal((await listShared())[0].id,saved.id);
    await denied(listOwn());assert.deepEqual(await snapshot(),before);
    assert.equal(new Date(await scalar('select last_phone_call_at from customers where id=$1',[customer])).getTime(),Date.parse(saved.occurredAt));
    assert.equal(await scalar('select last_phone_call_at from customers where id=$1',[otherCustomer]),null);
    await actor(partner);
    await shared(randomUUID(),'recorded','2019-01-01T10:00:00Z');
    await db.exec('reset role');
    assert.equal(new Date(await scalar('select last_phone_call_at from customers where id=$1',[customer])).getTime(),Date.parse(saved.occurredAt));
  });
  await check('the source sees all callers; one partner cannot read another partner or another installation calls',async()=>{
    await actor(thirdUser);const other=await shared(randomUUID(),'initiated',null,installation,thirdGrant.id,third);
    await actor(partner);const mine=await listShared();assert.equal(mine.length,2);assert.ok(!mine.some(call=>call.id===other.id));
    assert.equal((await listShared(target,grant.id,otherInstallation)).length,0);
    await denied(listShared(third,thirdGrant.id));
    await actor();assert.equal((await listOwn()).length,5);
  });
  await check('exact grantee and current grant/source eligibility are required for both reads and writes',async()=>{
    await actor(otherMember);await denied(shared());await denied(listShared());
    await db.exec('reset role');await db.query('update appointments set maintenance_opt_out=true where id=$1',[installation]);
    await actor(partner);await denied(shared());await denied(listShared());
    await db.exec('reset role');await db.query('update appointments set maintenance_opt_out=false where id=$1',[installation]);
    await db.query('update shared_maintenance_grants set revoked_at=now(),revoked_by=$1 where id=$2',[owner,grant.id]);
    await actor(partner);await denied(shared());await denied(listShared());
    await db.exec('reset role');await db.query('update shared_maintenance_grants set revoked_at=null,revoked_by=null where id=$1',[grant.id]);
    await db.query('update auth.users set banned_until=now()+interval \'1 day\' where id=$1',[partner]);
    await actor(partner);await denied(shared());await denied(listShared());
    await db.exec('reset role');await db.query('update auth.users set banned_until=null where id=$1',[partner]);
  });
  await check('roles cannot directly read/edit the append-only table or invoke the private writer',async()=>{
    for(const role of ['authenticated','anon','service_role']) {
      await actor(partner,role);await denied(db.query('select * from customer_phone_calls'));
      await denied(db.query('update customer_phone_calls set actor_name=\'Changed\''));
      await denied(rpc('insert_customer_phone_call',[source,customer,null,installation,target,grant.id,'initiated',null,randomUUID()]));
    }
  });
  await check('listing is capped and additive migration preserves existing activity',async()=>{
    await db.exec('reset role');await db.query(`insert into customer_phone_calls(id,source_workspace_id,source_customer_id,actor_workspace_id,actor_id,actor_name,kind,occurred_at)
      select gen_random_uuid(),$1,$2,$1,$3,'Source business','recorded','2022-01-01'::timestamptz+n*interval '1 day' from generate_series(1,105) n`,[source,customer,owner]);
    const count=await scalar('select count(*)::int from customer_phone_calls');await db.exec(migration);
    assert.equal(await scalar('select count(*)::int from customer_phone_calls'),count);
    await actor();const list=await listOwn();assert.equal(list.length,100);
    assert.ok(list.every((call,i)=>!i||Date.parse(call.occurredAt)<=Date.parse(list[i-1].occurredAt)));
  });
  await check('read-only postflight verifies permissions and latest-call consistency without exposing records',async()=>{
    await db.exec('reset role');const results=await db.exec(await sql('VERIFY_20261106_CUSTOMER_PHONE_CALLS.sql'));
    const rows=results.flatMap(result=>result.rows);
    assert.equal(rows.find(row=>'latest_call_timestamp_inconsistent' in row).latest_call_timestamp_inconsistent,0);
    const acl=rows.find(row=>'phone_calls_rls_enabled' in row);
    assert.equal(acl.phone_calls_rls_enabled,true);assert.equal(acl.no_direct_member_access,true);
    assert.equal(acl.no_anonymous_access,true);assert.equal(acl.no_direct_server_access,true);
    assert.ok(rows.filter(row=>'proname' in row).every(row=>row.no_anonymous_execute&&row.no_server_execute));
  });
  console.log(`PASS ${passed} phone SQL regression groups`);
} catch(error){console.error({message:error.message,code:error.code,where:error.where});process.exitCode=1;} finally {await db.close();}

