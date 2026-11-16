const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sqlRoot=path.resolve(__dirname,'../docs/sql');
const read=name=>fs.readFileSync(path.join(sqlRoot,name),'utf8');
const migration=read('20261116_SHARED_MAINTENANCE_SCHEDULES.sql');
const modulePath=process.env.PGLITE_MODULE_PATH;

test('shared booking RPC respects grant boundaries without changing business data or completed contracts', {
  skip: !modulePath && 'Set PGLITE_MODULE_PATH to the isolated PGlite package',
},async t=>{
  const {PGlite}=require(modulePath),db=new PGlite();
  const ids=Object.fromEntries(['source','target','other','owner','recipient','colleague','customer','targetCustomer','grant','installation','unaccepted','mirror','sourceVisit','partnerVisit','unacceptedVisit'].map(key=>[key,randomUUID()]));
  const devices=[{productName:'Synthetic AC',unitNumber:1}];
  const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
  const actor=id=>db.query("select set_config('test.actor',$1,false)",[id]);
  const schedules=workspace=>scalar('select public.list_shared_maintenance_schedules($1)',[workspace]);
  const sourceRows=async()=>{await actor(ids.owner);return schedules(ids.source);};
  const targetRows=async()=>{await actor(ids.recipient);return schedules(ids.target);};
  const snapshot=async()=>{
    const result={};
    for(const table of ['appointments','maintenance_appointment_items','shared_maintenance_grants','shared_maintenance_handoffs','customers','workspaces'])
      result[table]=(await db.query('select to_jsonb(t) as row from public.'+table+' t order by to_jsonb(t)::text')).rows;
    return result;
  };
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
      create table auth.users(id uuid primary key,deleted_at timestamptz,email_confirmed_at timestamptz,banned_until timestamptz);
      create table workspaces(id uuid primary key,name text,active boolean);
      create table workspace_members(workspace_id uuid,user_id uuid,active boolean,role text);
      create table customers(id uuid,workspace_id uuid);
      create table quotes(id uuid,workspace_id uuid,customer_id uuid);
      create table quote_items(quote_id uuid,workspace_id uuid,description text);
      create table appointments(id uuid,workspace_id uuid,customer_id uuid,quote_id uuid,scheduled_date date,scheduled_time text,appointment_type text,maintenance_origin text,status text,cancelled_at timestamptz,created_at timestamptz,maintenance_opt_out boolean);
      create table shared_maintenance_grants(id uuid,source_workspace_id uuid,target_workspace_id uuid,target_user_id uuid,scope text,cutoff_date date,created_at timestamptz,revoked_at timestamptz);
      create table shared_maintenance_handoffs(grant_id uuid,source_workspace_id uuid,source_installation_id uuid,target_workspace_id uuid,target_customer_id uuid,target_installation_id uuid);
      create table maintenance_appointment_items(installation_appointment_id uuid,maintenance_appointment_id uuid,workspace_id uuid,customer_id uuid,selected_devices jsonb);
      create function public.list_shared_maintenance_results(uuid) returns jsonb language sql as $$ select '[]'::jsonb $$;
      create function public.shared_maintenance_installation_rows(uuid) returns jsonb language sql as $$ select '[]'::jsonb $$;
    `);
    const member=read('20261011_SHARED_MAINTENANCE_ACCESS.sql').match(/create or replace function public\.shared_maintenance_member\([\s\S]*?\$\$;/)[0];
    await db.exec(member);
    for(const [workspace,name] of [[ids.source,'Source'],[ids.target,'Partner'],[ids.other,'Unrelated']])
      await db.query('insert into workspaces values($1,$2,true)',[workspace,name]);
    for(const [user,workspace] of [[ids.owner,ids.source],[ids.recipient,ids.target],[ids.colleague,ids.target]]) {
      await db.query('insert into auth.users values($1,null,now(),null)',[user]);
      await db.query("insert into workspace_members values($1,$2,true,'owner')",[workspace,user]);
    }
    await db.query('insert into customers values($1,$2),($3,$4)',[ids.customer,ids.source,ids.targetCustomer,ids.target]);
    await db.query("insert into shared_maintenance_grants values($1,$2,$3,$4,'historical_installations',current_date,now(),null)",[ids.grant,ids.source,ids.target,ids.recipient]);
    for(const [id,workspace,customer,type,status,origin] of [
      [ids.installation,ids.source,ids.customer,'installation','Lezárva','own'],
      [ids.unaccepted,ids.source,ids.customer,'installation','Lezárva','own'],
      [ids.mirror,ids.target,ids.targetCustomer,'installation','Lezárva','external'],
      [ids.sourceVisit,ids.source,ids.customer,'maintenance','Időpont foglalva','own'],
      [ids.unacceptedVisit,ids.source,ids.customer,'maintenance','Időpont foglalva','own'],
      [ids.partnerVisit,ids.target,ids.targetCustomer,'maintenance','Időpont foglalva','external'],
    ]) await db.query("insert into appointments values($1,$2,$3,null,current_date+case when $4='installation' then -10 else 10 end,'09:30',$4,$5,$6,null,now()-interval '1 day',false)",[id,workspace,customer,type,origin,status]);
    await db.query('insert into shared_maintenance_handoffs values($1,$2,$3,$4,$5,$6)',[ids.grant,ids.source,ids.installation,ids.target,ids.targetCustomer,ids.mirror]);
    for(const [installation,visit,workspace,customer] of [[ids.installation,ids.sourceVisit,ids.source,ids.customer],[ids.unaccepted,ids.unacceptedVisit,ids.source,ids.customer],[ids.mirror,ids.partnerVisit,ids.target,ids.targetCustomer]])
      await db.query('insert into maintenance_appointment_items values($1,$2,$3,$4,$5)',[installation,visit,workspace,customer,JSON.stringify(devices)]);
    const businessBefore=await snapshot();
    const completedBefore=await scalar("select pg_get_functiondef('public.list_shared_maintenance_results(uuid)'::regprocedure)");
    const historyBefore=await scalar("select pg_get_functiondef('public.shared_maintenance_installation_rows(uuid)'::regprocedure)");
    await db.exec(migration);await db.exec(migration);

    await t.test('idempotent read migration preserves records, completed functions, and constrained execution',async()=>{
      assert.deepEqual(await snapshot(),businessBefore);
      assert.equal(await scalar("select pg_get_functiondef('public.list_shared_maintenance_results(uuid)'::regprocedure)"),completedBefore);
      assert.equal(await scalar("select pg_get_functiondef('public.shared_maintenance_installation_rows(uuid)'::regprocedure)"),historyBefore);
      for(const role of ['anon','service_role']) assert.equal(await scalar("select has_function_privilege($1,'public.list_shared_maintenance_schedules(uuid)','execute')",[role]),false);
      assert.equal(await scalar("select has_function_privilege('authenticated','public.list_shared_maintenance_schedules(uuid)','execute')"),true);
      assert.equal(await scalar("select prosecdef and provolatile='s' and proconfig=array['search_path=pg_catalog, pg_temp'] from pg_proc where oid='public.list_shared_maintenance_schedules(uuid)'::regprocedure"),true);
    });
    await t.test('source sees accepted partner booking; recipient sees source booking before and after acceptance',async()=>{
      const source=await sourceRows();assert.equal(source.length,1);assert.equal(source[0].installationId,ids.installation);
      assert.equal(source[0].maintenanceAppointmentId,ids.partnerVisit);assert.equal(source[0].providerName,'Partner');
      const target=await targetRows();assert.equal(target.length,2);
      assert.equal(target.find(row=>row.maintenanceAppointmentId===ids.sourceVisit).installationId,ids.mirror);
      assert.equal(target.find(row=>row.maintenanceAppointmentId===ids.unacceptedVisit).installationId,ids.unaccepted);
      for(const row of [...source,...target]) {
        assert.deepEqual(Object.keys(row).sort(),['installationId','sourceWorkspaceId','sourceInstallationId','maintenanceAppointmentId','date','time','selectedDevices','providerName'].sort());
        assert.deepEqual(row.selectedDevices,devices);assert.equal(row.sourceWorkspaceId,ids.source);
      }
    });
    await t.test('bookings require exact device links, saved time, active status and no cancellation',async()=>{
      for(const status of ['Lezárva','Szerelés kész – admin folyamatban','Lemondva','Új érdeklődő']) {
        await db.query('update appointments set status=$1 where id=$2',[status,ids.partnerVisit]);assert.deepEqual(await sourceRows(),[]);
      }
      await db.query("update appointments set status='Szerelés folyamatban',scheduled_time='09:30:00' where id=$1",[ids.partnerVisit]);assert.equal((await sourceRows()).length,1);
      for(const time of ['','24:00','09:60','09:30:99']) {
        await db.query('update appointments set scheduled_time=$1 where id=$2',[time,ids.partnerVisit]);assert.deepEqual(await sourceRows(),[]);
      }
      await db.query("update appointments set status='Időpont foglalva',scheduled_time='09:30',cancelled_at=now() where id=$1",[ids.partnerVisit]);assert.deepEqual(await sourceRows(),[]);
      await db.query('update appointments set cancelled_at=null,scheduled_date=current_date-1 where id=$1',[ids.partnerVisit]);assert.equal((await sourceRows()).length,1,'overdue open booking remains pending');
      for(const selection of [null,'[]','null']) {
        await db.query('update maintenance_appointment_items set selected_devices=$1 where maintenance_appointment_id=$2',[selection,ids.partnerVisit]);assert.deepEqual(await sourceRows(),[]);
      }
      await db.query('update maintenance_appointment_items set selected_devices=$1,customer_id=$2 where maintenance_appointment_id=$3',[JSON.stringify(devices),ids.customer,ids.partnerVisit]);assert.deepEqual(await sourceRows(),[]);
      await db.query('update maintenance_appointment_items set customer_id=$1 where maintenance_appointment_id=$2',[ids.targetCustomer,ids.partnerVisit]);
      assert.equal((await sourceRows()).length,1);
    });
    await t.test('revocation, original grant cutoff, source provenance and opt-out prevent both-direction disclosure',async()=>{
      const guards=[
        ["update shared_maintenance_grants set revoked_at=now()","update shared_maintenance_grants set revoked_at=null"],
        ["update shared_maintenance_grants set cutoff_date=current_date-20","update shared_maintenance_grants set cutoff_date=current_date"],
        ["update shared_maintenance_grants set created_at=now()-interval '2 days'","update shared_maintenance_grants set created_at=now()"],
        ["update shared_maintenance_grants set scope='invalid'","update shared_maintenance_grants set scope='historical_installations'"],
        ["update appointments set maintenance_opt_out=true where workspace_id='"+ids.source+"'","update appointments set maintenance_opt_out=false"],
        ["update appointments set cancelled_at=now() where appointment_type='installation' and workspace_id='"+ids.source+"'","update appointments set cancelled_at=null"],
      ];
      for(const [deny,restore] of guards) {await db.exec(deny);assert.deepEqual(await sourceRows(),[]);assert.deepEqual(await targetRows(),[]);await db.exec(restore);}
      await db.query('update shared_maintenance_handoffs set grant_id=$1',[randomUUID()]);assert.deepEqual(await sourceRows(),[]);
      await db.query('update shared_maintenance_handoffs set grant_id=$1',[ids.grant]);
    });
    await t.test('forwarded installations and explicit extra-only jobs are outside the shared climate scope',async()=>{
      await db.query('insert into shared_maintenance_handoffs values($1,$2,$3,$4,$5,$6)',[randomUUID(),ids.other,randomUUID(),ids.source,ids.customer,ids.installation]);
      assert.deepEqual(await sourceRows(),[]);
      assert.equal((await targetRows()).length,1);
      await db.query('delete from shared_maintenance_handoffs where target_installation_id=$1',[ids.installation]);
      await db.query('insert into quotes values($1,$2,$3)',[ids.installation,ids.source,ids.customer]);
      await db.query("insert into quote_items values($1,$2,'item_type=extra')",[ids.installation,ids.source]);
      await db.query('update appointments set quote_id=$1 where id=$1',[ids.installation]);
      assert.deepEqual(await sourceRows(),[]);assert.equal((await targetRows()).length,1);
      await db.query("insert into quote_items values($1,$2,'item_type=climate')",[ids.installation,ids.other]);
      assert.deepEqual(await sourceRows(),[],'foreign quote lines cannot make an extra-only job eligible');
      await db.query("insert into quote_items values($1,$2,'item_type=climate')",[ids.installation,ids.source]);
      assert.equal((await sourceRows()).length,1);assert.equal((await targetRows()).length,2);
    });
    await t.test('active workspace, exact recipient and verified membership remain mandatory',async()=>{
      await actor(ids.colleague);assert.deepEqual(await schedules(ids.target),[]);
      await actor(ids.owner);await assert.rejects(schedules(ids.other),/Nincs hozzáférés/);
      await actor('');await assert.rejects(schedules(ids.source),/Nincs hozzáférés/);
      for(const workspace of [ids.source,ids.target]) {
        await db.query('update workspaces set active=false where id=$1',[workspace]);
        if(workspace===ids.source) {await assert.rejects(sourceRows(),/Nincs hozzáférés/);assert.deepEqual(await targetRows(),[]);}
        else {assert.deepEqual(await sourceRows(),[]);await assert.rejects(targetRows(),/Nincs hozzáférés/);}
        await db.query('update workspaces set active=true where id=$1',[workspace]);
      }
      await db.query('update workspace_members set active=false where user_id=$1',[ids.recipient]);assert.deepEqual(await sourceRows(),[]);await assert.rejects(targetRows(),/Nincs hozzáférés/);
      await db.query('update workspace_members set active=true where user_id=$1',[ids.recipient]);
      await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[ids.recipient]);assert.deepEqual(await sourceRows(),[]);await assert.rejects(targetRows(),/Nincs hozzáférés/);
    });
  } finally {await db.close();}
});
