const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const patch = read('docs/sql/20261016_EXTRA_ITEMS_STOCK_GUARD.sql');
const modulePath = process.env.PGLITE_MODULE_PATH;
const ws = '10000000-0000-0000-0000-000000000001';
const customer = '20000000-0000-0000-0000-000000000001';
const quote = '30000000-0000-0000-0000-000000000001';
const work = '40000000-0000-0000-0000-000000000001';
const actor = '90000000-0000-0000-0000-000000000001';
const completion = 'public.complete_installation(uuid,uuid,text,jsonb,jsonb)';
const quoteWriter = 'public.save_quote_with_items(uuid,uuid,uuid,uuid,text,text,jsonb)';
const usage = { materials: [], overrides: {} };
const climate = { product_name: 'Synthetic AC', description: 'ac|install_price=0', quantity: 2, unit_price: 100 };
const extra = { product_name: 'Synthetic extra', description: 'ac|install_price=0|item_type=extra', quantity: 99, unit_price: 20 };

test('extra-item stock guard protects the real quote/completion transactions', {
  skip: !modulePath && 'Set PGLITE_MODULE_PATH to the isolated PGlite package',
}, async t => {
  // Disposable PostgreSQL only. No Supabase, Google, billing or live stock writes.
  const { PGlite } = require(modulePath), db = new PGlite();
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const definition = name => scalar('select pg_get_functiondef($1::regprocedure)',[name]);
  const metadata = name => scalar("select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=$1::regprocedure",[name]);
  const save = items => scalar("select save_quote_with_items($1,$2,$3,$4,'Időpont foglalva','',$5)",[ws,quote,customer,work,JSON.stringify(items)]);
  const complete = (quantities = []) => db.query("select * from complete_installation($1,$2,'Lezárva',$3,$4)",[work,ws,JSON.stringify(usage),JSON.stringify(quantities)]);
  const stock = () => scalar("select stock from inventory_stock where workspace_id=$1 and product_id='ac'",[ws]);
  const snapshot = async () => {
    const data = {};
    for (const table of ['appointments','jobs','customers','quotes','quote_items','inventory_stock','material_inventory','documents','work_reports','work_checklists']) {
      data[table]=(await db.query('select to_jsonb(t) as row from '+table+' t order by to_jsonb(t)::text')).rows;
    }
    return data;
  };
  const rejected = async (run, pattern) => {
    await db.exec('savepoint expected_error');
    await assert.rejects(run,pattern);
    await db.exec('rollback to savepoint expected_error');
  };
  const transaction = async (name,run) => t.test(name,async () => {
    await db.exec("begin; set role authenticated; set request.jwt.claim.sub = '"+actor+"';");
    try { await run(); } finally { await db.exec('rollback; reset role'); }
  });
  try {
    await db.exec(read('tests/fixtures/schema.sql'));
    await db.exec(read('docs/sql/20260723_ADD_WORKSPACE_ISOLATION.sql').match(/create or replace function public.save_appointment_with_job_mirror[\s\S]*?\$\$;/)[0]);
    await db.exec(read('docs/sql/20260906_AUDIT_DATA_SAFETY.sql'));
    const originalDefinition = await definition(completion), originalMetadata = await metadata(completion);
    const originalWriter = await definition(quoteWriter), originalData = await snapshot();

    await t.test('explicit rollback restores the original function and unchanged data',async () => {
      await db.exec(patch.replace(/commit;\s*$/i,'rollback;'));
      assert.equal(await definition(completion),originalDefinition);
      assert.deepEqual(await metadata(completion),originalMetadata);
      assert.deepEqual(await snapshot(),originalData);
    });
    await t.test('repeated application preserves lock/security metadata, quote writer and every saved row',async () => {
      await db.exec(patch); const first=await definition(completion);
      await db.exec(patch); await db.exec(patch.replace(/\r?\n/g,'\r\n'));
      assert.equal(await definition(completion),first);
      assert.deepEqual(await metadata(completion),originalMetadata);
      assert.equal(await definition(quoteWriter),originalWriter);
      assert.deepEqual(await snapshot(),originalData);
    });
    await transaction('mixed quote keeps all prices/rows but extra with a retained catalog prefix never deducts AC stock',async () => {
      assert.equal(await save([climate,extra]),quote);
      assert.equal(await scalar('select total_amount from quotes where id=$1',[quote]),'2180');
      assert.equal(await scalar('select description from quote_items where quote_id=$1 and product_name=$2',[quote,extra.product_name]),extra.description);
      await complete(); await complete();
      assert.equal(await stock(),'8');
      assert.equal(await scalar('select count(*)::int from documents where appointment_id=$1',[work]),1);
      assert.equal(await scalar('select count(*)::int from quote_items where quote_id=$1',[quote]),2);
    });
    await transaction('extra-only work cannot be completed as an installation or modify stock/status/documents',async () => {
      await save([extra]); const before=await snapshot();
      await rejected(()=>complete(),/legalabb egy klima/);
      assert.deepEqual(await snapshot(),before);
      assert.equal(await stock(),'10');
    });
    await transaction('legacy manual climate remains eligible without a catalog stock deduction',async () => {
      await save([{product_name:'Legacy manual AC',description:'|install_price=0',quantity:1,unit_price:100}]);
      await complete(); assert.equal(await stock(),'10');
      assert.equal(await scalar('select status from appointments where id=$1',[work]),'Lezárva');
    });
    await transaction('material shortage still rolls back the entire mixed completion transaction',async () => {
      await save([climate,extra]); const before=await snapshot();
      await rejected(()=>complete([{name:'Pipe',quantity:999}]),/Anyagkeszlethiany/);
      assert.deepEqual(await snapshot(),before); assert.equal(await stock(),'10');
    });
    await t.test('unexpected completion source is rejected and rollback preserves it exactly',async () => {
      const approved = await definition(completion);
      await db.exec(approved.replace('group by 1 order by 1','group by 1 order by 1 desc'));
      const altered=await definition(completion);
      await assert.rejects(db.exec(patch),/Unexpected installation completion transaction/);
      await db.exec('rollback'); assert.equal(await definition(completion),altered);
      assert.deepEqual(await metadata(completion),originalMetadata);
      assert.deepEqual(await snapshot(),originalData);
      await db.exec(approved);
    });
  } finally { await db.close(); }
});
