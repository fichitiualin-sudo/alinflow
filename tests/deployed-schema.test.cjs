const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const modulePath = process.env.LOCAL_PG_MODULE_PATH;

test("Restored deployment schema regressions (localhost only)", {
  skip: !modulePath && "Requires an isolated local production-schema restore",
}, async t => {
  assert.equal(process.env.PGHOST, "127.0.0.1");
  assert.equal(process.env.PGPORT, "55436");
  assert.equal(process.env.PGDATABASE, "alinflow_restore");
  const { Client } = require(modulePath);
  const db = new Client();
  const ws = randomUUID(), user = randomUUID(), customer = randomUUID();
  const q = randomUUID(), q2 = randomUUID(), a = randomUUID(), b = randomUUID();
  const maintenance = randomUUID(), report = randomUUID();
  const product = `audit-restore-${randomUUID()}`;
  const material = `Audit pipe ${randomUUID()}`;
  const usage = JSON.stringify({ materials: [{ name: material, qty: "3", unit: "m" }], overrides: {} });
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const stock = async () => Number(await scalar("select stock from inventory_stock where workspace_id=$1 and product_id=$2", [ws, product]));
  const complete = (id = a, quantities = [{ name: material, quantity: 3 }], workspace = ws) => db.query(
    "select * from complete_installation($1,$2,$3,$4,$5)", [id, workspace, "Lezárva", usage, JSON.stringify(quantities)]);
  async function rejected(fn, pattern) {
    await db.query("savepoint expected_error");
    try { await assert.rejects(fn, pattern); }
    finally { await db.query("rollback to savepoint expected_error"); }
  }
  async function check(name, fn) {
    await t.test(name, async () => {
      await db.query("savepoint regression_case");
      try { await fn(); }
      finally { await db.query("rollback to savepoint regression_case"); }
    });
  }
  await db.connect();
  try {
    assert.equal(await scalar("select current_database()"), "alinflow_restore");
    await db.query("begin");
    await db.query("insert into auth.users(id,email) values($1,$2)", [user, `${user}@audit.invalid`]);
    await db.query("insert into workspaces(id,name,slug,owner_user_id) values($1,'LOCAL AUDIT TEST',$2,$3)", [ws, `audit-${ws}`, user]);
    await db.query("insert into workspace_members(workspace_id,user_id,active) values($1,$2,true)", [ws, user]);
    await db.query("insert into customers(id,workspace_id,name) values($1,$2,'LOCAL AUDIT TEST')", [customer, ws]);
    await db.query("insert into climate_products(id,workspace_id,name,price,install_price,active) values($1,$2,'Archived audit AC',100,0,false)", [product, ws]);
    await db.query("insert into inventory_stock(workspace_id,product_id,stock) values($1,$2,10)", [ws, product]);
    await db.query("insert into material_inventory(workspace_id,name,stock,unit,low_at) values($1,$2,20,'m',0)", [ws, material]);
    for (const [quote, appointment, quantity] of [[q,a,2],[q2,b,1]]) {
      await db.query("insert into quotes(id,workspace_id,customer_id,status,total_amount) values($1,$2,$3,'Időpont foglalva',$4)", [quote,ws,customer,quantity*100]);
      await db.query("insert into appointments(id,workspace_id,customer_id,quote_id,appointment_type,scheduled_date,scheduled_time,status) values($1,$2,$3,$4,'installation','2026-09-07','08:00','Időpont foglalva')", [appointment,ws,customer,quote]);
      await db.query("update quotes set appointment_id=$1 where id=$2", [appointment,quote]);
      await db.query("insert into quote_items(workspace_id,quote_id,product_name,description,quantity,unit_price,total_price) values($1,$2,'Archived audit AC',$3,$4,100,$5)", [ws,quote,`${product}|install_price=0`,quantity,quantity*100]);
    }
    await db.query("insert into appointments(id,workspace_id,customer_id,appointment_type,scheduled_date,scheduled_time,status) values($1,$2,$3,'maintenance','2026-09-08','11:00','Időpont foglalva')", [maintenance,ws,customer]);
    await db.query("insert into work_reports(id,workspace_id,customer_id,appointment_id,appointment_type,work_date,work_time,signature_data_url) values($1,$2,$3,$4,'installation','2026-09-07','08:00','SYNTHETIC TEST SIGNATURE')", [report,ws,customer,b]);
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);

    await check("RLS exposes only the synthetic member workspace", async () => {
      assert.equal(Number(await scalar("select count(*) from customers")), 1);
      await rejected(() => complete(a, [], randomUUID()), /jogosultsag/);
      await db.query("set local role anon");
      await rejected(() => complete(), /permission denied/);
    });
    await check("Actual integer quote columns preserve zero-price items", async () => {
      await db.query("select save_quote_with_items($1,$2,$3,$4,$5,$6,$7)", [ws,q,customer,a,"Időpont foglalva","",JSON.stringify([{product_name:"Archived audit AC",description:`${product}|install_price=0`,quantity:2,unit_price:0}])]);
      assert.equal(Number(await scalar("select total_amount from quotes where id=$1",[q])),0);
      assert.equal(Number(await scalar("select unit_price from quote_items where quote_id=$1",[q])),0);
    });
    await check("Failed quote insertion rolls back replacement and totals", async () => {
      await rejected(() => db.query("select save_quote_with_items($1,$2,$3,$4,$5,$6,$7)", [ws,q,customer,a,"Időpont foglalva","",JSON.stringify([{product_name:"AC",quantity:2,unit_price:2147483648}])]), /out of range/);
      assert.equal(Number(await scalar("select total_amount from quotes where id=$1",[q])),200);
      assert.equal(Number(await scalar("select quantity from quote_items where quote_id=$1",[q])),2);
    });
    await check("Material shortage rolls back climate stock and completion", async () => {
      await rejected(() => complete(a,[{name:material,quantity:300}]), /Anyagkeszlethiany/);
      assert.equal(await stock(),10);
      assert.equal(await scalar("select stock_deducted_at from appointments where id=$1",[a]),null);
      assert.equal(Number(await scalar("select count(*) from documents where appointment_id=$1",[a])),0);
    });
    await check("Repeat completion is idempotent and a second job deducts independently", async () => {
      await complete();
      await complete();
      assert.equal(await stock(),8);
      assert.equal(Number(await scalar("select stock from material_inventory where workspace_id=$1 and name=$2",[ws,material])),17);
      await complete(b,[]);
      assert.equal(await stock(),7);
      assert.equal(Number(await scalar("select count(*) from documents where appointment_id=$1 and document_type='work_closed'",[a])),1);
      await rejected(() => db.query("update appointments set stock_deducted_at=null where id=$1",[a]), /jelolese nem torolheto/);
    });
    await check("Signed report cannot move to another installation", async () => {
      await rejected(() => db.query("update work_reports set appointment_id=$1 where id=$2",[a,report]), /nem helyezheto at/);
      assert.equal(await scalar("select signature_data_url from work_reports where id=$1",[report]),"SYNTHETIC TEST SIGNATURE");
    });
    await check("Maintenance cancellation leaves both installations intact", async () => {
      await db.query("update appointments set status='Lemondva',cancelled_at=now() where id=$1",[maintenance]);
      assert.equal(Number(await scalar("select count(*) from appointments where customer_id=$1 and appointment_type='installation' and status='Időpont foglalva'",[customer])),2);
      await rejected(() => db.query("update appointments set appointment_type='installation' where id=$1",[maintenance]), /uj idopontot/);
    });
    await check("Checklist and document uniqueness is per appointment", async () => {
      for (const id of [a,b]) {
        await db.query("insert into work_checklists(workspace_id,customer_id,appointment_id,signature) values($1,$2,$3,false)",[ws,customer,id]);
        await db.query("insert into documents(workspace_id,customer_id,appointment_id,document_type,title) values($1,$2,$3,'work_report','LOCAL AUDIT TEST')",[ws,customer,id]);
      }
      assert.equal(Number(await scalar("select count(*) from work_checklists where customer_id=$1",[customer])),2);
      assert.equal(Number(await scalar("select count(*) from documents where customer_id=$1",[customer])),2);
    });
    await check("Rescheduling keeps completed status and job mirror", async () => {
      await complete();
      await db.query("select * from save_appointment_with_resources($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [a,customer,q,"LOCAL AUDIT TEST","2026-09-09","09:00","installation","Időpont foglalva","Test address","",user,ws,usage]);
      assert.equal(await scalar("select status from appointments where id=$1",[a]),"Lezárva");
      assert.equal(await scalar("select status from jobs where legacy_source_key=$1",[`appointments:${a}`]),"Lezárva");
      assert.equal(await scalar("select material_usage from appointments where id=$1",[b]),null);
    });
    await check("Inventory delta updates are scoped and reject negative totals", async () => {
      await db.query("select adjust_climate_stock($1,$2,5)",[ws,product]);
      assert.equal(await stock(),15);
      await rejected(() => db.query("select adjust_climate_stock($1,$2,-16)",[ws,product]), /Nincs eleg/);
      assert.equal(await stock(),15);
      await db.query("select adjust_material_stock($1,$2,2)",[ws,material]);
      assert.equal(Number(await scalar("select stock from material_inventory where workspace_id=$1 and name=$2",[ws,material])),22);
    });
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
});

test("Concurrent stock completion on a disposable local clone", {
  skip: !modulePath && "Requires an isolated local production-schema restore",
}, async () => {
  assert.equal(process.env.PGHOST, "127.0.0.1");
  assert.equal(process.env.PGPORT, "55436");
  assert.equal(process.env.PGDATABASE, "alinflow_restore");
  const { Client } = require(modulePath);
  const database = `audit_concurrency_${randomUUID().replaceAll("-", "")}`;
  assert.match(database, /^audit_concurrency_[a-f0-9]{32}$/);
  const admin = new Client({ database: "postgres" });
  const seed = new Client({ database });
  const clients = [0,1].map(i => new Client({ database, application_name: `audit-worker-${i}` }));
  const ws=randomUUID(), user=randomUUID(), customer=randomUUID(), product=`audit-${randomUUID()}`;
  const appointments=[randomUUID(),randomUUID()];
  let created = false;
  await admin.connect();
  try {
    await admin.query(`create database ${database} template alinflow_restore`);
    created = true;
    await seed.connect();
    await seed.query("insert into auth.users(id,email) values($1,$2)",[user,`${user}@audit.invalid`]);
    await seed.query("insert into workspaces(id,name,slug,owner_user_id) values($1,'LOCAL CONCURRENCY TEST',$2,$3)",[ws,`audit-${ws}`,user]);
    await seed.query("insert into workspace_members(workspace_id,user_id,active) values($1,$2,true)",[ws,user]);
    await seed.query("insert into customers(id,workspace_id,name) values($1,$2,'LOCAL CONCURRENCY TEST')",[customer,ws]);
    await seed.query("insert into climate_products(id,workspace_id,name,price,install_price) values($1,$2,'Audit AC',100,0)",[product,ws]);
    await seed.query("insert into inventory_stock(workspace_id,product_id,stock) values($1,$2,1)",[ws,product]);
    for (const id of appointments) {
      const quote=randomUUID();
      await seed.query("insert into quotes(id,workspace_id,customer_id,status,total_amount) values($1,$2,$3,'Időpont foglalva',100)",[quote,ws,customer]);
      await seed.query("insert into appointments(id,workspace_id,customer_id,quote_id,appointment_type,scheduled_date,scheduled_time,status) values($1,$2,$3,$4,'installation','2026-09-07','08:00','Időpont foglalva')",[id,ws,customer,quote]);
      await seed.query("update quotes set appointment_id=$1 where id=$2",[id,quote]);
      await seed.query("insert into quote_items(workspace_id,quote_id,product_name,description,quantity,unit_price,total_price) values($1,$2,'Audit AC',$3,1,100,100)",[ws,quote,`${product}|install_price=0`]);
    }
    for (const client of clients) {
      await client.connect();
      await client.query("set role authenticated");
      await client.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
    }
    const complete = (client,id) => client.query("select * from complete_installation($1,$2,$3,$4,$5)",[id,ws,"Lezárva",JSON.stringify({materials:[],overrides:{}}),"[]"]);
    await seed.query("begin");
    await seed.query("select stock from inventory_stock where workspace_id=$1 and product_id=$2 for update",[ws,product]);
    const pending = Promise.allSettled(clients.map((client,i) => complete(client,appointments[i])));
    let waiting = false;
    try {
      for (let attempt=0; attempt<100; attempt++) {
        const { rows } = await admin.query("select count(*)::int as count from pg_stat_activity where datname=$1 and application_name in ('audit-worker-0','audit-worker-1') and wait_event_type='Lock'",[database]);
        if (rows[0].count === 2) { waiting=true; break; }
        await new Promise(resolve => setTimeout(resolve,50));
      }
    } finally { await seed.query("commit"); }
    const outcomes = await pending;
    assert.equal(waiting,true,"Both independent connections must contend for the stock lock");
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    const rejected = outcomes.find(x=>x.status==='rejected');
    assert.match(rejected.reason.message,/Keszlethiany/);
    const { rows } = await seed.query("select stock from inventory_stock where workspace_id=$1 and product_id=$2",[ws,product]);
    assert.equal(Number(rows[0].stock),0);
    const winner = appointments[outcomes.findIndex(x=>x.status==='fulfilled')];
    await Promise.all(clients.map(client=>complete(client,winner)));
    const checks = await seed.query("select (select count(*)::int from documents where workspace_id=$1 and document_type='work_closed') as documents,(select count(*)::int from appointments where workspace_id=$1 and stock_deducted_at is not null) as completed,(select stock from inventory_stock where workspace_id=$1 and product_id=$2) as stock",[ws,product]);
    assert.deepEqual(checks.rows[0],{documents:1,completed:1,stock:"0"});
    await Promise.all(clients.map((client,i)=>client.query("select adjust_climate_stock($1,$2,$3)",[ws,product,i+2])));
    const finalStock = await seed.query("select stock from inventory_stock where workspace_id=$1 and product_id=$2",[ws,product]);
    assert.equal(Number(finalStock.rows[0].stock),5);
  } finally {
    for (const client of clients) await client.end().catch(()=>{});
    await seed.end().catch(()=>{});
    if (created) await admin.query(`drop database ${database}`);
    await admin.end();
  }
});
