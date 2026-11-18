const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const migration = fs.readFileSync(path.join(__dirname, "../docs/sql/20261118_QUOTE_DELIVERY_HISTORY.sql"), "utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const [workspace, otherWorkspace, user, customer, foreignCustomer, appointment, quote, delivery] =
  [1,2,3,4,5,6,7,8].map(id);

test("quote snapshots keep provider-confirmed rows immutable and visible only to the right workspace", {
  skip: !process.env.PGLITE_MODULE_PATH && "Set PGLITE_MODULE_PATH to the isolated PGlite package",
}, async () => {
  const { PGlite } = require(process.env.PGLITE_MODULE_PATH);
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
      create table public.workspaces(id uuid primary key,active boolean);
      create table public.workspace_members(workspace_id uuid,user_id uuid,active boolean);
      create table public.customers(id uuid primary key,workspace_id uuid,email text,status text default 'Visszahívandó',updated_at timestamptz);
      create table public.appointments(id uuid primary key,workspace_id uuid,customer_id uuid,status text default 'Időpont foglalva',cancelled_at timestamptz);
      create table public.quotes(id uuid primary key,workspace_id uuid,customer_id uuid,appointment_id uuid);
      grant select on all tables in schema public to service_role;
      grant update(status,updated_at) on public.customers to service_role;
      grant select on public.customers to authenticated;
      create function public.active_workspace_member(w uuid) returns boolean language sql stable as $$
        select w=current_setting('test.allowed')::uuid $$;
      insert into public.workspaces values ('${workspace}',true),('${otherWorkspace}',true);
      insert into public.workspace_members values('${workspace}','${user}',true);
      insert into public.customers values('${customer}','${workspace}','test@example.invalid'),
        ('${foreignCustomer}','${otherWorkspace}','test@example.invalid');
      insert into public.appointments values('${appointment}','${workspace}','${customer}');
      insert into public.quotes values('${quote}','${workspace}','${customer}','${appointment}');`);
    await db.exec(migration);
    await db.exec(migration);
    const postflight = fs.readFileSync(path.join(__dirname, "../docs/sql/VERIFY_20261118_QUOTE_DELIVERY_HISTORY.sql"), "utf8");
    assert.ok(Object.values((await db.query(postflight)).rows[0]).every(flag => flag === true));
    const params = [delivery,workspace,customer,appointment,quote,user,"2026-11-18T10:00:00Z","test@example.invalid",
      "alternatives",JSON.stringify([{ name:"Example", quantity: 1, unitPrice: 20, totalPrice: 20 }]),20,"key-test","serialized email"];
    const prepare = async (overrides={}) => (await db.query(
      "select public.prepare_quote_delivery($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value",Object.assign([...params],overrides))).rows[0].value;
    const confirm = async (provider="example-receipt") => (await db.query("select public.confirm_quote_delivery($1,$2,$3,$4)::text value",
      [delivery,workspace,customer,provider])).rows[0].value;
    await db.exec("set role service_role");
    assert.equal((await prepare()).state,"ready");
    assert.equal((await prepare()).state,"ready");
    await assert.rejects(prepare({12:"changed email"}), {code:"23505"});
    await assert.rejects(prepare({2:foreignCustomer}), {code:"42501"});
    await assert.rejects(prepare({3:id(99)}), {code:"42501"});
    await assert.rejects(prepare({4:id(99)}), {code:"42501"});
    await assert.rejects(prepare({7:"foreign@example.invalid"}), {code:"42501"});
    await db.exec(`reset role; set test.allowed='${workspace}'; set role authenticated;`);
    assert.equal((await db.query("select id from public.quote_delivery_history")).rows.length,0);
    await assert.rejects(confirm(),{code:"42501"});
    await assert.rejects(prepare(),{code:"42501"});
    await assert.rejects(db.query("select email_payload from public.quote_delivery_history"),{code:"42501"});
    await db.exec("reset role; set role service_role;");
    const sent = await confirm();
    assert.equal(await confirm(),sent);
    assert.equal((await prepare()).state,"sent");
    await assert.rejects(confirm("different-receipt"),{code:"P0002"});
    await assert.rejects(db.query("update public.quote_delivery_history set items='[]'"),{code:"42501"});
    await db.exec("reset role; set role authenticated");
    const rows = (await db.query("select id,recipient,items,pricing_mode from public.quote_delivery_history")).rows;
    assert.equal(rows.length,1);
    assert.equal(rows[0].items[0].totalPrice,20);
    await db.exec(`set test.allowed='${otherWorkspace}';`);
    assert.equal((await db.query("select id from public.quote_delivery_history")).rows.length,0);
    await db.exec("reset role; set role service_role");
    const independent = {0:id(9),3:null,4:null,11:"standalone"};
    const confirmStandalone = key => db.query("select public.confirm_quote_delivery($1,$2,$3,$4)", [key,workspace,customer,"receipt-" + key]);
    const customerStatus = async () => (await db.query("select status from public.customers where id=$1",[customer])).rows[0].status;
    assert.equal((await prepare(independent)).state,"ready");
    await confirmStandalone(id(9));
    assert.equal(await customerStatus(),"Visszahívandó","existing open appointment keeps its customer's status");
    await db.exec(`reset role; update public.appointments set status='Lemondva',cancelled_at=now(); set role service_role;`);
    await confirmStandalone(id(9));
    assert.equal(await customerStatus(),"Visszahívandó","retry of an already confirmed send cannot advance state again");
    const later = {...independent,0:id(10),11:"standalone-2",10:30,
      9:JSON.stringify([{name:"Another model",quantity:1,unitPrice:30,totalPrice:30}])};
    assert.equal((await prepare(later)).state,"ready");
    await confirmStandalone(id(10));
    assert.equal(await customerStatus(),"Ajánlat elküldve");
    assert.deepEqual((await db.query("select total_amount::int as price from public.quote_delivery_history where appointment_id is null order by id")).rows,
      [{price:20},{price:30}]);
    const expired = {...independent,0:id(11),11:"expired"};
    assert.equal((await prepare(expired)).state,"ready");
    await db.exec(`reset role; update public.quote_delivery_history set created_at=now()-interval '24 hours' where id='${id(11)}'; set role service_role;`);
    assert.equal((await prepare(expired)).state,"expired");
  } finally { await db.close(); }
});
