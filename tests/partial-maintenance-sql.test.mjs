import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Real isolated PostgreSQL and synthetic records; never connects to Supabase.
const require = createRequire(import.meta.url);
const { PGlite } = process.env.PGLITE_MODULE_PATH ? require(process.env.PGLITE_MODULE_PATH)
  : createRequire(new URL('../.photo-test/package.json', import.meta.url))('@electric-sql/pglite');
const db = new PGlite();
const source = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const workspace = '10000000-0000-0000-0000-000000000001', target = '10000000-0000-0000-0000-000000000002';
const user = '90000000-0000-0000-0000-000000000001', partner = '90000000-0000-0000-0000-000000000002';
const customer = '20000000-0000-0000-0000-000000000001', targetCustomer = '20000000-0000-0000-0000-000000000002';
const installation = '40000000-0000-0000-0000-000000000001', second = '40000000-0000-0000-0000-000000000002';
const maintenance = randomUUID(), historical = randomUUID(), mirror = randomUUID(), targetMaintenance = randomUUID(), grant = randomUUID(), secondVisit = randomUUID();
let passed = 0;
async function check(label, fn) { await fn(); passed++; console.log(`PASS ${label}`); }
async function actor(id = user, role = 'authenticated') {
  await db.exec(`reset role;set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
}
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const selected = (...numbers) => numbers.map(unitNumber => ({ productName: 'AC', unitNumber }));
const request = (devices, id = installation) => [{ installationId: id, selectedDevices: devices }];
const replace = (payload, work = maintenance, client = customer, ws = workspace) => scalar(
  'select replace_maintenance_device_links($1,$2,$3,$4)', [ws, work, client, JSON.stringify(payload)]);
const links = async (work = maintenance) => (await db.query(
  'select * from maintenance_appointment_items where maintenance_appointment_id=$1 order by installation_appointment_id', [work])).rows;
const saveQuote = (work, quote, items) => scalar('select save_quote_with_items($1,$2,$3,$4,$5,$6,$7)',
  [workspace,quote,customer,work,'Időpont foglalva','Synthetic maintenance',JSON.stringify(items)]);
const quoteItems = async quote => (await db.query('select * from quote_items where quote_id=$1 order by id',[quote])).rows;
const denied = (promise, code = '23514') => assert.rejects(promise, error => error.code === code);

try {
  await db.exec(await source('tests/fixtures/schema.sql'));
  await db.exec(`
    create role service_role;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
    insert into auth.users values('${user}',now(),null,null),('${partner}',now(),null,null);
    create table public.workspaces(id uuid primary key,name text,active boolean);
    insert into workspaces values('${workspace}','Source business',true),('${target}','Partner business',true);
    alter table workspace_members add column role text default 'owner';
    alter table customers add column phone text,add column email text,add column postal_code text,add column city text,add column address text;
    alter table appointments add column maintenance_origin text default 'own',add column maintenance_opt_out boolean default false,
      add column latitude double precision,add column longitude double precision;
    alter table work_reports add column signed_at timestamptz,add column signer_name text,add column privacy_notice jsonb;
    create table maintenance_appointment_items(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid,
      installation_appointment_id uuid references appointments(id),maintenance_appointment_id uuid references appointments(id),
      created_at timestamptz default now(),created_by uuid,legacy_source_key text,
      unique(maintenance_appointment_id,installation_appointment_id));
    grant select,insert,update,delete on maintenance_appointment_items to authenticated;
    alter table maintenance_appointment_items enable row level security;
    create policy member_all on maintenance_appointment_items for all to authenticated
      using(exists(select 1 from workspace_members m where m.workspace_id=maintenance_appointment_items.workspace_id and m.user_id=auth.uid() and m.active))
      with check(exists(select 1 from workspace_members m where m.workspace_id=maintenance_appointment_items.workspace_id and m.user_id=auth.uid() and m.active));
    create table shared_maintenance_grants(id uuid primary key,source_workspace_id uuid,target_workspace_id uuid,target_user_id uuid,
      revoked_at timestamptz,cutoff_date date,created_at timestamptz);
    create table shared_maintenance_handoffs(source_workspace_id uuid,source_installation_id uuid,target_workspace_id uuid,
      target_customer_id uuid,target_installation_id uuid);
    update quote_items set quantity=4 where quote_id='30000000-0000-0000-0000-000000000001';
    update appointments set status='Lezárva',scheduled_date=current_date-500,created_at=now()-interval '2 years'
      where id in('${installation}','${second}');
    insert into appointments(id,workspace_id,customer_id,appointment_type,status,scheduled_date) values
      ('${maintenance}','${workspace}','${customer}','maintenance','Időpont foglalva',current_date-2),
      ('${historical}','${workspace}','${customer}','maintenance','Lezárva',current_date-400),
      ('${mirror}','${target}','${targetCustomer}','installation','Lezárva',current_date-500),
      ('${targetMaintenance}','${target}','${targetCustomer}','maintenance','Időpont foglalva',current_date-1);
    insert into maintenance_appointment_items(workspace_id,customer_id,maintenance_appointment_id,installation_appointment_id,legacy_source_key)
      values('${workspace}','${customer}','${historical}','${installation}','legacy-untouched');
    insert into shared_maintenance_grants values('${grant}','${workspace}','${target}','${partner}',null,current_date,now());
    insert into shared_maintenance_handoffs values('${workspace}','${installation}','${target}','${targetCustomer}','${mirror}');
    insert into quotes(id,workspace_id,customer_id,appointment_id) values('30000000-0000-0000-0000-000000000003','${target}','${targetCustomer}','${mirror}');
    update appointments set quote_id='30000000-0000-0000-0000-000000000003',maintenance_origin='external' where id='${mirror}';
    insert into quote_items(workspace_id,quote_id,product_name,description,quantity) values
      ('${target}','30000000-0000-0000-0000-000000000003','AC','|install_price=0',4);
  `);
  const accessSql = await source('docs/sql/20261012_ACTIVE_WORKSPACE_ACCESS.sql');
  for (const name of ['active_workspace_member', 'require_workspace_member']) {
    await db.exec(accessSql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`))[0]);
  }
  await db.exec(await source('docs/sql/20261015_ATOMIC_MAINTENANCE_LINKS.sql'));
  const quoteSql = await source('docs/sql/20260906_AUDIT_DATA_SAFETY.sql');
  await db.exec(quoteSql.match(/create or replace function public\.save_quote_with_items[\s\S]*?\$\$;/)[0]);
  await db.exec('revoke all on function save_quote_with_items(uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon;grant execute on function save_quote_with_items(uuid,uuid,uuid,uuid,text,text,jsonb) to authenticated;grant select on maintenance_appointment_items to service_role;');
  const sharedSql = await source('docs/sql/20261011_SHARED_MAINTENANCE_ACCESS.sql');
  for (const name of ['shared_maintenance_member', 'shared_maintenance_has_signed_notice', 'list_shared_maintenance_results']) {
    await db.exec(sharedSql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`))[0]);
  }
  await db.exec(await source('docs/sql/20261012_SHARED_MAINTENANCE_HISTORY.sql'));
  await db.exec(await source('docs/sql/20261016_EXTRA_ITEMS_SHARED_MAINTENANCE.sql'));
  // Optional read-only production function export contains no customer rows or
  // credentials. Loading it here still executes solely in this isolated DB.
  if (process.env.MAINTENANCE_FUNCTION_PREFLIGHT_PATH) {
    const preflight=await readFile(process.env.MAINTENANCE_FUNCTION_PREFLIGHT_PATH,'utf8');
    const definitions=preflight.match(/CREATE OR REPLACE FUNCTION public\.(?:list_shared_maintenance_results|replace_maintenance_appointment_links|save_quote_with_items|shared_maintenance_installation_rows)\([\s\S]*?AS \$function\$[\s\S]*?\$function\$/g);
    assert.equal(definitions?.length,4,'Expected exactly the four inspected function definitions');
    for (const definition of definitions) await db.exec(`${definition};`);
  }
  const migration = await source('docs/sql/20261106_PARTIAL_MAINTENANCE.sql');
  const oldLinks = await links(historical);
  const immutableTables = ['appointments','quotes','quote_items','work_reports','documents','inventory_stock'];
  const snapshot = async () => Object.fromEntries(await Promise.all(immutableTables.map(async table => [table,
    (await db.query(`select to_jsonb(t) r from ${table} t order by to_jsonb(t)::text`)).rows])));
  const before = await snapshot();
  const policies = (await db.query('select * from pg_policies order by tablename,policyname')).rows;
  await check('migration is repeatable and preserves all legacy records, documents, RLS and shared function metadata', async () => {
    const metadata = (await db.query("select to_jsonb(p)-'prosrc' metadata from pg_proc p where proname in('shared_maintenance_installation_rows','list_shared_maintenance_results','save_quote_with_items') order by proname")).rows;
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual(await links(historical), oldLinks.map(link => ({ ...link, selected_devices: null })));
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows, policies);
    assert.deepEqual((await db.query("select to_jsonb(p)-'prosrc' metadata from pg_proc p where proname in('shared_maintenance_installation_rows','list_shared_maintenance_results','save_quote_with_items') order by proname")).rows, metadata);
    assert.equal(await scalar("select has_column_privilege('service_role','public.maintenance_appointment_items','selected_devices','SELECT')"),true);
  });
  await actor();
  await check('one of four devices saves explicitly and retry keeps link provenance and identity', async () => {
    assert.deepEqual(await replace(request(selected(3))), [installation]);
    const before = await links();
    assert.deepEqual(before[0].selected_devices, selected(3));
    assert.deepEqual(await replace(request(selected(3))), [installation]);
    assert.deepEqual(await links(), before);
    assert.equal(Number(await scalar('select quantity from quote_items where quote_id=$1', ['30000000-0000-0000-0000-000000000001'])), 4);
  });
  await check('old RPC cannot expand or erase an unchanged partial selection', async () => {
    const before = await links();
    await scalar('select replace_maintenance_appointment_links($1,$2,$3,$4)', [workspace,maintenance,customer,[installation]]);
    assert.deepEqual(await links(), before);
  });
  await check('invalid units, duplicates, fractional counts and extra items are rejected atomically', async () => {
    const before = await links();
    await db.query('insert into quote_items(workspace_id,quote_id,product_name,description,quantity) values($1,$2,$3,$4,5)',
      [workspace,'30000000-0000-0000-0000-000000000001','Pipe','|item_type=extra']);
    for (const units of [selected(5),[{productName:'Unknown',unitNumber:1}],[{productName:'Pipe',unitNumber:1}]]) {
      await denied(replace([...request(selected(1),second),...request(units)])); assert.deepEqual(await links(), before);
    }
    for (const units of [[],selected(1,1),[{productName:'AC',unitNumber:0}],[{productName:'AC',unitNumber:1.5}],
      [{productName:'AC',unitNumber:'1'}],[{productName:'AC',unitNumber:1,price:5000}]]) {
      await denied(replace(request(units)), '22023'); assert.deepEqual(await links(), before);
    }
    await denied(replace([...request(selected(1)),...request(selected(2))]), '22023');
    assert.deepEqual(await links(), before);
  });
  await check('one visit can mix a partial installation with all devices from another installation', async () => {
    await replace([...request(selected(3)),...request(null,second)]);
    assert.deepEqual((await links()).map(link=>[link.installation_appointment_id,link.selected_devices]),[[installation,selected(3)],[second,null]]);
    await replace(request(selected(3)));
  });
  await check('repeated rows of the same model share a stable cumulative device numbering', async () => {
    await db.query('update quote_items set quantity=2 where quote_id=$1 and product_name=$2', ['30000000-0000-0000-0000-000000000001','AC']);
    await db.query('insert into quote_items(workspace_id,quote_id,product_name,description,quantity) values($1,$2,$3,$4,2)',
      [workspace,'30000000-0000-0000-0000-000000000001','AC','ac|install_price=0']);
    await replace(request(selected(4,1)));
    assert.deepEqual((await links())[0].selected_devices, selected(1,4));
  });
  await check('foreign scope, wrong appointment type and missing rows leave original selections intact', async () => {
    const before = await links();
    await denied(replace(request(selected(1),randomUUID())));
    await denied(replace(request(selected(1),maintenance)));
    await denied(replace(request(selected(1),mirror)));
    await denied(replace(request(selected(1)),maintenance,targetCustomer), '42501');
    assert.deepEqual(await links(), before);
    await actor(partner); await denied(replace(request(selected(1))), '42501');
    await actor(null,'anon'); await denied(replace(request(selected(1))), '42501');
    await actor();
  });
  await check('selection can change before signing, and a second visit can select a different device', async () => {
    await replace(request(selected(1)));
    await db.query("insert into appointments(id,workspace_id,customer_id,appointment_type,status,scheduled_date) values($1,$2,$3,'maintenance','Időpont foglalva',current_date-3)", [secondVisit,workspace,customer]);
    await replace(request(selected(2)),secondVisit);
    assert.deepEqual((await links())[0].selected_devices, selected(1));
    assert.deepEqual((await links(secondVisit))[0].selected_devices, selected(2));
  });
  await check('signed and completed selections cannot change through either RPC or direct REST writes', async () => {
    await db.query("insert into work_reports(workspace_id,customer_id,appointment_id,appointment_type,signed_at,signature_data_url) values($1,$2,$3,'maintenance',now(),'saved-signature')", [workspace,customer,maintenance]);
    const before = await links();
    await replace(request(selected(1)));
    await denied(replace(request(selected(2))));
    await denied(replace([]));
    await denied(scalar('select replace_maintenance_appointment_links($1,$2,$3,$4)', [workspace,maintenance,customer,[second]]));
    await denied(db.query('update maintenance_appointment_items set selected_devices=$1 where maintenance_appointment_id=$2', [JSON.stringify(selected(2)),maintenance]));
    await denied(db.query('delete from maintenance_appointment_items where maintenance_appointment_id=$1', [maintenance]));
    assert.deepEqual(await links(), before);
    await db.query("update appointments set status='Lezárva' where id=$1", [secondVisit]);
    await denied(replace(request(selected(3)),secondVisit));
    await replace(request(selected(2)),secondVisit);
    await replace(request(null),historical);
  });
  await check('direct partial inserts validate device existence rather than trusting UI constraints', async () => {
    const fresh = randomUUID();
    await db.query("insert into appointments(id,workspace_id,customer_id,appointment_type,status) values($1,$2,$3,'maintenance','Időpont foglalva')", [fresh,workspace,customer]);
    await denied(db.query('insert into maintenance_appointment_items(workspace_id,customer_id,maintenance_appointment_id,installation_appointment_id,selected_devices) values($1,$2,$3,$4,$5)',
      [workspace,customer,fresh,installation,JSON.stringify(selected(9))]));
    assert.deepEqual(await links(fresh), []);
    await denied(db.query('insert into maintenance_appointment_items(workspace_id,customer_id,maintenance_appointment_id,installation_appointment_id) values($1,$2,$3,$4)',
      [workspace,customer,fresh,mirror]));
    assert.deepEqual(await links(fresh), []);
  });
  await check('a signature arriving after a draft blocks quote changes before link replacement and unchanged saves are no-ops', async () => {
    const work=randomUUID();
    await db.query("insert into appointments(id,workspace_id,customer_id,appointment_type,status) values($1,$2,$3,'maintenance','Időpont foglalva')",[work,workspace,customer]);
    const items=[{product_name:'AC',description:'ac|install_price=0',quantity:1,unit_price:12000},
      {product_name:'Service fee',description:'|item_type=extra',quantity:1,unit_price:1000}];
    const quote=await saveQuote(work,null,items);
    await db.query('update appointments set quote_id=$1 where id=$2',[quote,work]);
    await replace(request(selected(1)),work);
    // Another browser signs after the original browser prepared its editable draft.
    await db.query("insert into work_reports(workspace_id,customer_id,appointment_id,appointment_type,signed_at,signature_data_url) values($1,$2,$3,'maintenance',now(),'saved-signature')",[workspace,customer,work]);
    const before=await quoteItems(quote), beforeQuote=await scalar('select to_jsonb(q) from quotes q where id=$1',[quote]);
    for (const change of [{quantity:2},{unit_price:11000},{product_name:'Other AC'},{description:'changed'}]) {
      await denied(saveQuote(work,quote,[{...items[0],...change},items[1]]));
      assert.deepEqual(await quoteItems(quote),before);
    }
    await denied(saveQuote(work,null,items));
    await denied(saveQuote(work,'30000000-0000-0000-0000-000000000001',items));
    await denied(saveQuote(null,quote,items));
    assert.equal(await saveQuote(work,quote,[items[1],{...items[0],quantity:'1.0',unit_price:'12000.00'}]),quote);
    assert.deepEqual(await quoteItems(quote),before);
    assert.deepEqual(await scalar('select to_jsonb(q) from quotes q where id=$1',[quote]),beforeQuote);
    assert.deepEqual((await links(work))[0].selected_devices,selected(1));
  });
  await check('completed maintenance also locks quote items and unrelated installation quote editing remains intact', async () => {
    const work=randomUUID(), install=randomUUID();
    await db.query("insert into appointments(id,workspace_id,customer_id,appointment_type,status) values($1,$2,$3,'maintenance','Időpont foglalva'),($4,$2,$3,'installation','Lezárva')",[work,workspace,customer,install]);
    const items=[{product_name:'AC',description:'ac|install_price=0',quantity:1,unit_price:12000}];
    const quote=await saveQuote(work,null,items);
    await db.query("update appointments set quote_id=$1,status='Lezárva' where id=$2",[quote,work]);
    const before=await quoteItems(quote);
    await denied(saveQuote(work,quote,[{...items[0],quantity:4}]));
    assert.equal(await saveQuote(work,quote,items),quote);
    assert.deepEqual(await quoteItems(quote),before);
    const installQuote=await saveQuote(install,null,items);
    await saveQuote(install,installQuote,[{...items[0],quantity:2}]);
    assert.equal(Number((await quoteItems(installQuote))[0].quantity),2);
  });
  await check('private helpers stay inaccessible and inactive membership cannot call the new RPC', async () => {
    await denied(db.query('select validate_maintenance_device_selection($1,$2,$3,$4)',[workspace,customer,installation,JSON.stringify(selected(1))]),'42501');
    await db.exec('reset role');
    await db.query('update workspace_members set active=false where workspace_id=$1 and user_id=$2',[workspace,user]);
    await actor(); await denied(replace(request(selected(1))),'42501');
    await db.exec('reset role');
    await db.query('update workspace_members set active=true where workspace_id=$1 and user_id=$2',[workspace,user]);
    await actor();
  });
  await check('shared results carry selected devices and no prices or documents, and omit cancelled work', async () => {
    await actor(partner);
    await replace(request(selected(3),mirror),targetMaintenance,targetCustomer,target);
    const signedAt = '2026-11-05T12:00:00.000Z', signature='data:image/png;base64,QUJD', signer='Synthetic signer';
    const notice={version:'2026-10-11.2',signedAt,signatureDataUrl:signature,signerName:signer};
    await db.query("insert into work_reports(workspace_id,customer_id,appointment_id,appointment_type,signed_at,signature_data_url,signer_name,privacy_notice) values($1,$2,$3,'maintenance',$4,$5,$6,$7)", [target,targetCustomer,targetMaintenance,signedAt,signature,signer,notice]);
    await db.query("update appointments set status='Lezárva' where id=$1", [targetMaintenance]);
    await actor();
    let results=await scalar('select list_shared_maintenance_results($1)', [workspace]);
    assert.equal(results.length,1); assert.deepEqual(results[0].selectedDevices,selected(3));
    assert.deepEqual(Object.keys(results[0]).sort(), ['date','installationId','providerName','selectedDevices','status']);
    await actor(partner); await db.query('update appointments set cancelled_at=now() where id=$1',[targetMaintenance]);
    await actor(); assert.deepEqual(await scalar('select list_shared_maintenance_results($1)',[workspace]),[]);
    await actor(partner); await db.query('update appointments set cancelled_at=null where id=$1',[targetMaintenance]);
  });
  await check('shared incoming history preserves whole legacy and partial source visits without counting the recipient twice', async () => {
    await actor(); await db.query("update appointments set status='Lezárva' where id=$1",[maintenance]);
    await actor(partner); await db.exec('reset role');
    const rows=(await db.query('select payload from shared_maintenance_installation_rows($1)',[target])).rows;
    const row=rows.find(r=>r.payload.installationId===installation).payload;
    assert.equal(row.maintenanceHistory.length,3);
    assert.ok(row.maintenanceHistory.some(h=>h.selectedDevices===null));
    assert.deepEqual(row.maintenanceHistory.find(h=>h.selectedDevices?.[0]?.unitNumber===1)?.selectedDevices,selected(1));
    assert.deepEqual(row.maintenanceHistory.find(h=>h.selectedDevices?.[0]?.unitNumber===2)?.selectedDevices,selected(2));
    assert.ok(row.maintenanceHistory.every(h=>h.providerName==='Source business'));
    assert.ok(!JSON.stringify(row).includes('unit_price'));
  });
  await db.exec('reset role');
  await check('postflight runs and the original signed installation document remains unchanged', async () => {
    await db.exec(await source('docs/sql/VERIFY_20261106_PARTIAL_MAINTENANCE.sql'));
    assert.equal(await scalar('select signature_data_url from work_reports where id=$1',['50000000-0000-0000-0000-000000000001']),'SYNTHETIC-SIGNATURE');
    assert.deepEqual((await db.query('select * from pg_policies order by tablename,policyname')).rows,policies);
  });
  console.log(`${passed} partial-maintenance SQL checks passed.`);
} finally { await db.close(); }
