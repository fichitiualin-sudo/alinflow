import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Isolated optional PostgreSQL runtime, like the other *.test.mjs SQL tests.
// npm install --prefix .photo-test --no-package-lock --no-audit --no-fund @electric-sql/pglite
// node tests/work-report-privacy-sql.test.mjs (never contacts Supabase)
const { PGlite } = createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');
const db = new PGlite();
const migration = await readFile(new URL('../docs/sql/WORK_REPORT_PRIVACY_NOTICE.sql', import.meta.url), 'utf8')
  + '\n' + await readFile(new URL('../docs/sql/MAINTENANCE_PRIVACY_NOTICE.sql', import.meta.url), 'utf8');
const user = randomUUID(), other = randomUUID(), workspace = randomUUID(), foreignWorkspace = randomUUID();
const customer = randomUUID(), foreignCustomer = randomUUID(), appointment = randomUUID();
const signature = 'data:image/png;base64,c2lnbmF0dXJl';
const signedAt = '2026-10-11T12:00:00.000Z';
const party = { legalName: 'Teszt vállalkozás', address: '1000 Teszt, Utca 1.', email: 'test@example.test', phone: '', taxNumber: '' };
const notice = (patch = {}) => ({
  version: '2026-10-11.1',
  controllers: [{ role: 'device_seller', party }, { role: 'service_provider', party: { ...party, legalName: 'Teszt EV' } }],
  partner: { ...party, legalName: 'Karbantartó EV' },
  customer: { name: 'Teszt ügyfél', address: '1000 Teszt, Utca 2.', phone: '', email: 'customer@example.test' },
  sections: [{ title: 'Tájékoztatás', text: 'Kizárólag tesztadat.' }],
  consentText: 'Kizárólag karbantartás céljából.', consentGranted: true,
  signatureDataUrl: signature, signerName: 'Teszt ügyfél', signedAt, ...patch,
});
let passed = 0;
async function check(label, fn) { await fn(); passed++; console.log(`PASS ${label}`); }
async function as(role, actor = '') {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
}
async function seed(snapshot = null, scope = workspace, appointmentType = 'installation') {
  const id = randomUUID();
  await db.query(`insert into work_reports(id,workspace_id,customer_id,appointment_id,signer_name,signed_at,signature_data_url,privacy_notice,appointment_type)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, scope, scope === workspace ? customer : foreignCustomer, appointment,
    snapshot?.signerName ?? 'Teszt ügyfél', snapshot?.signedAt ?? signedAt, snapshot?.signatureDataUrl ?? signature, snapshot, appointmentType]);
  return id;
}
const denied = (promise, code = '23514') => assert.rejects(promise, error => error.code === code);
async function row(id) { return (await db.query('select * from work_reports where id=$1', [id])).rows[0]; }
async function history(id) { return (await db.query('select * from work_report_privacy_history where work_report_id=$1 order by recorded_at,id', [id])).rows; }
async function replace(id, snapshot) {
  return db.query('update work_reports set privacy_notice=$2,signer_name=$3,signed_at=$4,signature_data_url=$5 where id=$1',
    [id, snapshot, snapshot.signerName, snapshot.signedAt, snapshot.signatureDataUrl]);
}

try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table workspace_members(workspace_id uuid, user_id uuid, active boolean not null, primary key(workspace_id,user_id));
    create table customers(id uuid primary key, workspace_id uuid not null);
    create table work_reports(id uuid primary key, workspace_id uuid not null, customer_id uuid not null references customers(id) on delete cascade,
      appointment_id uuid, appointment_type text, signer_name text, signed_at timestamptz, signature_data_url text, notes text);
    grant usage on schema public,auth to anon,authenticated;
    grant select on workspace_members to authenticated;
    alter table workspace_members enable row level security;
    create policy member_self on workspace_members for select to authenticated using(user_id=auth.uid());
    alter table work_reports enable row level security;
    grant select,insert,update,delete on work_reports to authenticated;
    create policy original_member_all on work_reports for all to authenticated
      using(exists(select 1 from workspace_members wm where wm.workspace_id=work_reports.workspace_id and wm.user_id=auth.uid() and wm.active))
      with check(exists(select 1 from workspace_members wm where wm.workspace_id=work_reports.workspace_id and wm.user_id=auth.uid() and wm.active));
  `);
  await db.query('insert into workspace_members values($1,$2,true),($3,$4,true)', [workspace, user, foreignWorkspace, other]);
  await db.query('insert into customers values($1,$2),($3,$4)', [customer, workspace, foreignCustomer, foreignWorkspace]);
  const legacyId = randomUUID();
  await db.query('insert into work_reports(id,workspace_id,customer_id,signer_name,signed_at,signature_data_url) values($1,$2,$3,$4,$5,$6)',
    [legacyId, workspace, customer, 'Teszt ügyfél', signedAt, signature]);
  const originalPolicies = (await db.query("select policyname,cmd,roles,qual,with_check from pg_policies where tablename='work_reports'")).rows;
  await check('migration is repeatable and never creates a notice from a legacy signature', async () => {
    await db.exec(migration); await db.exec(migration); await db.exec(migration.replace(/\r?\n/g, '\r\n'));
    assert.equal((await row(legacyId)).privacy_notice, null);
    assert.equal((await row(legacyId)).signature_data_url, signature);
    assert.equal((await db.query('select count(*)::int n from work_report_privacy_history')).rows[0].n, 0);
    assert.deepEqual((await db.query("select policyname,cmd,roles,qual,with_check from pg_policies where tablename='work_reports'")).rows, originalPolicies);
  });
  await check('audit is member-read-only with a private definer trigger and no cascading foreign keys', async () => {
    const rights = (await db.query(`select
      has_table_privilege('authenticated','work_report_privacy_history','SELECT') can_read,
      has_table_privilege('authenticated','work_report_privacy_history','INSERT,UPDATE,DELETE,TRUNCATE') can_write,
      has_table_privilege('anon','work_report_privacy_history','SELECT,INSERT,UPDATE,DELETE') anon_access,
      has_function_privilege('authenticated','guard_work_report_privacy_notice()','EXECUTE') direct_trigger,
      p.prosecdef,p.proconfig from pg_proc p where p.oid='guard_work_report_privacy_notice()'::regprocedure`)).rows[0];
    assert.equal(rights.can_read, true); assert.equal(rights.can_write, false); assert.equal(rights.anon_access, false);
    assert.equal(rights.direct_trigger, false); assert.equal(rights.prosecdef, true);
    assert.ok(rights.proconfig.includes('search_path=""')); assert.ok(rights.proconfig.includes('row_security=off'));
    assert.equal((await db.query("select count(*)::int n from pg_constraint where conrelid='work_report_privacy_history'::regclass and contype='f'")).rows[0].n, 0);
  });
  await as('authenticated', user);
  await check('old signed report accepts unrelated updates but not retroactive notice attachment', async () => {
    await db.query("update work_reports set notes='változatlan régi aláírás' where id=$1", [legacyId]);
    await denied(db.query('update work_reports set privacy_notice=$2 where id=$1', [legacyId, notice()]));
    assert.equal((await row(legacyId)).privacy_notice, null);
  });
  let signedId;
  await check('new signed snapshot persists exactly and a repeat save does not duplicate audit history', async () => {
    signedId = await seed(notice());
    assert.deepEqual((await row(signedId)).privacy_notice, notice());
    await replace(signedId, notice());
    await db.query("update work_reports set notes='későbbi munkalapváltozás' where id=$1", [signedId]);
    assert.equal((await history(signedId)).length, 0);
  });
  await check('signature, signer and timestamp must match the actual saved report', async () => {
    for (const patch of [{ signedAt: '2026-10-11T13:00:00Z' }, { signatureDataUrl: 'data:image/png;base64,b3RoZXI=' }, { signerName: 'Másik aláíró' }]) {
      await denied(db.query('update work_reports set privacy_notice=$2 where id=$1', [signedId, notice(patch)]));
    }
    await denied(db.query('update work_reports set signed_at=null where id=$1', [signedId]));
    await denied(db.query("update work_reports set signer_name='másik' where id=$1", [signedId]));
  });
  await check('strict shape rejects extra data, missing partners, malformed nested fields and unknown versions', async () => {
    const invalid = [
      { secretPurchasePrice: 100 }, { consentGranted: 'true' }, { consentGranted: true, partner: null },
      { version: 'unknown' }, { sections: [] }, { sections: [{ title: 'T', text: 'T', hidden: true }] },
      { controllers: [{ role: 'device_seller', party }, { role: 'device_seller', party }] },
      { controllers: [{ role: 'device_seller', party }] }, { controllers: {} },
      { partner: { ...party, email: 'bad' } }, { customer: { ...notice().customer, privateCost: 1 } },
      { customer: { ...notice().customer, address: '' } }, { partner: { ...party, taxNumber: 123 } },
      { consentText: 'x'.repeat(4001) }, { customer: { ...notice().customer, name: 'x'.repeat(301) } },
      { sections: Array.from({ length: 5 }, () => ({ title: 'T', text: 'x'.repeat(4001) })) },
      { consentText: 'Control\u000bcharacter' }, { signedAt: 'infinity' }, { signedAt: '2026-10-11' },
      { signatureDataUrl: 'data:text/html;base64,dGVzdA==' }, { signatureDataUrl: 'data:image/png;base64,' + 'a'.repeat(2000000) },
    ];
    for (const patch of invalid) await denied(seed(notice(patch)));
  });
  await check('notice can be signed without optional partner consent', async () => {
    const id = await seed(notice({ partner: null, consentGranted: false }));
    assert.equal((await row(id)).privacy_notice.consentGranted, false);
    await denied(db.query('update work_reports set privacy_consent_revoked_at=now() where id=$1', [id]));
    await denied(db.query('update work_reports set privacy_consent_revoked_at=now() where id=$1', [legacyId]));
  });
  await check('existing snapshot cannot be silently replaced using its former signature', async () => {
    await denied(replace(signedId, notice({ consentGranted: false })));
    await denied(replace(signedId, notice({ sections: [{ title: 'Új', text: 'Más szöveg' }] })));
    assert.deepEqual((await row(signedId)).privacy_notice, notice());
  });
  let revokedAt;
  await check('revocation is server-timed, preserves signed text and archives prior state once', async () => {
    await db.query("update work_reports set privacy_consent_revoked_at='1900-01-01' where id=$1", [signedId]);
    const saved = await row(signedId); revokedAt = saved.privacy_consent_revoked_at;
    assert.ok(new Date(revokedAt).getTime() > Date.now() - 60000);
    assert.deepEqual(saved.privacy_notice, notice());
    const versions = await history(signedId);
    assert.equal(versions.length, 1); assert.equal(versions[0].operation, 'revoked');
    assert.deepEqual(versions[0].privacy_notice, notice()); assert.equal(versions[0].privacy_consent_revoked_at, null);
    assert.equal(versions[0].recorded_by, user);
    await replace(signedId, notice());
    assert.deepEqual((await row(signedId)).privacy_consent_revoked_at, revokedAt);
    assert.equal((await history(signedId)).length, 1);
  });
  await check('withdrawal cannot be removed or rewritten by a stale normal save', async () => {
    await denied(db.query('update work_reports set privacy_consent_revoked_at=null where id=$1', [signedId]));
    await denied(db.query("update work_reports set privacy_consent_revoked_at='2020-01-01' where id=$1", [signedId]));
    await denied(db.query('update work_reports set signed_at=$2,privacy_consent_revoked_at=null where id=$1', [signedId, '2026-10-12T12:00:00Z']));
    assert.deepEqual((await row(signedId)).privacy_consent_revoked_at, revokedAt);
  });
  const freshNotice = notice({ signedAt: '2026-10-12T12:00:00Z', signatureDataUrl: 'data:image/png;base64,bmV3c2ln' });
  await check('freshly signed replacement resets withdrawal and archives its original timestamp', async () => {
    await replace(signedId, freshNotice);
    assert.equal((await row(signedId)).privacy_consent_revoked_at, null);
    const replaced = (await history(signedId)).find(entry => entry.operation === 'replaced');
    assert.deepEqual(replaced.privacy_consent_revoked_at, revokedAt);
    assert.deepEqual(replaced.privacy_notice, notice());
  });
  await check('clearing a draft preserves the old notice and any revocation without keeping stale live consent', async () => {
    await db.query('update work_reports set privacy_consent_revoked_at=now() where id=$1', [signedId]);
    const before = await row(signedId);
    await db.query('update work_reports set privacy_notice=null,signature_data_url=null,signed_at=null where id=$1', [signedId]);
    const after = await row(signedId);
    assert.equal(after.privacy_notice, null); assert.equal(after.privacy_consent_revoked_at, null);
    const cleared = (await history(signedId)).find(entry => entry.operation === 'cleared');
    assert.deepEqual(cleared.privacy_notice, freshNotice);
    assert.deepEqual(cleared.privacy_consent_revoked_at, before.privacy_consent_revoked_at);
  });
  await check('a fresh signature may attach a notice to a formerly legacy report', async () => {
    await replace(legacyId, freshNotice);
    assert.deepEqual((await row(legacyId)).privacy_notice, freshNotice);
  });
  await check('authenticated cannot inject, alter, erase or truncate audit history', async () => {
    await denied(db.query('insert into work_report_privacy_history(workspace_id,customer_id,work_report_id,privacy_notice,operation) values($1,$2,$3,$4,$5)',
      [workspace, customer, signedId, notice(), 'deleted']), '42501');
    await denied(db.query("update work_report_privacy_history set operation='deleted'"), '42501');
    await denied(db.query('delete from work_report_privacy_history'), '42501');
    await denied(db.query('truncate work_report_privacy_history'), '42501');
  });
  await check('original report identity and workspace cannot be moved even between authorised scopes', async () => {
    await denied(db.query('update work_reports set workspace_id=$2 where id=$1', [signedId, foreignWorkspace]));
    await denied(db.query('update work_reports set customer_id=$2 where id=$1', [signedId, foreignCustomer]));
    await denied(db.query('update work_reports set id=$2 where id=$1', [signedId, randomUUID()]));
  });
  await check('foreign workspace and inactive members cannot read historical customer data', async () => {
    await as('authenticated', other);
    assert.equal((await history(signedId)).length, 0);
    assert.equal((await db.query('update work_reports set privacy_notice=null where id=$1 returning id', [legacyId])).rows.length, 0);
    await denied(seed(notice()), '42501');
    await as('postgres'); await db.query('update workspace_members set active=false where user_id=$1', [user]);
    await as('authenticated', user); assert.equal((await history(signedId)).length, 0);
    await as('postgres'); await db.query('update workspace_members set active=true where user_id=$1', [user]);
    await as('authenticated', user);
  });
  await check('deleting a report preserves its last signed snapshot in history', async () => {
    await db.query('delete from work_reports where id=$1', [legacyId]);
    assert.equal(await row(legacyId), undefined);
    const versions = await history(legacyId);
    assert.equal(versions.length, 1); assert.equal(versions[0].operation, 'deleted');
    assert.deepEqual(versions[0].privacy_notice, freshNotice);
  });
  await check('maintenance notices use one service provider and remain scoped to maintenance', async () => {
    const maintenance = notice({ version: '2026-10-11.2', controllers: [notice().controllers[1]] });
    const id = await seed(maintenance, workspace, 'maintenance');
    assert.deepEqual((await row(id)).privacy_notice, maintenance);
    await denied(seed(maintenance));
    await denied(seed({ ...maintenance, controllers: [notice().controllers[0]] }, workspace, 'maintenance'));
    await denied(seed({ ...maintenance, controllers: notice().controllers }, workspace, 'maintenance'));
    await denied(seed({ ...notice(), controllers: [notice().controllers[1]] }, workspace, 'maintenance'));
    await denied(db.query("update work_reports set appointment_type='installation' where id=$1", [id]));
    await denied(db.query("update work_reports set signer_name='Másik aláíró' where id=$1", [id]));
    await denied(db.query("update work_reports set signed_at='2026-01-01T12:00:00Z' where id=$1", [id]));
    await denied(db.query("update work_reports set signature_data_url='data:image/png;base64,YQ==' where id=$1", [id]));
    const prior = await seed(notice(), workspace, 'maintenance');
    assert.deepEqual((await row(prior)).privacy_notice, notice());
    const before = await row(id);
    const newNotice = { ...maintenance, signedAt: '2027-10-11T12:00:00Z' };
    const next = await seed(newNotice, workspace, 'maintenance');
    assert.deepEqual(await row(id), before);
    assert.deepEqual((await row(next)).privacy_notice, newNotice);
    await denied(replace(id, { ...maintenance, consentGranted: false }));
    await db.query('update work_reports set privacy_consent_revoked_at=now() where id=$1', [id]);
    assert.deepEqual((await history(id))[0].privacy_notice, maintenance);
  });
  await check('customer cascade deletion also retains former notice evidence', async () => {
    const cascade = await seed(notice());
    await as('postgres'); await db.query('delete from customers where id=$1', [customer]);
    await as('authenticated', user);
    assert.equal(await row(cascade), undefined);
    assert.equal((await history(cascade))[0].operation, 'deleted');
    assert.equal((await history(legacyId)).length, 1);
  });
  await check('migration reapplication preserves nonempty historical snapshots', async () => {
    await as('postgres');
    const before = (await db.query('select * from work_report_privacy_history order by id')).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from work_report_privacy_history order by id')).rows, before);
  });
  await check('read-only pre/post verification executes and reports every schema check passed', async () => {
    const verify = await readFile(new URL('../docs/sql/VERIFY_WORK_REPORT_PRIVACY_NOTICE.sql', import.meta.url), 'utf8');
    const results = await db.exec(verify);
    const checks = results.flatMap(result => result.rows).filter(result => 'check_name' in result);
    assert.equal(checks.length, 9);
    assert.ok(checks.every(result => result.passed), JSON.stringify(checks));
    const maintenanceVerify = await readFile(new URL('../docs/sql/VERIFY_MAINTENANCE_PRIVACY_NOTICE.sql', import.meta.url), 'utf8');
    const maintenanceResults = await db.exec(maintenanceVerify);
    const maintenanceChecks = maintenanceResults.flatMap(result => result.rows).filter(result => 'check_name' in result);
    assert.equal(maintenanceChecks.length, 3);
    assert.ok(maintenanceChecks.every(result => result.passed), JSON.stringify(maintenanceChecks));
    assert.equal(maintenanceResults.at(-1).rows[0].invalid_maintenance_notice_count, 0);
  });
  await check('anonymous users cannot read consent evidence', async () => {
    await as('anon'); await denied(db.query('select * from work_report_privacy_history'), '42501');
  });
  console.log(`${passed} privacy SQL integration checks passed.`);
} finally { await db.close(); }
