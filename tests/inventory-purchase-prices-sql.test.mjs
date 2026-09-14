import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Disposable local PostgreSQL-compatible instance; never contacts a live project.
const { PGlite } = createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');
const migration = await readFile(new URL('../docs/sql/INVENTORY_PURCHASE_PRICES.sql', import.meta.url), 'utf8');
const db = new PGlite();
const user = randomUUID(), other = randomUUID(), member = randomUUID();
const workspace = randomUUID(), foreignWorkspace = randomUUID();
let passed = 0;
async function check(label, action) { await action(); passed++; console.log(`PASS ${label}`); }
async function as(role, actor = '') {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
}
const denied = (promise, code = '42501') => assert.rejects(promise, error => error.code === code);
async function insert(opts = {}) {
  return (await db.query(`insert into inventory_purchase_prices(workspace_id,item_type,item_key,purchase_price,tax_basis,created_at,updated_at)
    values($1,$2,$3,$4,$5,'2000-01-01','2000-01-01') returning *,updated_at::text as version`, [
    opts.workspace ?? workspace, opts.type ?? 'climate', opts.key ?? 'ac-1',
    Object.hasOwn(opts, 'price') ? opts.price : 123456.78, Object.hasOwn(opts, 'basis') ? opts.basis : 'net',
  ])).rows[0];
}
async function price(key = 'ac-1', type = 'climate') {
  return (await db.query('select *,updated_at::text as version from inventory_purchase_prices where workspace_id=$1 and item_type=$2 and item_key=$3',
    [workspace, type, key])).rows[0];
}
async function repeatFails(pattern, change, restore) {
  await as('postgres');
  await db.exec(change);
  await assert.rejects(db.exec(migration), pattern);
  await db.exec('rollback;');
  await db.exec(restore);
}

