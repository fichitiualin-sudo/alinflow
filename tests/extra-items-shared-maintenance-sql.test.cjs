const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'docs/sql', name), 'utf8');
const migration = read('20261016_EXTRA_ITEMS_SHARED_MAINTENANCE.sql');
const historical = read('20261012_SHARED_MAINTENANCE_HISTORY.sql');
const functionName = 'public.shared_maintenance_installation_rows(uuid)';
const modulePath = process.env.PGLITE_MODULE_PATH;

test('extra-item sharing migration excludes non-climates without altering records or permissions', {
  skip: !modulePath && 'Set PGLITE_MODULE_PATH to the isolated PGlite package',
}, async t => {
  // In-memory PostgreSQL, synthetic fixtures only; never connects to Supabase.
  const { PGlite } = require(modulePath);
  const db = new PGlite();
  const source = randomUUID(), target = randomUUID(), foreign = randomUUID(), actor = randomUUID(), customer = randomUUID();
  const grant = randomUUID(), mixed = randomUUID(), extraOnly = randomUUID(), unknown = randomUUID(), legacy = randomUUID();
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  const definition = () => scalar('select pg_get_functiondef($1::regprocedure)', [functionName]);
  const metadata = () => scalar("select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=$1::regprocedure", [functionName]);
  const received = async () => (await db.query('select installation_id,payload from public.shared_maintenance_installation_rows($1)', [target])).rows;
  const data = async () => {
    const snapshot = {};
    for (const table of ['customers','appointments','quotes','quote_items','shared_maintenance_grants','shared_maintenance_handoffs']) {
      snapshot[table] = (await db.query('select to_jsonb(t) as row from public.' + table + ' t order by to_jsonb(t)::text')).rows;
    }
    return snapshot;
  };
  try {
    await db.exec([
      "create role anon; create role authenticated; create role service_role;",
      "create schema auth;",
      "create function auth.uid() returns uuid language sql stable as $$ select current_setting('test.actor',true)::uuid $$;",
      "create function public.shared_maintenance_member(uuid,uuid,boolean) returns boolean language sql stable as $$ select true $$;",
      "create function public.shared_maintenance_has_signed_notice(uuid,uuid,uuid) returns boolean language sql stable as $$ select true $$;",
      "create table workspaces(id uuid primary key,name text,active boolean);",
      "create table customers(id uuid,workspace_id uuid,name text,phone text,email text,postal_code text,city text,address text);",
      "create table quotes(id uuid,workspace_id uuid,customer_id uuid);",
      "create table quote_items(id uuid,workspace_id uuid,quote_id uuid,product_name text,description text,quantity integer,unit_price integer);",
      "create table appointments(id uuid,workspace_id uuid,customer_id uuid,quote_id uuid,scheduled_date date,scheduled_time text, address text,latitude numeric,longitude numeric,appointment_type text,maintenance_origin text,status text, cancelled_at timestamptz,created_at timestamptz,maintenance_opt_out boolean);",
      "create table shared_maintenance_grants(id uuid,source_workspace_id uuid,target_workspace_id uuid,target_user_id uuid, cutoff_date date,created_at timestamptz,revoked_at timestamptz);",
      "create table shared_maintenance_handoffs(id uuid,source_workspace_id uuid,source_installation_id uuid,target_workspace_id uuid, target_customer_id uuid,target_installation_id uuid);",
      "create table maintenance_appointment_items(installation_appointment_id uuid,maintenance_appointment_id uuid,workspace_id uuid,customer_id uuid);",
    ].join('\n'));
    await db.query("select set_config('test.actor',$1,false)", [actor]);
    await db.query('insert into workspaces values($1,$2,true),($3,$4,true),($5,$6,true)', [source,'Source',target,'Recipient',foreign,'Foreign']);
    await db.query("insert into customers values($1,$2,'Synthetic customer','+3612345678','synthetic@example.invalid','1234','Test town','Test street')", [customer,source]);
    await db.query('insert into shared_maintenance_grants values($1,$2,$3,$4,current_date,now(),null)', [grant,source,target,actor]);
    for (const installation of [mixed,extraOnly,unknown,legacy]) {
      await db.query('insert into quotes values($1,$2,$3)', [installation,source,customer]);
      await db.query("insert into appointments values($1,$2,$3,$1,current_date-10,'08:00','Test street',47,19,'installation','own','Lezárva',null,now()-interval '1 day',false)", [installation,source,customer]);
    }
    async function item(quote, name, description, workspace=source) {
      await db.query('insert into quote_items values($1,$2,$3,$4,$5,1,12345)', [randomUUID(),workspace,quote,name,description]);
    }
    await item(mixed,'Catalog AC','catalog-id|install_price=0');
    await item(mixed,'Pump','|install_price=0|item_type=extra');
    await item(mixed,'Legacy manual AC',null);
    await item(extraOnly,'Removal','item_type=extra');
    await item(extraOnly,'Foreign fake AC','',foreign);
    await item(legacy,'Legacy manual same-word name','note_item_type=extra');
    await item(legacy,'Explicit climate','|item_type=climate');
    await db.exec(historical);
    const originalDefinition = await definition(), originalMetadata = await metadata(), originalData = await data();

    await t.test('rollback leaves the original function, data and grants untouched', async () => {
      assert.equal((await received()).length,4);
      await db.exec(migration.replace(/commit;\s*$/i,'rollback;'));
      assert.equal(await definition(),originalDefinition);
      assert.deepEqual(await metadata(),originalMetadata);
      assert.deepEqual(await data(),originalData);
    });

    await t.test('repeated application and line endings preserve metadata, access controls and all records', async () => {
      await db.exec(migration); const first = await definition();
      await db.exec(migration); await db.exec(migration.replace(/\r?\n/g,'\r\n'));
      assert.equal(await definition(),first);
      assert.deepEqual(await metadata(),originalMetadata);
      assert.deepEqual(await data(),originalData);
      for (const role of ['anon','authenticated','service_role']) {
        assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\')',[role,functionName]),false);
      }
    });

    await t.test('mixed installs retain climates, explicit extra-only work disappears, legacy/no-item works survive', async () => {
      const rows = await received(); assert.equal(rows.length,3);
      assert.ok(!rows.some(row=>row.installation_id===extraOnly));
      assert.deepEqual(rows.find(row=>row.installation_id===mixed).payload.climates.map(item=>item.productName).sort(), ['Catalog AC','Legacy manual AC']);
      assert.deepEqual(rows.find(row=>row.installation_id===unknown).payload.climates,[]);
      assert.deepEqual(rows.find(row=>row.installation_id===legacy).payload.climates.map(item=>item.productName).sort(), ['Explicit climate','Legacy manual same-word name']);
      assert.ok(!JSON.stringify(rows).includes('unit_price'));
      assert.equal((await db.query('select count(*)::int as count from quote_items')).rows[0].count,7);
    });

    await t.test('unexpected installed function is rejected and transaction rollback restores its exact definition', async () => {
      const approvedDefinition = await definition();
      await db.exec(approvedDefinition.replace('and qi.quantity>0', 'and qi.quantity>1'));
      const changed = await definition();
      await assert.rejects(db.exec(migration), /Unexpected shared maintenance read model/);
      await db.exec('rollback');
      assert.equal(await definition(),changed);
      assert.deepEqual(await metadata(),originalMetadata);
      assert.deepEqual(await data(),originalData);
      await db.exec(approvedDefinition);
      assert.equal(await definition(),approvedDefinition);
    });
  } finally { await db.close(); }
});
