import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Disposable local PostgreSQL; no Google or Supabase connection.
// node tests/maintenance-origin-calendar-sql.test.mjs
const require = createRequire(import.meta.url);
const { PGlite } = process.env.PGLITE_MODULE_PATH
  ? require(process.env.PGLITE_MODULE_PATH)
  : createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');
const db = new PGlite();
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const patch = await read('../docs/sql/20261011_EXCLUDE_MAINTENANCE_ORIGIN_FROM_CALENDAR.sql');
const workspace = '10000000-0000-0000-0000-000000000001';
const foreignWorkspace = '10000000-0000-0000-0000-000000000002';
const customer = '20000000-0000-0000-0000-000000000001';
const user = '90000000-0000-0000-0000-000000000001';
const functionName = 'public.queue_google_calendar_appointment_change()';
const metadata = async () => (await db.query("select to_jsonb(p)-'prosrc' as metadata from pg_proc p where oid=$1::regprocedure", [functionName])).rows[0].metadata;
const queue = async id => (await db.query('select * from google_calendar_sync_queue where appointment_id=$1', [id])).rows[0];
const version = async id => (await queue(id)).desired_version;
async function seed() {
  const id = randomUUID();
  await db.query(`insert into appointments(id,workspace_id,customer_id,scheduled_date,scheduled_time,appointment_type,status)
    values($1,$2,$3,'2026-10-11','08:00','installation','Lezárva')`, [id, workspace, customer]);
  return id;
}
let passed = 0;
async function check(label, fn) { await fn(); passed++; console.log(`PASS ${label}`); }
try {
  await db.exec(await read('./fixtures/schema.sql'));
  await check('migration safely skips an absent calendar trigger function', async () => {
    await db.exec(patch);
    assert.equal((await db.query('select to_regprocedure($1) is null as absent', [functionName])).rows[0].absent, true);
  });
  await db.exec(`create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${user}');
    create table workspaces(id uuid primary key,active boolean not null default true);
    insert into workspaces(id) values('${workspace}'),('${foreignWorkspace}');
    alter table workspace_members add column role text not null default 'owner';
    alter table customers add column phone text,add column city text,add column address text;
    grant usage on schema public,auth to service_role;`);
  await db.exec(await read('../docs/sql/GOOGLE_CALENDAR_SYNC.sql'));
  await db.exec(await read('../docs/sql/20261011_ADD_MAINTENANCE_ORIGIN.sql'));
  await db.query(`insert into google_calendar_connections(workspace_id,connected_by,google_subject,google_email,
    calendar_id,refresh_token_encrypted,scope,sync_from) values($1,$2,'synthetic','test@example.invalid',
    'test@example.invalid','synthetic-encrypted','calendar','2020-01-01')`, [workspace, user]);
  const id = await seed();
  await check('canonical trigger demonstrates metadata edits previously enqueued a sync', async () => {
    assert.equal(await version(id), 1);
    await db.query("update appointments set maintenance_origin='external' where id=$1", [id]);
    assert.equal(await version(id), 2);
  });
  const originalMetadata = await metadata();
  const originalTriggers = (await db.query("select tgname,tgenabled,pg_get_triggerdef(oid) from pg_trigger where tgrelid='appointments'::regclass order by tgname")).rows;
  await check('repeat application changes only the comparison and preserves all function metadata/ACLs', async () => {
    const originalDefinition = (await db.query('select pg_get_functiondef($1::regprocedure) as definition', [functionName])).rows[0].definition;
    const originalQueue = await queue(id);
    await db.exec(patch);
    await db.exec(patch);
    await db.exec(patch.replace(/\r?\n/g, '\r\n'));
    assert.deepEqual(await metadata(), originalMetadata);
    assert.deepEqual(await queue(id), originalQueue);
    assert.deepEqual((await db.query("select tgname,tgenabled,pg_get_triggerdef(oid) from pg_trigger where tgrelid='appointments'::regclass order by tgname")).rows, originalTriggers);
    const updated = (await db.query('select pg_get_functiondef($1::regprocedure) as definition', [functionName])).rows[0].definition;
    assert.equal(updated, originalDefinition.replaceAll("to_jsonb(new)-'updated_at'", "to_jsonb(new)-array['updated_at','maintenance_origin','maintenance_source_name']")
      .replaceAll("to_jsonb(old)-'updated_at'", "to_jsonb(old)-array['updated_at','maintenance_origin','maintenance_source_name']"));
  });
  await check('origin/source changes including updated_at never alter the existing queue row', async () => {
    const before = await queue(id);
    await db.query("update appointments set maintenance_source_name='Külső telepítő',updated_at=clock_timestamp() where id=$1", [id]);
    await db.query("update appointments set maintenance_origin='own',maintenance_source_name=null,updated_at=clock_timestamp() where id=$1", [id]);
    await db.query("update appointments set maintenance_origin='external',maintenance_source_name='Másik cég' where id=$1", [id]);
    assert.deepEqual(await queue(id), before);
  });
  await check('classification alone does not create a queue entry for previously unenqueued work', async () => {
    const old = '40000000-0000-0000-0000-000000000003';
    assert.equal(await queue(old), undefined);
    await db.query("update appointments set maintenance_origin='external',maintenance_source_name='Forrás' where id=$1", [old]);
    assert.equal(await queue(old), undefined);
  });
  await check('date/status changes still enqueue, including changes combined with origin labels', async () => {
    const before = await version(id);
    await db.query("update appointments set scheduled_date='2026-10-12' where id=$1", [id]);
    assert.equal(await version(id), before + 1);
    await db.query("update appointments set status='Lemondva',maintenance_source_name='Új forrás',updated_at=clock_timestamp() where id=$1", [id]);
    assert.equal(await version(id), before + 2);
  });
  await check('inserts and deletion retain their original queue behavior', async () => {
    const created = await seed();
    assert.equal(await version(created), 1);
    await db.query('delete from appointments where id=$1', [created]);
    assert.equal(await version(created), 2);
    assert.equal((await queue(created)).appointment_deleted, true);
  });
  await check('unknown installed comparison fails safely and preserves its definition', async () => {
    const definition = (await db.query('select pg_get_functiondef($1::regprocedure) as definition', [functionName])).rows[0].definition;
    const unexpected = definition.replaceAll("array['updated_at','maintenance_origin','maintenance_source_name']", "array['updated_at','unexpected_column']");
    await db.exec(unexpected);
    await assert.rejects(db.exec(patch), /Unexpected Google Calendar trigger comparison/);
    await db.exec('rollback');
    assert.equal((await db.query('select pg_get_functiondef($1::regprocedure) as definition', [functionName])).rows[0].definition, unexpected);
    assert.deepEqual(await metadata(), originalMetadata);
  });
  console.log(`${passed} maintenance origin calendar SQL checks passed.`);
} finally { await db.close(); }