try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table workspaces(id uuid primary key);
    create table workspace_members(workspace_id uuid references workspaces(id),user_id uuid references auth.users(id),active boolean not null,primary key(workspace_id,user_id));
    alter table workspace_members enable row level security;
    create policy self_member on workspace_members for select to authenticated using(user_id=auth.uid());
    create table climate_products(id text primary key,workspace_id uuid not null references workspaces(id),name text,price numeric,install_price numeric);
    create table inventory_stock(workspace_id uuid,product_id text,stock integer,primary key(workspace_id,product_id));
    create table material_inventory(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),name text not null,stock numeric,unique(workspace_id,name));
    create table documents(id uuid primary key,workspace_id uuid,payload jsonb);
    alter table climate_products enable row level security;
    alter table material_inventory enable row level security;
    create policy climate_member on climate_products for select to authenticated using(exists(select 1 from workspace_members wm where wm.workspace_id=climate_products.workspace_id and wm.user_id=auth.uid() and wm.active));
    create policy material_member on material_inventory for select to authenticated using(exists(select 1 from workspace_members wm where wm.workspace_id=material_inventory.workspace_id and wm.user_id=auth.uid() and wm.active));
    grant usage on schema public,auth to anon,authenticated;
    grant select on workspace_members,climate_products,material_inventory to authenticated;
  `);
  await db.query('insert into auth.users values($1),($2),($3)', [user, other, member]);
  await db.query('insert into workspaces values($1),($2)', [workspace, foreignWorkspace]);
  await db.query('insert into workspace_members values($1,$2,true),($3,$4,true),($1,$5,true)', [workspace, user, foreignWorkspace, other, member]);
  await db.query(`insert into climate_products values('ac-1',$1,'Teszt klíma',250000,80000),('ac-2',$1,'Második klíma',350000,90000),('foreign-ac',$2,'Másik munkaterület klímája',300000,80000)`, [workspace, foreignWorkspace]);
  await db.query(`insert into material_inventory(workspace_id,name,stock) values($1,'Rézcső 6,35 mm',22.5),($1,'Konzol',4),($2,'Rézcső 6,35 mm',10),($2,'Idegen anyag',3)`, [workspace, foreignWorkspace]);
  await db.query(`insert into inventory_stock values($1,'ac-1',6),($1,'ac-2',7),($2,'foreign-ac',8)`, [workspace, foreignWorkspace]);
  await db.query('insert into documents values($1,$2,$3)', [randomUUID(), workspace, { price: 250000, text: 'Korábbi ügyféldokumentum' }]);
  const oldData = {};
  for (const table of ['climate_products', 'inventory_stock', 'material_inventory', 'documents']) {
    oldData[table] = (await db.query(`select * from ${table} order by 1,2`)).rows;
  }
  await check('migration is additive and can run repeatedly with LF and CRLF', async () => {
    await db.exec(migration.replace(/\r\n/g, '\n'));
    await db.exec(migration);
    await db.exec(migration.replace(/\r?\n/g, '\r\n'));
    assert.equal((await db.query('select count(*)::int n from inventory_purchase_prices')).rows[0].n, 0);
    for (const table of Object.keys(oldData)) assert.deepEqual((await db.query(`select * from ${table} order by 1,2`)).rows, oldData[table]);
  });
  await check('anonymous table access, direct deletes and callable scope function are not granted', async () => {
    const grants = (await db.query(`select has_table_privilege('anon','inventory_purchase_prices','SELECT,INSERT,UPDATE,DELETE') anonymous,
      has_table_privilege('authenticated','inventory_purchase_prices','DELETE') member_delete,
      has_function_privilege('authenticated','enforce_inventory_purchase_price_scope()','EXECUTE') callable,
      (select prosecdef from pg_proc where oid='enforce_inventory_purchase_price_scope()'::regprocedure) definer`)).rows[0];
    assert.deepEqual(grants, { anonymous: false, member_delete: false, callable: false, definer: false });
    await as('anon');
    await denied(db.query('select * from inventory_purchase_prices'));
    await denied(insert());
  });
  await as('authenticated', user);
  let first;
  await check('active member saves exact climate and material prices with server timestamps', async () => {
    first = await insert();
    const material = await insert({ type: 'material', key: 'Rézcső 6,35 mm', price: 1499.95, basis: 'gross' });
    assert.equal(Number(first.purchase_price), 123456.78);
    assert.equal(Number(material.purchase_price), 1499.95);
    assert.equal(first.tax_basis, 'net'); assert.equal(material.tax_basis, 'gross');
    assert.ok(new Date(first.created_at).getFullYear() > 2000);
    assert.ok(new Date(first.updated_at).getFullYear() > 2000);
    await denied(insert(), '23505');
  });
  await check('missing price stays NULL and a known zero stays zero', async () => {
    const unknown = await insert({ key: 'ac-2', price: null });
    const zero = await insert({ type: 'material', key: 'Konzol', price: 0, basis: 'gross' });
    assert.equal(unknown.purchase_price, null);
    assert.equal(Number(zero.purchase_price), 0);
    assert.equal((await price('ac-2')).purchase_price, null);
  });
  await check('negative, excessive, nonfinite and missing/unknown tax basis are rejected', async () => {
    for (const value of [-0.01, -1, 1000000000, 'NaN']) {
      await denied(db.query("update inventory_purchase_prices set purchase_price=$1 where item_type='climate' and item_key='ac-1'", [value]), '23514');
    }
    for (const value of ['Infinity', '-Infinity']) {
      await denied(db.query("update inventory_purchase_prices set purchase_price=$1 where item_type='climate' and item_key='ac-1'", [value]), '22003');
    }
    await denied(db.query("update inventory_purchase_prices set tax_basis='unknown' where item_key='ac-1'"), '23514');
    await denied(db.query("update inventory_purchase_prices set tax_basis=null where item_key='ac-1'"), '23502');
    assert.equal(Number((await price()).purchase_price), 123456.78);
  });
  await check('maximum permitted price and two decimal storage remain valid', async () => {
    const changed = (await db.query("update inventory_purchase_prices set purchase_price=999999999.99 where item_type='climate' and item_key='ac-2' returning purchase_price")).rows[0];
    assert.equal(Number(changed.purchase_price), 999999999.99);
    const decimals = (await db.query("update inventory_purchase_prices set purchase_price=12.345 where item_type='climate' and item_key='ac-2' returning purchase_price")).rows[0];
    assert.equal(Number(decimals.purchase_price), 12.35);
  });
  await check('unknown, foreign and wrong-type targets cannot receive a price', async () => {
    for (const opts of [{ key: 'unknown' }, { key: 'foreign-ac' }, { type: 'material', key: 'Idegen anyag' },
      { type: 'material', key: 'ac-1' }, { key: 'Konzol' }, { workspace: foreignWorkspace, key: 'foreign-ac' }]) {
      await denied(insert(opts));
    }
    await denied(insert({ type: 'unknown' }), '23514');
  });
  await check('saved identity, workspace and created_at are immutable', async () => {
    for (const [column, value] of [['workspace_id', foreignWorkspace], ['item_type', 'material'], ['item_key', 'ac-2'], ['created_at', '2000-01-01T00:00:00Z']]) {
      await denied(db.query(`update inventory_purchase_prices set ${column}=$1 where item_type='climate' and item_key='ac-1'`, [value]));
    }
    assert.equal((await price()).version, first.version);
    await denied(db.query("delete from inventory_purchase_prices where item_key='ac-1'"));
  });
  await check('server version prevents a stale save from overwriting another edit', async () => {
    const changed = (await db.query(`update inventory_purchase_prices set purchase_price=98765.43,tax_basis='gross',updated_at='2000-01-01'
      where workspace_id=$1 and item_type='climate' and item_key='ac-1' and updated_at=$2 returning *,updated_at::text as version`, [workspace, first.version])).rows[0];
    assert.equal(Number(changed.purchase_price), 98765.43);
    assert.equal(changed.tax_basis, 'gross');
    assert.notEqual(changed.version, first.version);
    assert.equal(changed.created_at.getTime(), first.created_at.getTime());
    assert.equal((await db.query(`update inventory_purchase_prices set purchase_price=1 where workspace_id=$1
      and item_type='climate' and item_key='ac-1' and updated_at=$2 returning *`, [workspace, first.version])).rows.length, 0);
    assert.equal(Number((await price()).purchase_price), 98765.43);
  });
  await check('clearing a saved price uses NULL and preserves its identity and tax choice', async () => {
    await db.query("update inventory_purchase_prices set purchase_price=null where item_type='climate' and item_key='ac-1'");
    const cleared = await price();
    assert.equal(cleared.purchase_price, null); assert.equal(cleared.tax_basis, 'gross');
    assert.equal(cleared.item_key, 'ac-1'); assert.equal(cleared.created_at.getTime(), first.created_at.getTime());
  });
  await as('authenticated', other);
  await check('foreign workspace cannot read or edit another workspace prices', async () => {
    assert.equal((await db.query('select * from inventory_purchase_prices')).rows.length, 0);
    assert.equal((await db.query("update inventory_purchase_prices set purchase_price=1 where item_key='ac-1' returning *")).rows.length, 0);
    await denied(insert({ type: 'material', key: 'Konzol' }));
    const own = await insert({ workspace: foreignWorkspace, type: 'material', key: 'Rézcső 6,35 mm', price: 321 });
    assert.equal(Number(own.purchase_price), 321);
    assert.equal((await db.query('select * from inventory_purchase_prices')).rows.length, 1);
  });
  await as('authenticated', member);
  await check('another active member can edit the shared inventory price', async () => {
    const changed = (await db.query("update inventory_purchase_prices set purchase_price=500 where item_type='climate' and item_key='ac-1' returning *")).rows;
    assert.equal(changed.length, 1); assert.equal(Number(changed[0].purchase_price), 500);
  });
  await as('postgres'); await db.query('update workspace_members set active=false where user_id=$1', [member]); await as('authenticated', member);
  await check('inactive members immediately lose read, insert and update access', async () => {
    assert.equal((await db.query('select * from inventory_purchase_prices')).rows.length, 0);
    assert.equal((await db.query("update inventory_purchase_prices set purchase_price=0 returning *")).rows.length, 0);
    await denied(insert());
  });
  await as('authenticated');
  await check('authenticated role without a user claim has no price access', async () => {
    assert.equal((await db.query('select * from inventory_purchase_prices')).rows.length, 0);
    await denied(insert());
  });
  await as('postgres');
  await check('reapplying migration preserves prices, sale prices, stock and old documents', async () => {
    const prices = (await db.query('select * from inventory_purchase_prices order by 1,2,3')).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from inventory_purchase_prices order by 1,2,3')).rows, prices);
    for (const table of Object.keys(oldData)) assert.deepEqual((await db.query(`select * from ${table} order by 1,2`)).rows, oldData[table]);
  });
  await check('a deleted inventory target cannot be edited through an old price row', async () => {
    await db.query("delete from material_inventory where workspace_id=$1 and name='Konzol'", [workspace]);
    await as('authenticated', user);
    await denied(db.query("update inventory_purchase_prices set purchase_price=100 where item_type='material' and item_key='Konzol'"));
    assert.equal(Number((await price('Konzol', 'material')).purchase_price), 0);
    await as('postgres');
  });
  await check('disabled scope trigger makes repeat migration fail instead of accepting weakened protection', async () => {
    await repeatFails(/trigger/, 'alter table inventory_purchase_prices disable trigger inventory_purchase_price_scope;',
      'alter table inventory_purchase_prices enable trigger inventory_purchase_price_scope;');
  });
  await check('unknown extra policy causes a transaction rollback', async () => {
    await repeatFails(/policy/, 'create policy unsafe_extra on inventory_purchase_prices for select to authenticated using(true);',
      'drop policy unsafe_extra on inventory_purchase_prices;');
  });
  await check('same-name policy modification is detected from its fingerprint', async () => {
    await repeatFails(/policy/, 'alter policy purchase_price_read on inventory_purchase_prices using(true);',
      'alter policy purchase_price_read on inventory_purchase_prices using(exists(select 1 from workspace_members wm where wm.workspace_id=inventory_purchase_prices.workspace_id and wm.user_id=(select auth.uid()) and wm.active));');
  });
  await check('same-name function changes are detected and not overwritten', async () => {
    const original = (await db.query("select pg_get_functiondef('enforce_inventory_purchase_price_scope()'::regprocedure) as definition")).rows[0].definition;
    await repeatFails(/függvény/, 'create or replace function public.enforce_inventory_purchase_price_scope() returns trigger language plpgsql as $$ begin return new; end; $$;', original);
  });
  await check('unexpected table shape is detected without modifying stored rows', async () => {
    await repeatFails(/tábla/, 'alter table inventory_purchase_prices add column unexpected text;',
      'alter table inventory_purchase_prices drop column unexpected;');
  });
  await check('an unmarked same-name table is never adopted', async () => {
    const comment = (await db.query("select obj_description('inventory_purchase_prices'::regclass,'pg_class') as marker")).rows[0].marker;
    await as('postgres');
    await db.exec('comment on table inventory_purchase_prices is null;');
    await assert.rejects(db.exec(migration), /tábla/); await db.exec('rollback;');
    await db.query("select set_config('test.table_marker',$1,false)", [comment]);
    await db.exec("do $$ begin execute format('comment on table inventory_purchase_prices is %L',current_setting('test.table_marker')); end; $$;");
    await db.exec(migration);
  });
  console.log(`${passed} inventory purchase price SQL checks passed.`);
} finally { await db.close(); }
