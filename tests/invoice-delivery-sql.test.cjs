const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const modulePath = process.env.PGLITE_MODULE_PATH || path.resolve(__dirname, '../.photo-test/node_modules/@electric-sql/pglite');
const migration = fs.readFileSync(path.resolve(__dirname, '../docs/sql/20261012_INVOICE_DELIVERY_GUARD.sql'), 'utf8');

test('durable invoice claims and access control use only a disposable local database', {
  skip: !fs.existsSync(modulePath) && 'Set PGLITE_MODULE_PATH to the isolated PGlite package',
}, async t => {
  const { PGlite } = require(modulePath); const db = new PGlite();
  const workspace = randomUUID(), foreignWorkspace = randomUUID(), user = randomUUID(), customer = randomUUID(), foreignCustomer = randomUUID();
  const as = async role => { assert.ok(['postgres','service_role','authenticated','anon'].includes(role)); await db.exec(`reset role; set role ${role}`); };
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const seed = async () => {
    await as('postgres'); const id = randomUUID();
    await db.query('insert into appointments values($1,$2,$3)', [id, workspace, customer]); return id;
  };
  const claim = async (appointment, kind = 'labor', opts = {}) => {
    await as('service_role'); return scalar('select claim_invoice_delivery($1,$2,$3,$4,$5)',
      [opts.workspace || workspace, opts.customer || customer, appointment, kind, opts.user || user]);
  };
  const finish = async (appointment, token, outcome = 'confirmed', kind = 'labor') => {
    await as('service_role'); return scalar('select finish_invoice_delivery($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [workspace, customer, appointment, kind, token, outcome, outcome === 'confirmed' ? 'SYNTHETIC-1' : null, '10000', '12700', true]);
  };
  const check = async (name, run) => t.test(name, async () => {
    await as('postgres'); await db.exec('begin');
    try { await run(); } finally { await db.exec('rollback; reset role'); }
  });
  const denied = async (run, code = '42501') => {
    await db.exec('savepoint expected_denial');
    await assert.rejects(run, error => error.code === code); await db.exec('rollback to savepoint expected_denial');
  };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table workspaces(id uuid primary key,active boolean not null default true);
      create table workspace_members(workspace_id uuid,user_id uuid,active boolean not null default true);
      create table customers(id uuid primary key,workspace_id uuid);
      create table appointments(id uuid primary key,workspace_id uuid,customer_id uuid);
      create table work_checklists(workspace_id uuid,customer_id uuid,appointment_id uuid,alin_invoice boolean default false,amova_invoice boolean default false);
      grant usage on schema public to anon,authenticated,service_role;`);
    await db.query('insert into workspaces(id) values($1),($2)', [workspace,foreignWorkspace]);
    await db.query('insert into workspace_members(workspace_id,user_id) values($1,$2),($3,$2)', [workspace,user,foreignWorkspace]);
    await db.query('insert into customers values($1,$2),($3,$4)', [customer,workspace,foreignCustomer,foreignWorkspace]);
    await db.exec(migration); await db.exec(migration); await db.exec(migration.replace(/\r?\n/g, '\r\n'));
    await check('migration is repeatable and does not backfill invoices or mutate old work', async () => {
      assert.equal(await scalar('select count(*)::int from invoice_deliveries'), 0);
      assert.equal(await scalar('select count(*)::int from customers'), 2);
      assert.equal(await scalar('select count(*)::int from work_checklists'), 0);
    });
    await check('only service role can execute RPCs or read the private ledger; nobody writes directly', async () => {
      for (const role of ['anon','authenticated']) {
        await as(role);
        await denied(() => db.query('select * from invoice_deliveries'));
        await denied(() => db.query('select claim_invoice_delivery($1,$2,null,$3,$4)', [workspace,customer,'labor',user]));
      }
      await as('service_role');
      assert.equal(await scalar('select count(*)::int from invoice_deliveries'), 0);
      assert.equal(await scalar("select has_table_privilege('service_role','invoice_deliveries','INSERT,UPDATE,DELETE')"), false);
    });
    await check('first claim is exclusive; confirmed receipt survives retries unchanged', async () => {
      const appointment = await seed(); const first = await claim(appointment);
      assert.equal(first.status, 'send'); assert.equal((await claim(appointment)).status, 'busy');
      await finish(appointment, first.claim_token);
      assert.deepEqual(await claim(appointment), { status:'confirmed',invoice_number:'SYNTHETIC-1',net_amount:'10000',gross_amount:'12700',email_sent:true });
      assert.equal(await scalar('select count(*)::int from invoice_deliveries'), 1);
    });
    await check('expired in-flight operation is never automatically reclaimed', async () => {
      const appointment = await seed(); const first = await claim(appointment);
      await as('postgres'); await db.query("update invoice_deliveries set lease_expires_at=now()-interval '1 day' where appointment_id=$1", [appointment]);
      assert.equal((await claim(appointment)).status, 'needs_review');
      await finish(appointment, first.claim_token); assert.equal((await claim(appointment)).status, 'confirmed');
    });
    await check('uncertain invoice cannot be reopened even by a later rejection', async () => {
      const appointment = await seed(); const first = await claim(appointment);
      await finish(appointment, first.claim_token, 'uncertain');
      assert.equal((await claim(appointment)).status, 'needs_review');
      assert.equal((await finish(appointment, first.claim_token, 'rejected')).status, 'uncertain');
      assert.equal((await claim(appointment)).status, 'needs_review');
    });
    await check('explicit rejection permits a new token; stale completion cannot change the later attempt', async () => {
      const appointment = await seed(); const first = await claim(appointment);
      await finish(appointment, first.claim_token, 'rejected'); const next = await claim(appointment);
      assert.equal(next.status, 'send'); assert.notEqual(next.claim_token, first.claim_token);
      await denied(() => db.query('select finish_invoice_delivery($1,$2,$3,$4,$5,$6,$7,null,null,false)',
        [workspace,customer,appointment,'labor',first.claim_token,'confirmed','STALE']));
      await finish(appointment, next.claim_token); assert.equal((await claim(appointment)).status, 'confirmed');
    });
    await check('different workspaces, appointments and invoice types keep independent operations', async () => {
      const first = await seed(), second = await seed();
      assert.equal((await claim(first,'device')).status,'send'); assert.equal((await claim(first,'labor')).status,'send');
      assert.equal((await claim(second,'labor')).status,'send'); assert.equal((await claim(null,'maintenance')).status,'send');
      assert.equal((await claim(null,'labor',{workspace:foreignWorkspace,customer:foreignCustomer})).status,'send');
      assert.equal(await scalar('select count(*)::int from invoice_deliveries'),5);
    });
    await check('changing between combined and split billing cannot duplicate an accepted or uncertain charge', async () => {
      for (const [previous, next] of [['combined','device'],['combined','labor'],['device','combined'],['labor','combined']]) {
        for (const state of ['confirmed','processing','uncertain','rejected']) {
          const appointment = await seed(); const first = await claim(appointment,previous);
          if (state !== 'processing') await finish(appointment,first.claim_token,state,previous);
          const result = await claim(appointment,next);
          assert.equal(result.status, {confirmed:'already_recorded',processing:'busy',uncertain:'needs_review',rejected:'send'}[state], `${previous} ${state} -> ${next}`);
        }
      }
    });
    await check('foreign customer, foreign appointment, inactive member and workspace are rejected', async () => {
      const appointment = await seed();
      await as('service_role');
      await denied(() => db.query('select claim_invoice_delivery($1,$2,$3,$4,$5)', [foreignWorkspace,customer,appointment,'labor',user]));
      await denied(() => db.query('select claim_invoice_delivery($1,$2,$3,$4,$5)', [foreignWorkspace,foreignCustomer,appointment,'labor',user]));
      await as('postgres'); await db.query('update workspace_members set active=false where workspace_id=$1',[workspace]);
      await as('service_role'); await denied(() => db.query('select claim_invoice_delivery($1,$2,$3,$4,$5)',[workspace,customer,appointment,'labor',user]));
      await as('postgres'); await db.query('update workspace_members set active=true'); await db.query('update workspaces set active=false where id=$1',[workspace]);
      await as('service_role'); await denied(() => db.query('select claim_invoice_delivery($1,$2,$3,$4,$5)',[workspace,customer,appointment,'labor',user]));
    });
    await check('saved legacy invoice flags block the corresponding issuer while the other issuer remains available', async () => {
      const appointment = await seed();
      await db.query('insert into work_checklists values($1,$2,$3,false,true)',[workspace,customer,appointment]);
      assert.equal((await claim(appointment,'device')).status,'already_recorded');
      assert.equal((await claim(appointment,'combined')).status,'already_recorded');
      assert.equal((await claim(appointment,'labor')).status,'send');
      const another = await seed(); assert.equal((await claim(another,'device')).status,'send');
    });
    await check('known receipt remains available after the client saved its invoice checklist', async () => {
      const appointment = await seed(); const first = await claim(appointment); await finish(appointment,first.claim_token);
      await as('postgres'); await db.query('insert into work_checklists values($1,$2,$3,true,false)',[workspace,customer,appointment]);
      assert.equal((await claim(appointment)).status,'confirmed');
    });
    await check('ledger survives appointment/customer removal without touching application data', async () => {
      const appointment = await seed(); const first = await claim(appointment); await finish(appointment,first.claim_token);
      await as('postgres'); await db.query('delete from appointments where id=$1',[appointment]); await db.query('delete from customers where id=$1',[customer]);
      assert.equal(await scalar('select count(*)::int from invoice_deliveries'),1);
    });
  } finally { await db.close(); }
});
