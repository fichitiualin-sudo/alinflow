import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Isolated PostgreSQL runtime; synthetic fixtures only, never connects to Supabase.
// npm install --prefix .photo-test --no-package-lock --no-audit --no-fund @electric-sql/pglite
// node tests/maintenance-origin-sql.test.mjs
const require = createRequire(import.meta.url);
const { PGlite } = process.env.PGLITE_MODULE_PATH
  ? require(process.env.PGLITE_MODULE_PATH)
  : createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');
const db = new PGlite();
const migration = await readFile(new URL('../docs/sql/20261011_ADD_MAINTENANCE_ORIGIN.sql', import.meta.url), 'utf8');
const verify = await readFile(new URL('../docs/sql/20261011_VERIFY_MAINTENANCE_ORIGIN.sql', import.meta.url), 'utf8');
const pre = verify.split('-- POST ONLY:')[0];
const workspace = '10000000-0000-0000-0000-000000000001';
const foreignWorkspace = '10000000-0000-0000-0000-000000000002';
const user = '90000000-0000-0000-0000-000000000001';
const otherUser = '90000000-0000-0000-0000-000000000002';
const customer = '20000000-0000-0000-0000-000000000001';
const foreignCustomer = '20000000-0000-0000-0000-000000000002';
const installation = '40000000-0000-0000-0000-000000000003';
const survey = '40000000-0000-0000-0000-000000000004';
let passed = 0;
async function check(label, fn) { await fn(); passed++; console.log(`PASS ${label}`); }
async function as(role, actor = '') {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
}
async function row(id) { return (await db.query('select * from appointments where id=$1', [id])).rows[0]; }
const denied = (promise, code = '23514') => assert.rejects(promise, error => error.code === code);
const classify = (id, origin, label = null) => db.query(
  'update appointments set maintenance_origin=$2,maintenance_source_name=$3 where id=$1 returning id', [id, origin, label]);
async function seed(type = 'installation', scope = workspace) {
  const id = randomUUID();
  await db.query(`insert into appointments(id,workspace_id,customer_id,appointment_type,scheduled_date,scheduled_time,status)
    values($1,$2,$3,$4,'2026-10-11','08:00','Lezárva')`, [id, scope, scope === workspace ? customer : foreignCustomer, type]);
  return id;
}

