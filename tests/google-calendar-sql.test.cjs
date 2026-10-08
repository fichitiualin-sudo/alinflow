const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Only a disposable local PostgreSQL instance; no Google or Supabase connection.
const repo = path.resolve(__dirname, '..');
const modulePath = process.env.PGLITE_MODULE_PATH;
const migration = fs.readFileSync(path.join(repo, 'docs/sql/GOOGLE_CALENDAR_SYNC.sql'), 'utf8');
const workspace = '10000000-0000-0000-0000-000000000001';
const foreignWorkspace = '10000000-0000-0000-0000-000000000002';
const user = '90000000-0000-0000-0000-000000000001';
const customer = '20000000-0000-0000-0000-000000000001';
const foreignCustomer = '20000000-0000-0000-0000-000000000002';
const oldAppointment = '40000000-0000-0000-0000-000000000001';
const quote = '30000000-0000-0000-0000-000000000001';

test('Google Calendar SQL outbox, OAuth consumption and access control', {
  skip: !modulePath && 'Set PGLITE_MODULE_PATH to the isolated PGlite package',
}, async t => {
  const { PGlite } = require(modulePath);
  const db = new PGlite();
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  const as = async role => {
    assert.ok(['authenticated', 'anon', 'service_role', 'postgres'].includes(role));
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  };
  const denied = async run => {
    await db.exec('savepoint expected_error');
    await assert.rejects(run, error => error.code === '42501');
    await db.exec('rollback to savepoint expected_error');
  };
  const check = async (name, run) => t.test(name, async () => {
    await db.exec('reset role; begin');
    try { await run(); } finally { await db.exec('rollback; reset role'); }
  });
  const connect = async (ws = workspace, status = 'connected') => {
    await as('service_role');
    await db.query(`insert into google_calendar_connections(workspace_id,connected_by,google_subject,
      google_email,calendar_id,refresh_token_encrypted,scope,status)
      values($1,$2,'synthetic-subject','owner@example.invalid','calendar@example.invalid','encrypted-test-value','calendar-scope',$3)`,
      [ws, user, status]);
    await as('postgres');
  };
  const seed = async ({ ws = workspace, type = 'installation', quoteId = null } = {}) => {
    const id = randomUUID();
    await db.query(`insert into appointments(id,workspace_id,customer_id,quote_id,scheduled_date,scheduled_time,
      appointment_type,status) values($1,$2,$3,$4,'2027-03-01','09:00',$5,'Időpont foglalva')`,
      [id, ws, ws === workspace ? customer : foreignCustomer, quoteId, type]);
    return id;
  };
  const claim = async (ws = workspace, limit = 10) => {
    await as('service_role');
    return (await db.query('select * from claim_google_calendar_sync($1,$2,120)', [ws, limit])).rows;
  };
  const finish = async (row, patch = {}) => {
    await as('service_role');
    return scalar('select finish_google_calendar_sync($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
      row.workspace_id, row.appointment_id, patch.token || row.lease_token,
      patch.version ?? row.lease_version, patch.success ?? true,
      patch.eventId ?? 'synthetic-event-id', patch.generation ?? 0, patch.deleted ?? false,
      patch.error ?? null, patch.retry ?? 60,
    ]);
  };
  const queued = async id => {
    await as('service_role');
    return (await db.query('select * from google_calendar_sync_queue where workspace_id=$1 and appointment_id=$2', [workspace, id])).rows[0];
  };

  try {
    await db.exec(fs.readFileSync(path.join(__dirname, 'fixtures/schema.sql'), 'utf8'));
    await db.exec(`
      create role service_role bypassrls;
      create table auth.users(id uuid primary key);
      insert into auth.users values('${user}');
      create table workspaces(id uuid primary key,active boolean not null default true);
      insert into workspaces(id) values('${workspace}'),('${foreignWorkspace}');
      alter table workspace_members add column role text not null default 'owner';
      alter table customers add column phone text,add column city text,add column address text;
      update appointments set created_at=now()-interval '1 day';
      grant usage on schema public,auth to service_role;
    `);
    await db.exec(migration);
    await db.exec(migration);

    await check('migration preserves existing work and never backfills manual events', async () => {
      assert.equal(await scalar('select count(*)::int from appointments'), 4);
      assert.equal(await scalar('select count(*)::int from google_calendar_sync_queue'), 0);
      await seed(); // Created before a connection, so there is nothing to process.
      assert.equal(await scalar('select count(*)::int from google_calendar_sync_queue'), 0);
      await connect();
      await db.query("update appointments set notes='old appointment edited' where id=$1", [oldAppointment]);
      assert.equal(await scalar('select count(*)::int from google_calendar_sync_queue'), 0);
      assert.equal(await scalar('select signature_data_url from work_reports'), 'SYNTHETIC-SIGNATURE');
    });

    await check('new installation, survey and maintenance writes enroll exactly their own workspace', async () => {
      await connect();
      for (const type of ['installation', 'survey', 'maintenance']) await seed({ type });
      await seed({ ws: foreignWorkspace });
      const rows = await claim();
      assert.equal(rows.length, 3);
      assert.ok(rows.every(row => row.workspace_id === workspace && row.desired_version === 1));
      assert.equal((await claim()).length, 0);
    });

    await check('queue writes roll back with the appointment transaction', async () => {
      await connect();
      await db.exec('savepoint appointment_write');
      const id = await seed();
      assert.ok(await queued(id));
      await as('postgres');
      await db.exec('rollback to savepoint appointment_write');
      assert.equal(await queued(id), undefined);
    });

    await check('browser roles cannot read secrets, write outbox or invoke queue RPCs', async () => {
      await connect();
      await seed();
      for (const role of ['anon', 'authenticated']) {
        await as(role);
        for (const table of ['google_calendar_connections', 'google_calendar_oauth_states', 'google_calendar_sync_queue']) {
          await denied(() => db.query(`select * from ${table}`));
          await denied(() => db.query(`delete from ${table}`));
        }
        await denied(() => db.query('select * from claim_google_calendar_sync()'));
        await denied(() => db.query('select * from consume_google_calendar_oauth_state($1)', ['a'.repeat(64)]));
        await denied(() => db.query('select google_calendar_sync_status($1)', [workspace]));
        await denied(() => db.query('select enqueue_google_calendar_appointment($1,$2,now(),false)', [workspace, randomUUID()]));
      }
      await as('postgres');
      await db.exec(`grant execute on function claim_google_calendar_sync(uuid,integer,integer),
        google_calendar_sync_status(uuid),consume_google_calendar_oauth_state(text) to authenticated;
        grant select on google_calendar_connections to authenticated`);
      await as('authenticated');
      assert.equal(await scalar('select count(*)::int from google_calendar_connections'), 0);
      await denied(() => db.query('select * from claim_google_calendar_sync()'));
      await denied(() => db.query('select google_calendar_sync_status($1)', [workspace]));
      await denied(() => db.query('select * from consume_google_calendar_oauth_state($1)', ['a'.repeat(64)]));
      await as('service_role');
      await denied(() => db.query('delete from google_calendar_sync_queue'));
      await denied(() => db.query('select enqueue_google_calendar_appointment($1,$2,now(),false)', [workspace, randomUUID()]));
    });

    await check('OAuth state is consumed once and expired states disclose nothing', async () => {
      await as('service_role');
      for (const [hash, lifetime] of [['a'.repeat(64), '10 minutes'], ['b'.repeat(64), '-1 minute']]) {
        await db.query(`insert into google_calendar_oauth_states(state_hash,workspace_id,user_id,expected_email,code_verifier,expires_at)
          values($1,$2,$3,'owner@example.invalid','encrypted-test-verifier',now()+$4::interval)`, [hash, workspace, user, lifetime]);
      }
      const consume = hash => db.query('select * from consume_google_calendar_oauth_state($1)', [hash]);
      const first = await consume('a'.repeat(64));
      assert.equal(first.rows.length, 1);
      assert.equal(first.rows[0].workspace_id, workspace);
      assert.equal((await consume('a'.repeat(64))).rows.length, 0);
      assert.equal((await consume('b'.repeat(64))).rows.length, 0);
      assert.equal(await scalar('select count(*)::int from google_calendar_oauth_states'), 0);
    });

    await check('atomic connection rejects retargeting, preserves enrollment date and reuses only the same account token', async () => {
      const complete = (patch = {}) => scalar('select complete_google_calendar_connection($1,$2,$3,$4,$5,$6,$7)', [
        workspace, user, patch.subject || 'synthetic-subject', patch.email || 'OWNER@example.invalid',
        patch.calendar || 'calendar@example.invalid', Object.hasOwn(patch, 'token') ? patch.token : 'encrypted-first-token',
        'calendar-scope',
      ]);
      const invalid = async run => {
        await db.exec('savepoint invalid_connection');
        await assert.rejects(run, error => error.code === '22023');
        await db.exec('rollback to savepoint invalid_connection');
      };
      await as('service_role');
      await invalid(() => complete({ token: null }));
      assert.equal(await complete(), true);
      const first = (await db.query('select * from google_calendar_connections where workspace_id=$1', [workspace])).rows[0];
      assert.equal(first.google_email, 'owner@example.invalid');
      await db.query("update google_calendar_connections set status='paused',last_error='Old failure' where workspace_id=$1", [workspace]);
      assert.equal(await complete({ token: null }), true);
      const second = (await db.query('select * from google_calendar_connections where workspace_id=$1', [workspace])).rows[0];
      assert.deepEqual(second.sync_from, first.sync_from);
      assert.equal(second.refresh_token_encrypted, 'encrypted-first-token');
      assert.equal(second.status, 'connected');
      assert.equal(second.last_error, null);
      for (const patch of [{ subject: 'other-subject' }, { email: 'other@example.invalid' }, { calendar: 'other-calendar@example.invalid' }]) {
        await invalid(() => complete(patch));
      }
      assert.equal(await complete({ token: 'encrypted-rotated-token' }), true);
      assert.equal(await scalar('select refresh_token_encrypted from google_calendar_connections'), 'encrypted-rotated-token');
      await as('postgres');
      await db.exec('grant execute on function complete_google_calendar_connection(uuid,uuid,text,text,text,text,text) to authenticated');
      await as('authenticated');
      await denied(() => complete());
    });

    await check('connection requires current owner/admin membership of an active workspace', async () => {
      const complete = () => scalar('select complete_google_calendar_connection($1,$2,$3,$4,$5,$6,$7)', [
        workspace, user, 'synthetic-subject', 'owner@example.invalid', 'calendar@example.invalid', 'encrypted-token', 'calendar-scope',
      ]);
      for (const mutation of [
        "update workspace_members set role='member'",
        'update workspace_members set active=false',
        'update workspaces set active=false',
      ]) {
        await as('postgres');
        await db.exec('savepoint membership_check');
        await db.exec(mutation);
        await as('service_role');
        await denied(complete);
        await as('postgres');
        await db.exec('rollback to savepoint membership_check');
      }
      await as('postgres');
      await db.query("update workspace_members set role='admin' where workspace_id=$1 and user_id=$2", [workspace, user]);
      await as('service_role');
      assert.equal(await complete(), true);
    });

    await check('in-flight updates preserve the lease and old completion leaves new content pending', async () => {
      await connect();
      const id = await seed();
      const first = (await claim())[0];
      await as('authenticated');
      await db.query("update appointments set scheduled_time='10:00' where id=$1", [id]);
      const dirty = await queued(id);
      assert.equal(dirty.lease_token, first.lease_token);
      assert.equal(dirty.desired_version, 2);
      assert.equal((await claim()).length, 0);
      assert.equal(await finish(first), true);
      const after = await queued(id);
      assert.equal(after.synced_version, 1);
      assert.equal(after.desired_version, 2);
      const second = (await claim())[0];
      assert.equal(second.lease_version, 2);
      assert.equal(second.event_id, 'synthetic-event-id');
      assert.notEqual(second.lease_token, first.lease_token);
      assert.equal(await finish(first, { eventId: 'stale-event-id' }), false);
      assert.equal(await finish(second), true);
      assert.equal((await claim()).length, 0);
    });

    await check('expired leases are reclaimable and late writers cannot overwrite the new lease', async () => {
      await connect();
      const id = await seed();
      const abandoned = (await claim())[0];
      await as('postgres');
      await db.query("update google_calendar_sync_queue set lease_expires_at=now()-interval '1 second' where appointment_id=$1", [id]);
      const recovered = (await claim())[0];
      assert.notEqual(recovered.lease_token, abandoned.lease_token);
      assert.equal(await finish(abandoned), false);
      assert.equal(await finish(recovered, { version: 99 }), false);
      assert.equal(await finish(recovered, { generation: 1 }), true);
      assert.equal((await queued(id)).event_generation, 1);
    });

    await check('retry preserves remote identity and new edits bypass stale backoff', async () => {
      await connect();
      const id = await seed();
      const first = (await claim())[0];
      assert.equal(await finish(first, { success: false, generation: 2, error: 'Temporary unavailable', retry: 600 }), true);
      assert.equal((await claim()).length, 0);
      const failed = await queued(id);
      assert.equal(failed.synced_version, 0);
      assert.equal(failed.event_generation, 2);
      assert.equal(failed.last_error, 'Temporary unavailable');
      await as('postgres');
      await db.query("update appointments set notes='new content' where id=$1", [id]);
      const second = (await claim())[0];
      assert.equal(second.event_generation, 2);
      assert.equal(await finish(second, { generation: 1 }), false);
      assert.equal(await finish(second, { generation: 2 }), true);
    });

    await check('cancellation and deletion retain the exact managed remote event for cleanup', async () => {
      await connect();
      const id = await seed();
      await finish((await claim())[0]);
      await as('postgres');
      await db.query("update appointments set cancelled_at=now(),status='Lemondva' where id=$1", [id]);
      const cancelled = (await claim())[0];
      assert.equal(cancelled.appointment_deleted, false);
      assert.equal(cancelled.event_id, 'synthetic-event-id');
      await finish(cancelled, { deleted: true });
      await as('postgres');
      await db.query('delete from appointments where id=$1', [id]);
      const removed = (await claim())[0];
      assert.equal(removed.appointment_deleted, true);
      assert.equal(removed.remote_deleted, true);
      assert.equal(removed.event_id, 'synthetic-event-id');
      await finish(removed, { deleted: true });
      assert.equal((await claim()).length, 0);
    });

    await check('customer contact and quote contents refresh only related eligible appointments', async () => {
      await connect();
      const id = await seed({ quoteId: quote });
      await as('postgres');
      await db.query("update customers set phone='+36 30 000 0000' where id=$1", [customer]);
      assert.equal((await queued(id)).desired_version, 2);
      await as('postgres');
      await db.query('update customers set stock_deducted=true where id=$1', [customer]);
      assert.equal((await queued(id)).desired_version, 2);
      await as('postgres');
      await db.query("update quotes set notes='new quote' where id=$1", [quote]);
      assert.equal((await queued(id)).desired_version, 3);
      await as('postgres');
      await db.query('update quote_items set quantity=3 where quote_id=$1', [quote]);
      assert.equal((await queued(id)).desired_version, 4);
      await as('postgres');
      await db.query('update appointments set updated_at=now() where id=$1', [id]);
      await db.query("update customers set name='Other workspace edit' where id=$1", [foreignCustomer]);
      assert.equal((await queued(id)).desired_version, 4);
      assert.equal(await scalar('select count(*)::int from google_calendar_sync_queue'), 1);
    });

    await check('paused/reauth/inactive scopes retain pending work but are never claimed', async () => {
      await connect(workspace, 'paused');
      const id = await seed();
      assert.ok(await queued(id));
      assert.equal((await claim()).length, 0);
      await db.query("update google_calendar_connections set status='reauth_required' where workspace_id=$1", [workspace]);
      assert.equal((await claim()).length, 0);
      await db.query("update google_calendar_connections set status='connected' where workspace_id=$1", [workspace]);
      await as('postgres');
      await db.query('update workspaces set active=false where id=$1', [workspace]);
      assert.equal((await claim()).length, 0);
      await as('postgres');
      await db.query('update workspaces set active=true where id=$1', [workspace]);
      assert.equal((await claim()).length, 1);
    });

    await check('scoped status exposes managed IDs and counts without account secrets', async () => {
      await connect();
      await connect(foreignWorkspace);
      const id = await seed();
      await seed({ ws: foreignWorkspace });
      await finish((await claim())[0], { success: false, error: 'Temporary unavailable' });
      const status = await scalar('select google_calendar_sync_status($1)', [workspace]);
      assert.deepEqual(status, { pending_count: 1, last_error: 'Temporary unavailable', managed_appointment_ids: [id] });
      const other = await claim(foreignWorkspace);
      assert.equal(other.length, 1);
      assert.equal(other[0].workspace_id, foreignWorkspace);
    });

    await check('cron preflight accepts Supabase net grants only with verified API isolation', async () => {
      const cron = fs.readFileSync(path.join(repo, 'docs/sql/GOOGLE_CALENDAR_CRON.sql'), 'utf8');
      const block = cron.match(/do \$api_access\$[\s\S]*?\$api_access\$;/)?.[0];
      assert.ok(block);
      await db.exec(`create role authenticator login;
        create schema vault; create schema net;
        create table vault.decrypted_secrets(decrypted_secret text);
        create table net.http_request_queue(headers jsonb);
        grant usage on schema net to public;
        grant all on net.http_request_queue to public;`);
      const preflight = () => db.exec(block);
      const rejectPreflight = async pattern => {
        await db.exec('savepoint rejected_preflight');
        await assert.rejects(preflight, pattern);
        await db.exec('rollback to savepoint rejected_preflight');
      };
      await rejectPreflight(/schemas are unknown/);
      // A setting in this SQL Editor session does not prove PostgREST's setting.
      await db.exec("set local pgrst.db_schemas='public'");
      await rejectPreflight(/schemas are unknown/);
      await db.exec("set local alinflow.calendar_net_schema_not_exposed='confirmed'");
      await preflight();
      await db.exec("set local alinflow.calendar_net_schema_not_exposed=''; alter role authenticator set pgrst.db_schemas='public, graphql_public'");
      await preflight();
      for (const schemas of ['public,net', 'public,vault', 'public,"net"']) {
        await db.query("select set_config('alinflow.calendar_net_schema_not_exposed','confirmed',true)");
        await db.exec(`alter role authenticator set pgrst.db_schemas='${schemas}'`);
        await rejectPreflight(/unsafe or unrecognized/);
      }
      await db.exec("alter role authenticator set pgrst.db_schemas='public'; set local alinflow.calendar_net_schema_not_exposed=''");
      await db.exec(`do $$begin execute format('alter role authenticator in database %I set pgrst.db_schemas=%L',current_database(),'public,net'); end$$`);
      await rejectPreflight(/unsafe or unrecognized/);
      await db.exec("alter role authenticator set pgrst.db_schemas='public,net'");
      await db.exec(`do $$begin execute format('alter role authenticator in database %I set pgrst.db_schemas=%L',current_database(),'public'); end$$`);
      await preflight();
      await db.exec('alter role authenticated login');
      await rejectPreflight(/application role can log in/);
      await db.exec('alter role authenticated nologin; grant select on vault.decrypted_secrets to authenticated');
      await rejectPreflight(/Vault secrets/);
      await db.exec('revoke select on vault.decrypted_secrets from authenticated');
      await preflight();
      // The preflight must never rewrite Supabase-owned object privileges.
      assert.equal(await scalar("select has_column_privilege('authenticated','net.http_request_queue','headers','SELECT')"), true);
      assert.equal(await scalar("select has_table_privilege('anon','net.http_request_queue','DELETE')"), true);
    });

    await check('optional cron dispatcher only wakes pending work and cannot be invoked by API roles', async () => {
      // Execute the production SQL function against fake Vault/pg_net boundaries;
      // this does not emulate extension installation or make an HTTP request.
      const cron = fs.readFileSync(path.join(repo, 'docs/sql/GOOGLE_CALENDAR_CRON.sql'), 'utf8');
      const start = cron.indexOf('create or replace function public.dispatch_google_calendar_sync()');
      const end = cron.indexOf("select cron.schedule('alinflow-google-calendar-sync'");
      assert.ok(start > 0 && end > start);
      await db.exec(`create schema vault; create schema net;
        create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
        create table net.http_request_queue(id bigint generated always as identity primary key,url text,headers jsonb,body jsonb,timeout integer);
        create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,
          headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 2000)
        returns bigint language sql as $$insert into net.http_request_queue(url,headers,body,timeout)
          values(url,headers,body,timeout_milliseconds) returning id$$;
        insert into vault.decrypted_secrets values('alinflow_app_url','https://app.example.invalid'),
          ('alinflow_google_calendar_cron_secret','synthetic-test-token-at-least-32-characters');`);
      await db.exec(cron.slice(start, end));
      const dispatch = () => scalar('select public.dispatch_google_calendar_sync()');
      assert.equal(await dispatch(), null);
      await connect(workspace, 'paused');
      await seed();
      assert.equal(await dispatch(), null);
      await as('service_role');
      await db.query("update google_calendar_connections set status='connected' where workspace_id=$1", [workspace]);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        await as(role);
        await denied(dispatch);
      }
      await as('postgres');
      assert.equal(await dispatch(), 1);
      const outbound = (await db.query('select * from net.http_request_queue')).rows[0];
      assert.equal(outbound.url, 'https://app.example.invalid/api/google-calendar/cron');
      assert.equal(outbound.headers.Authorization, 'Bearer synthetic-test-token-at-least-32-characters');
      assert.equal(outbound.timeout, 55000);
      assert.deepEqual(outbound.body, {});
      await claim();
      await as('postgres');
      assert.equal(await dispatch(), null);
      await db.exec("update google_calendar_sync_queue set lease_expires_at=now()-interval '1 second'");
      for (const invalid of ['http://app.example.invalid','https://app.example.invalid/redirect','https://user@evil.invalid','https://app.example.invalid?redirect=1']) {
        await db.query("update vault.decrypted_secrets set decrypted_secret=$1 where name='alinflow_app_url'", [invalid]);
        await db.exec('savepoint invalid_cron');
        await assert.rejects(dispatch, /Vault configuration/);
        await db.exec('rollback to savepoint invalid_cron');
      }
      assert.equal(await scalar('select count(*)::int from net.http_request_queue'), 1);
    });

    await t.test('migration rerun preserves pending queue data and private privileges', async () => {
      await connect();
      const id = await seed();
      const before = await queued(id);
      await as('postgres');
      await db.exec(migration);
      assert.deepEqual(await queued(id), before);
      await as('postgres');
      assert.equal(await scalar("select has_table_privilege('authenticated','google_calendar_connections','SELECT')"), false);
      assert.equal(await scalar("select has_function_privilege('authenticated','claim_google_calendar_sync(uuid,integer,integer)','EXECUTE')"), false);
      assert.equal(await scalar('select count(*)::int from work_reports'), 1);
    });
  } finally { await db.close(); }
});
