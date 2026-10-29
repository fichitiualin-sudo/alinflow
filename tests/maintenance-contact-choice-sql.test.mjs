import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Isolated, real PostgreSQL with synthetic fixtures. No Supabase connection.
const require = createRequire(import.meta.url);
const { PGlite } = process.env.PGLITE_MODULE_PATH ? require(process.env.PGLITE_MODULE_PATH)
  : createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');
const db = new PGlite();
const sql = name => readFile(new URL(`../docs/sql/${name}`, import.meta.url), 'utf8');
const migration = await sql('20261029_MAINTENANCE_CONTACT_CHOICE.sql');
const source = '10000000-0000-0000-0000-000000000001', target = '10000000-0000-0000-0000-000000000002';
const owner = '90000000-0000-0000-0000-000000000001', partner = '90000000-0000-0000-0000-000000000002';
const installation = '40000000-0000-0000-0000-000000000001', excluded = '40000000-0000-0000-0000-000000000002';
const unaccepted = '40000000-0000-0000-0000-000000000003', survey = '40000000-0000-0000-0000-000000000004';
const customer = '20000000-0000-0000-0000-000000000001', targetCustomer = '20000000-0000-0000-0000-000000000002';
const third = randomUUID(), thirdUser = randomUUID(), otherMember = randomUUID(), outsider = randomUUID(), manual = randomUUID();
let passed = 0, grant, thirdGrant, mirror;
async function check(label, fn) { await fn(); passed++; console.log(`PASS ${label}`); }
async function actor(id, role = 'authenticated') {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
}
async function scalar(query, args = []) { return Object.values((await db.query(query, args)).rows[0])[0]; }
const rpc = (name, args) => scalar(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args);
const denied = (promise, code = '42501') => assert.rejects(promise, error => error.code === code);
const list = workspace => rpc('list_maintenance_contact_preferences', [workspace]);
const set = (workspace, id, choice, previous = null, grantId = null) => rpc('set_maintenance_contact_preference', [workspace, id, choice, previous, grantId]);
const get = async (workspace, id) => (await list(workspace)).find(row => row.installationId === id);
async function snapshot() {
  await db.exec('reset role');
  const result = {};
  for (const table of ['customers','appointments','quotes','quote_items','work_reports','documents','work_checklists',
    'inventory_stock','material_inventory','shared_maintenance_grants','shared_maintenance_contacts','shared_maintenance_handoffs',
    'shared_maintenance_preferences','shared_maintenance_events']) {
    result[table] = (await db.query(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`)).rows;
  }
  return result;
}
const expectedKeys = ['choice','installationId','isSource','sourceInstallationId','sourceWorkspaceId','sourceWorkspaceName','updatedAt'].sort();

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
    alter table quote_items alter column quantity type integer,alter column unit_price type integer,alter column total_price type integer;
    alter table quotes alter column total_amount type integer;
    create table maintenance_appointment_items(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid,
      installation_appointment_id uuid references appointments(id),maintenance_appointment_id uuid references appointments(id));
    insert into auth.users values('${owner}',now(),null,null),('${partner}',now(),null,null),('${thirdUser}',now(),null,null),
      ('${otherMember}',now(),null,null),('${outsider}',now(),null,null);
    insert into workspaces values('${source}','Source business',true),('${target}','Partner business',true),('${third}','Third business',true);
    insert into workspace_members values('${target}','${otherMember}',true,'member'),('${third}','${thirdUser}',true,'owner');
    update customers set name='SYNTHETIC PRIVATE CUSTOMER',phone='123456',email='customer@example.test',
      postal_code='1234',city='Test City',address='Test Street',notes='SECRET INTERNAL NOTE';
    update appointments set status='Lezárva',scheduled_date=current_date-500,created_at=now()-interval '2 years'
      where appointment_type='installation';
    insert into appointments(id,workspace_id,customer_id,appointment_type,status,maintenance_origin,scheduled_date,scheduled_time)
      values('${manual}','${target}','${targetCustomer}','installation','Lezárva','external',current_date-100,'08:00');
  `);
  const config = { privacyNotice: { enabled:true, serviceProvider:{ legalName:'Synthetic Partner EV',address:'Test Address',email:'partner@example.test' },
    retentionText:'Test retention',recipientsText:'Test recipients',internationalTransfersText:'Test transfer terms' } };
  await db.query('insert into workspace_settings values($1,$3),($2,$3)', [target,third,config]);
  for (const file of ['20261011_SHARED_MAINTENANCE_ACCESS.sql','20261012_SHARED_MAINTENANCE_HISTORY.sql','20261027_SHARED_MAINTENANCE_OPT_OUT.sql']) await db.exec(await sql(file));
  await actor(owner);
  grant = await rpc('grant_shared_maintenance_access',[source,partner,target,'Signed synthetic processor agreement ONE']);
  thirdGrant = await rpc('grant_shared_maintenance_access',[source,thirdUser,third,'Signed synthetic processor agreement TWO']);
  await actor(partner);
  await rpc('set_shared_maintenance_opt_out',[grant.id,installation,true]);
  mirror = await rpc('accept_shared_maintenance_order',[grant.id,installation,true]);
  await rpc('set_shared_maintenance_opt_out',[grant.id,unaccepted,true]);
  await db.exec('reset role');
  await db.query('update appointments set maintenance_opt_out=true,maintenance_opt_out_at=now() where id=$1',[excluded]);

  await check('idempotent migration preserves all legacy, business, grant, document and helper data', async () => {
    const before = await snapshot();
    const functions = (await db.query("select oid,prosrc,proacl,proconfig from pg_proc where proname like '%shared_maintenance%' or proname='list_received_maintenance_installations' order by oid")).rows;
    const policies = (await db.query('select * from pg_policies order by tablename,policyname')).rows;
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual(await snapshot(),before);
    assert.deepEqual((await db.query("select oid,prosrc,proacl,proconfig from pg_proc where proname like '%shared_maintenance%' or proname='list_received_maintenance_installations' order by oid")).rows,functions);
    assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows,policies);
    assert.equal(await scalar('select count(*)::int from maintenance_contact_preferences'),0);
    await actor(owner); assert.deepEqual(await list(source),[]);
    await actor(partner); assert.deepEqual(await list(target),[],'legacy local flags are not global records');
  });
  await check('empty incoming choices skip the expensive eligibility/history helper, including own-only and ungranted members', async () => {
    await db.exec('reset role');
    await db.exec('begin');
    await db.exec(`create or replace function public.shared_maintenance_installation_rows(p_target_workspace_id uuid)
      returns table(grant_id uuid,installation_id uuid,source_workspace_id uuid,source_customer_id uuid,payload jsonb)
      language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
      begin raise exception 'TEST: expensive incoming helper invoked' using errcode='P0001'; end; $$;`);
    await actor(owner); assert.deepEqual(await list(source),[]);
    await actor(partner); assert.deepEqual(await list(target),[],'empty global table never invokes helper');
    const local=await set(target,manual,'declined');
    assert.deepEqual(await list(target),[local],'own-only choices never invoke incoming history');
    await actor(owner); const outgoing=await set(source,unaccepted,'open');
    assert.deepEqual(await list(source),[outgoing],'source-only choices never invoke incoming history');
    await actor(otherMember); assert.deepEqual(await list(target),[local],'another target user grant cannot trigger incoming history');
    await db.exec('reset role');
    await db.query('update shared_maintenance_grants set revoked_at=now(),revoked_by=$2 where id=$1',[grant.id,owner]);
    await actor(partner); assert.deepEqual(await list(target),[local],'revoked grant cannot trigger incoming history');
    await db.exec('reset role');
    await db.query('update shared_maintenance_grants set revoked_at=null,revoked_by=null where id=$1',[grant.id]);
    await actor(partner); await db.exec('savepoint helper_must_run');
    await denied(list(target),'P0001');
    await db.exec('rollback to savepoint helper_must_run');
    await db.exec('rollback');
    await db.exec('reset role');
    assert.equal(await scalar('select count(*)::int from maintenance_contact_preferences'),0,'transaction restores fixture and original helper');
  });
  await check('direct table access is blocked; only authenticated fixed-search-path RPCs are callable', async () => {
    await db.exec('reset role');
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='maintenance_contact_preferences'::regclass"),true);
    const functions = (await db.query("select proconfig,prosecdef from pg_proc where proname in ('list_maintenance_contact_preferences','set_maintenance_contact_preference')")).rows;
    assert.equal(functions.length,2);
    for (const fn of functions) { assert.equal(fn.prosecdef,true); assert.deepEqual(fn.proconfig,['search_path=pg_catalog, pg_temp']); }
    for (const role of ['anon','authenticated','service_role']) {
      await actor(partner,role);
      for (const statement of ['select * from maintenance_contact_preferences',"update maintenance_contact_preferences set choice='open'",'delete from maintenance_contact_preferences']) await denied(db.query(statement));
      await denied(db.query('insert into maintenance_contact_preferences(source_workspace_id,source_installation_id,choice,updated_by,updated_workspace_id) values($1,$2,$3,$4,$1)',[source,installation,'declined',partner]));
      if (role!=='authenticated') { await denied(list(target)); await denied(set(target,installation,'declined',null,grant.id)); }
    }
    await actor(outsider); await denied(list(source)); await denied(list(target)); await denied(set(source,installation,'declined'));
  });
  await check('unaccepted partner choice is a narrow canonical record visible to source and both eligible partners', async () => {
    const before = await snapshot();
    await actor(partner);
    const saved = await set(target,unaccepted,'original_installer',null,grant.id);
    assert.deepEqual(Object.keys(saved).sort(),expectedKeys);
    assert.equal(saved.installationId,unaccepted); assert.equal(saved.sourceInstallationId,unaccepted);
    assert.equal(saved.sourceWorkspaceId,source); assert.equal(saved.sourceWorkspaceName,'Source business'); assert.equal(saved.isSource,false);
    assert.equal(saved.choice,'original_installer'); assert.ok(saved.updatedAt);
    assert.deepEqual(await get(target,unaccepted),saved);
    await actor(owner); assert.deepEqual(await get(source,unaccepted),{...saved,isSource:true});
    await actor(thirdUser); assert.deepEqual(await get(third,unaccepted),saved);
    assert.deepEqual(await snapshot(),before,'canonical changes do not rewrite local/source business or legacy rows');
    assert.ok(!JSON.stringify(saved).includes('SYNTHETIC PRIVATE CUSTOMER'));
    assert.ok(!JSON.stringify(saved).includes('updated_by'));
  });
  await check('exact recipient grant, workspace, installation scope and valid choices are required', async () => {
    for (const id of [otherMember,owner,outsider]) {
      await actor(id); await denied(set(target,unaccepted,'declined',null,grant.id));
    }
    await actor(otherMember); assert.ok(!(await list(target)).some(row=>row.sourceWorkspaceId===source));
    await actor(partner);
    for (const value of [null,'','DECLINED','original','open ','false']) await denied(set(target,unaccepted,value,null,grant.id),'22023');
    await denied(set(target,unaccepted,'open',null,thirdGrant.id));
    await denied(set(source,unaccepted,'open',null,grant.id));
    await denied(set(target,unaccepted,'open',null,randomUUID()));
    await denied(set(target,randomUUID(),'open',null,grant.id));
    await denied(set(target,survey,'open',null,grant.id));
    await denied(set(target,unaccepted,'open'));
    await denied(set(target,manual,'declined','2026-01-01T00:00:00Z'),'40001','an expected version cannot refer to a nonexistent record');
    await actor(owner); await denied(set(source,survey,'declined'));
  });
  await check('accepted mirror resolves server-side to the same source; other local members need their own current grant', async () => {
    const before = await snapshot();
    await actor(partner);
    const saved = await set(target,mirror.installationId,'declined');
    assert.equal(saved.installationId,mirror.installationId); assert.equal(saved.sourceInstallationId,installation); assert.equal(saved.isSource,false);
    assert.deepEqual(await get(target,mirror.installationId),saved);
    assert.ok(!(await list(target)).some(row=>row.installationId===installation),'no duplicate source entry for accepted mirror');
    await actor(owner); assert.deepEqual(await get(source,installation),{...saved,installationId:installation,isSource:true});
    await actor(thirdUser); assert.deepEqual(await get(third,installation),{...saved,installationId:installation});
    await actor(otherMember); await denied(set(target,mirror.installationId,'open',saved.updatedAt));
    assert.deepEqual(await snapshot(),before);
  });
  await check('state transitions are exclusive; explicit open persists; stale and null versions cannot overwrite a decision', async () => {
    await actor(owner);
    let previous = await get(source,installation);
    const old = previous;
    for (const choice of ['original_installer','open','declined','open']) {
      const current = await set(source,installation,choice,previous.updatedAt);
      assert.equal(current.choice,choice); assert.notEqual(current.updatedAt,previous.updatedAt);
      assert.equal(current.updatedAt>previous.updatedAt,true);
      previous=current;
    }
    await denied(set(source,installation,'declined',null),'40001');
    await denied(set(source,installation,'declined',old.updatedAt),'40001');
    assert.deepEqual(await get(source,installation),previous);
    await db.exec('reset role');
    assert.equal(await scalar('select count(*)::int from maintenance_contact_preferences where source_installation_id=$1',[installation]),1);
    assert.equal(await scalar('select maintenance_opt_out from appointments where id=$1',[mirror.installationId]),true,'explicit open does not rewrite prior local mirror opt-out');
    assert.equal(await scalar('select maintenance_opt_out from shared_maintenance_preferences where source_installation_id=$1 and target_workspace_id=$2',[installation,target]),true);
    await actor(owner); await db.exec('begin');
    const first=await set(source,installation,'declined',previous.updatedAt);
    const second=await set(source,installation,'open',first.updatedAt);
    assert.ok(second.updatedAt>first.updatedAt,'two saves within one transaction still have distinct increasing versions');
    await db.exec('savepoint stale_write');
    await denied(set(source,installation,'declined',first.updatedAt),'40001');
    await db.exec('rollback to savepoint stale_write');
    assert.deepEqual(await get(source,installation),second);
    await db.exec('commit');
  });
  await check('acceptance after a canonical choice maps the same record to the new mirror without copying state into legacy fields', async () => {
    await actor(partner);
    const before=await get(target,unaccepted);
    const accepted=await rpc('accept_shared_maintenance_order',[grant.id,unaccepted,true]);
    assert.deepEqual(await get(target,accepted.installationId),{...before,installationId:accepted.installationId});
    assert.ok(!(await list(target)).some(row=>row.installationId===unaccepted));
    assert.equal(await scalar('select maintenance_opt_out from appointments where id=$1',[accepted.installationId]),true,'only pre-existing legacy opt-out is inherited');
    const saved=await set(target,unaccepted,'open',before.updatedAt,grant.id);
    assert.equal(saved.installationId,accepted.installationId,'stale unaccepted UI is resolved to the current valid mirror');
  });
  await check('source legacy exclusion remains private and only explicit version-checked source reactivation can clear it', async () => {
    await actor(partner); await denied(set(target,excluded,'open',null,grant.id));
    assert.ok(!(await list(target)).some(row=>row.sourceInstallationId===excluded));
    await actor(owner);
    const declined=await set(source,excluded,'declined');
    assert.equal(await scalar('select maintenance_opt_out from appointments where id=$1',[excluded]),true);
    await denied(set(source,excluded,'open',null),'40001');
    assert.equal(await scalar('select maintenance_opt_out from appointments where id=$1',[excluded]),true,'stale request cannot clear legacy exclusion');
    await actor(partner); assert.ok(!(await list(target)).some(row=>row.sourceInstallationId===excluded));
    await denied(set(target,excluded,'open',declined.updatedAt,grant.id));
    await actor(owner); const opened=await set(source,excluded,'original_installer',declined.updatedAt);
    assert.equal(await scalar('select maintenance_opt_out from appointments where id=$1',[excluded]),false);
    assert.equal(await scalar('select maintenance_opt_out_at from appointments where id=$1',[excluded]),null);
    await actor(partner); assert.deepEqual(await get(target,excluded),{...opened,isSource:false});
    await db.exec('reset role'); await db.query('update appointments set maintenance_opt_out=true,maintenance_opt_out_at=now() where id=$1',[excluded]);
    await actor(owner); await set(source,excluded,'open',opened.updatedAt);
    assert.equal(await scalar('select maintenance_opt_out from appointments where id=$1',[excluded]),false,'explicit open also performs ordinary local reactivation');
  });
  await check('manual external installations allow open/declined but cannot invent an original installer', async () => {
    await actor(partner); const saved=await set(target,manual,'declined');
    assert.equal(saved.isSource,true); assert.equal(saved.sourceWorkspaceId,target);
    await denied(set(target,manual,'original_installer',saved.updatedAt),'22023');
    const opened=await set(target,manual,'open',saved.updatedAt); assert.equal(opened.choice,'open');
    assert.deepEqual(await get(target,manual),opened);
    await actor(owner); await denied(set(source,manual,'declined'));
  });
  await check('corrupt or relabelled mirrors fail closed instead of becoming source installations', async () => {
    await actor(partner); const current=await get(target,mirror.installationId);
    const edits = [
      ["update appointments set maintenance_origin='own' where id=$1","update appointments set maintenance_origin='external' where id=$1",'23514'],
      ['update appointments set customer_id=$2 where id=$1','update appointments set customer_id=$3 where id=$1','23514'],
      ['update appointments set workspace_id=$2 where id=$1','update appointments set workspace_id=$3 where id=$1','42501'],
    ];
    for (const [edit,restore,code] of edits) {
      await db.exec('reset role');
      const ids=edit.includes('customer_id')?[mirror.installationId,targetCustomer,mirror.customerId]:[mirror.installationId,source,target];
      await db.query(edit,ids.slice(0,edit.includes('$2')?2:1));
      await actor(partner);
      await denied(set(target,mirror.installationId,'declined',current.updatedAt),code);
      await denied(set(target,installation,'declined',current.updatedAt,grant.id),'23514');
      assert.ok(!(await list(target)).some(row=>row.sourceInstallationId===installation));
      await db.exec('reset role');
      if (restore.includes('$3')) await db.query(restore.replace('$3','$2'),[ids[0],ids[2]]); else await db.query(restore,[ids[0]]);
    }
    await db.query('update shared_maintenance_handoffs set target_workspace_id=$2 where target_installation_id=$1',[mirror.installationId,third]);
    await actor(partner); await denied(set(target,mirror.installationId,'declined',current.updatedAt),'23514');
    await db.exec('reset role'); await db.query('update shared_maintenance_handoffs set target_workspace_id=$2 where target_installation_id=$1',[mirror.installationId,target]);
  });
  await check('cancelled, future, external and post-grant source rows cannot be accessed through a recipient choice', async () => {
    await actor(partner); const current=await get(target,excluded);
    const edits=[
      ["status='Lemondva'","status='Lezárva'"],['cancelled_at=now()','cancelled_at=null'],
      ['scheduled_date=current_date+1','scheduled_date=current_date-500'],["maintenance_origin='external'","maintenance_origin='own'"],
      ["created_at=now()+interval '1 day'","created_at=now()-interval '2 years'"],
    ];
    for (const [edit,restore] of edits) {
      await db.exec('reset role'); await db.query(`update appointments set ${edit} where id=$1`,[excluded]);
      await actor(partner); assert.ok(!(await list(target)).some(row=>row.sourceInstallationId===excluded));
      await denied(set(target,excluded,'declined',current.updatedAt,grant.id));
      await db.exec('reset role'); await db.query(`update appointments set ${restore} where id=$1`,[excluded]);
    }
  });
  await check('inactive memberships/workspaces and banned/deleted/unconfirmed users cannot list or write', async () => {
    await actor(partner); const current=await get(target,mirror.installationId);
    const edits=[
      ['update workspace_members set active=false where user_id=$1','update workspace_members set active=true where user_id=$1',partner,true],
      ["update auth.users set banned_until=now()+interval '1 day' where id=$1",'update auth.users set banned_until=null where id=$1',partner,true],
      ['update auth.users set deleted_at=now() where id=$1','update auth.users set deleted_at=null where id=$1',partner,true],
      ['update auth.users set email_confirmed_at=null where id=$1','update auth.users set email_confirmed_at=now() where id=$1',partner,true],
      ['update workspaces set active=false where id=$1','update workspaces set active=true where id=$1',target,true],
      ['update workspaces set active=false where id=$1','update workspaces set active=true where id=$1',source,false],
    ];
    for (const [edit,restore,id,rejectList] of edits) {
      await db.exec('reset role'); await db.query(edit,[id]); await actor(partner);
      if(rejectList) await denied(list(target)); else assert.ok(!(await list(target)).some(row=>row.sourceInstallationId===installation));
      await denied(set(target,mirror.installationId,'declined',current.updatedAt));
      await db.exec('reset role'); await db.query(restore,[id]);
    }
  });
  await check('old boolean RPC retains local meaning and never edits an explicit global choice', async () => {
    await actor(partner); const current=await get(target,mirror.installationId);
    await rpc('set_shared_maintenance_opt_out',[grant.id,installation,false]);
    assert.deepEqual(await get(target,mirror.installationId),current);
    await rpc('set_shared_maintenance_opt_out',[grant.id,installation,true]);
    assert.deepEqual(await get(target,mirror.installationId),current);
  });
  await check('another currently granted member may use an existing mirror; old handoff grant alone never authorizes it', async () => {
    await actor(owner);
    const memberGrant=await rpc('grant_shared_maintenance_access',[source,otherMember,target,'Signed synthetic processor agreement OTHER-MEMBER']);
    await actor(otherMember); const previous=await get(target,mirror.installationId);
    const saved=await set(target,mirror.installationId,'original_installer',previous.updatedAt);
    assert.equal(saved.choice,'original_installer'); assert.equal(saved.isSource,false);
    await actor(owner); await rpc('revoke_shared_maintenance_access',[memberGrant.id]);
    await actor(otherMember); assert.ok(!(await list(target)).some(row=>row.sourceWorkspaceId===source));
    await denied(set(target,mirror.installationId,'open',saved.updatedAt));
  });
  await check('revocation removes cross-source choice access immediately while own data and canonical records survive', async () => {
    await actor(partner); const previous=await get(target,mirror.installationId);
    await actor(owner); await rpc('revoke_shared_maintenance_access',[grant.id]);
    const before=await snapshot();
    await actor(partner);
    assert.ok(!(await list(target)).some(row=>row.sourceWorkspaceId===source));
    await denied(set(target,mirror.installationId,'open',previous.updatedAt));
    await denied(set(target,installation,'open',previous.updatedAt,grant.id));
    assert.equal(await scalar('select count(*)::int from appointments where id=$1',[mirror.installationId]),1);
    assert.equal((await get(target,manual)).choice,'open');
    await actor(owner); assert.equal((await get(source,installation)).choice,previous.choice);
    assert.deepEqual(await snapshot(),before);
  });
  await check('repeat migration preserves explicit choices and read-only verification returns only passing flags/aggregate counts', async () => {
    const before=await snapshot();
    const prefs=(await db.query('select to_jsonb(p) as row from maintenance_contact_preferences p order by source_installation_id')).rows;
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual(await snapshot(),before);
    assert.deepEqual((await db.query('select to_jsonb(p) as row from maintenance_contact_preferences p order by source_installation_id')).rows,prefs);
    const rows=(await db.exec(await sql('VERIFY_20261029_MAINTENANCE_CONTACT_CHOICE.sql'))).flatMap(result=>result.rows);
    assert.ok(rows.some(row=>row.preference_rows!==undefined));
    for(const row of rows) for(const [key,value] of Object.entries(row)) {
      if(typeof value==='boolean') assert.equal(value,true,key);
      assert.ok(!['customer_id','workspace_id','user_id','installation_id','grant_id'].includes(key));
      if(key==='invalid_rows') assert.equal(Number(value),0);
    }
  });
  console.log(`Completed ${passed} maintenance-contact-choice PostgreSQL checks.`);
} finally { await db.close(); }