try {
  await db.exec(await readFile(new URL('./fixtures/schema.sql', import.meta.url), 'utf8'));
  const priorSql = await readFile(new URL('../docs/sql/20260723_ADD_WORKSPACE_ISOLATION.sql', import.meta.url), 'utf8');
  await db.exec(priorSql.match(/create or replace function public.save_appointment_with_job_mirror[\s\S]*?\$\$;/)[0]);
  const prior = (await db.exec(pre)).map(result => result.rows);
  await check('repeated migration preserves all original data, policies, grants and triggers', async () => {
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(migration.replace(/\r?\n/g, '\r\n'));
    const after = (await db.exec(pre)).map(result => result.rows);
    assert.deepEqual(after.slice(0, -1), prior.slice(0, -1));
    const rows = (await db.query('select maintenance_origin,maintenance_source_name from appointments')).rows;
    assert.ok(rows.length > 0);
    assert.ok(rows.every(item => item.maintenance_origin === 'own' && item.maintenance_source_name === null));
  });
  await check('read-only verification validates the new schema and defaults', async () => {
    const checks = (await db.exec(verify)).flatMap(result => result.rows).filter(result => 'check_name' in result);
    assert.equal(checks.length, 7);
    assert.ok(checks.every(result => result.passed === true), JSON.stringify(checks));
  });
  const foreignInstallation = await seed('installation', foreignWorkspace);
  await as('authenticated', user);
  await check('old callers creating installations or maintenance receive safe own/null defaults', async () => {
    for (const type of ['installation', 'maintenance', 'survey', null]) {
      const created = await row(await seed(type));
      assert.equal(created.maintenance_origin, 'own');
      assert.equal(created.maintenance_source_name, null);
    }
  });
  await check('classification changes only the selected installation and leaves reports and quotes intact', async () => {
    const before = (await db.exec(pre))[0].rows;
    const otherRows = (await db.query('select * from appointments where id<>$1 order by id', [installation])).rows;
    await classify(installation, 'external', 'Másik cég / őrzött forrás');
    const saved = await row(installation);
    assert.equal(saved.maintenance_origin, 'external');
    assert.equal(saved.maintenance_source_name, 'Másik cég / őrzött forrás');
    assert.deepEqual((await db.exec(pre))[0].rows, before);
    assert.deepEqual((await db.query('select * from appointments where id<>$1 order by id', [installation])).rows, otherRows);
  });
  await check('external label is optional and valid 160-character Unicode text round-trips', async () => {
    await classify(installation, 'external');
    assert.equal((await row(installation)).maintenance_source_name, null);
    await classify(installation, 'external', 'ő'.repeat(160));
    assert.equal((await row(installation)).maintenance_source_name, 'ő'.repeat(160));
  });
  await check('unknown/null origins and invalid, untrimmed or control-character labels are rejected', async () => {
    await denied(classify(installation, 'partner'));
    await denied(classify(installation, null), '23502');
    for (const label of ['', ' ', ' név', 'név ', 'x'.repeat(161), '\tnév', 'név\n', 'név\tadat', '\u000bnév']) {
      await denied(classify(installation, 'external', label));
    }
    assert.equal((await row(installation)).maintenance_source_name, 'ő'.repeat(160));
  });
  await check('returning to own requires clearing the external label in the same save', async () => {
    await denied(db.query("update appointments set maintenance_origin='own' where id=$1", [installation]));
    await classify(installation, 'own');
    assert.equal((await row(installation)).maintenance_source_name, null);
    await denied(classify(installation, 'own', 'Nem külső'));
  });
  await check('external is installation-only and supports historical null type normalized as installation', async () => {
    await denied(classify(survey, 'external'));
    const maintenance = await seed('maintenance');
    await denied(classify(maintenance, 'external'));
    const legacy = await seed(null);
    await classify(legacy, 'external', 'Régi telepítés');
    assert.equal((await row(legacy)).maintenance_origin, 'external');
    await denied(db.query("update appointments set appointment_type='maintenance' where id=$1", [legacy]));
    assert.equal((await row(legacy)).appointment_type, null);
  });
  await check('existing appointment RPC preserves classification through rescheduling and new maintenance', async () => {
    const external = await seed();
    await classify(external, 'external', 'Külső telepítő');
    const args = [external, customer, null, 'Telepítés', '2026-10-12', '09:00', 'installation', 'Lezárva', 'Teszt cím', '', user, workspace];
    const rpc = 'select * from save_appointment_with_job_mirror($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)';
    await db.query(rpc, args);
    assert.equal((await row(external)).maintenance_source_name, 'Külső telepítő');
    const maintenanceArgs = [...args]; maintenanceArgs[0] = null; maintenanceArgs[6] = 'maintenance';
    const created = (await db.query(rpc, maintenanceArgs)).rows[0].appointment_id;
    assert.equal((await row(created)).maintenance_origin, 'own');
    assert.equal((await row(created)).maintenance_source_name, null);
    assert.equal((await row(external)).maintenance_origin, 'external');
  });
  await check('source text grants no foreign workspace read, update or insert access', async () => {
    await classify(installation, 'external', foreignWorkspace);
    assert.equal(await row(foreignInstallation), undefined);
    assert.equal((await classify(foreignInstallation, 'external', 'Attempt')).rows.length, 0);
    await denied(seed('installation', foreignWorkspace), '42501');
    await as('authenticated', otherUser);
    assert.equal(await row(installation), undefined);
    assert.equal((await classify(installation, 'own')).rows.length, 0);
  });
  await check('inactive members and anonymous users cannot access classified records', async () => {
    await as('postgres');
    await db.query('update workspace_members set active=false where user_id=$1', [user]);
    await as('authenticated', user);
    assert.equal(await row(installation), undefined);
    assert.equal((await classify(installation, 'own')).rows.length, 0);
    await as('anon');
    await denied(db.query('select * from appointments'), '42501');
    await denied(classify(installation, 'own'), '42501');
    await as('postgres');
    await db.query('update workspace_members set active=true where user_id=$1', [user]);
  });
  await check('reapplying migration preserves saved classifications and every other field', async () => {
    const before = (await db.query('select * from appointments order by id')).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from appointments order by id')).rows, before);
    const checks = (await db.exec(verify)).flatMap(result => result.rows).filter(result => 'check_name' in result);
    assert.ok(checks.every(result => result.passed === true));
  });
  console.log(`${passed} maintenance origin SQL integration checks passed.`);
} finally { await db.close(); }
