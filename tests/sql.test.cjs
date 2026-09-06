const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { repo } = require("./helpers.cjs");
const modulePath = process.env.PGLITE_MODULE_PATH;
const ws = "10000000-0000-0000-0000-000000000001";
const customer = "20000000-0000-0000-0000-000000000001";
const q = "30000000-0000-0000-0000-000000000001";
const a = "40000000-0000-0000-0000-000000000001";
const b = "40000000-0000-0000-0000-000000000002";
const usage = JSON.stringify({ materials: [{ name: "Pipe", qty: "3", unit: "m" }], overrides: {} });
test("PostgreSQL migration and transaction regressions", { skip: !modulePath && "Set PGLITE_MODULE_PATH to the isolated PGlite package" }, async t => {
  const { PGlite } = require(modulePath);
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, "fixtures/schema.sql"), "utf8"));
    const previous = fs.readFileSync(path.join(repo, "docs/sql/20260723_ADD_WORKSPACE_ISOLATION.sql"), "utf8");
    const oldRpc = previous.match(/create or replace function public.save_appointment_with_job_mirror[\s\S]*?\$\$;/)[0];
    await db.exec(oldRpc);
    const preflight = await db.exec(fs.readFileSync(path.join(repo, "docs/sql/20260906_PREFLIGHT_AUDIT_DATA_SAFETY.sql"), "utf8"));
    await t.test("Preflight script accepts the compatible synthetic schema", () => {
      for (const result of preflight) for (const row of result.rows || []) {
        if (Object.hasOwn(row, "passed")) assert.equal(row.passed, true, row.check_name);
      }
    });
    const migration = fs.readFileSync(path.join(repo, "docs/sql/20260906_AUDIT_DATA_SAFETY.sql"), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const verification = await db.exec(fs.readFileSync(path.join(repo, "docs/sql/20260906_VERIFY_AUDIT_DATA_SAFETY.sql"), "utf8"));
    await t.test("Read-only verification validates functions, guards, indexes and data", () => {
      for (const result of verification) for (const row of result.rows || []) {
        if (Object.hasOwn(row, "passed")) assert.equal(row.passed, true, row.check_name);
        if (Object.hasOwn(row, "count_value")) assert.equal(Number(row.count_value), 0, row.issue);
      }
    });
    await db.exec("set role authenticated; set request.jwt.claim.sub = '90000000-0000-0000-0000-000000000001';");

    async function scalar(sql, args = []) { return Object.values((await db.query(sql, args)).rows[0])[0]; }
    async function check(name, fn) {
      await t.test(name, async () => {
        await db.exec("begin");
        try { await fn(); } finally { await db.exec("rollback"); }
      });
    }
    async function rejected(fn, pattern) {
      await db.exec("savepoint expected_error");
      await assert.rejects(fn, pattern);
      await db.exec("rollback to savepoint expected_error");
    }
    const complete = (id = a, quantities = [{ name: "Pipe", quantity: 3 }], status = "Lezárva", workspace = ws) =>
      db.query("select * from complete_installation($1,$2,$3,$4,$5)", [id, workspace, status, usage, JSON.stringify(quantities)]);
    const saveQuote = (items, appointment = a, workspace = ws) => db.query(
      "select save_quote_with_items($1,$2,$3,$4,$5,$6,$7)",
      [workspace,q,customer,appointment,"Időpont foglalva","",JSON.stringify(items)]);
    const item = { product_name: "AC", description: "ac|install_price=0", quantity: 2, unit_price: 0 };

    await check("Migration is repeatable and preserves reports, signatures and stock", async () => {
      assert.equal(await scalar("select count(*)::int from work_reports"), 1);
      assert.equal(await scalar("select signature_data_url from work_reports"), "SYNTHETIC-SIGNATURE");
      assert.equal(await scalar("select count(*)::int from work_checklists"), 1);
      assert.equal(await scalar("select stock from inventory_stock"), "10");
      assert.equal(await scalar("select count(*)::int from appointments where stock_deducted_at is not null"), 1);
    });
    await check("A06: replacement inserts zero-price items without losing identity", async () => {
      await saveQuote([item]);
      assert.equal(await scalar("select unit_price from quote_items where quote_id=$1",[q]), "0");
      assert.equal(await scalar("select total_amount from quotes where id=$1",[q]), "0");
      assert.equal(await scalar("select description from quote_items where quote_id=$1",[q]), item.description);
    });
    await check("A06: error after deletion rolls the entire quote back", async () => {
      await db.exec("reset role; create function reject_test_item() returns trigger language plpgsql as $$ begin if new.product_name = 'FAIL' then raise exception 'injected insert failure'; end if; return new; end; $$; create trigger reject_test_item before insert on quote_items for each row execute function reject_test_item(); set role authenticated;");
      await rejected(() => saveQuote([{ ...item, product_name: "FAIL" }]), /injected insert failure/);
      assert.equal(await scalar("select product_name from quote_items where quote_id=$1",[q]), "AC");
      assert.equal(await scalar("select total_amount from quotes where id=$1",[q]), "200");
    });
    await check("A07: material failure rolls back climate stock, status and documents", async () => {
      await rejected(() => complete(a, [{ name: "Pipe", quantity: 300 }]), /Anyagkeszlethiany/);
      assert.equal(await scalar("select stock from inventory_stock"), "10");
      assert.equal(await scalar("select stock_deducted_at from appointments where id=$1",[a]), null);
      assert.equal(await scalar("select status from appointments where id=$1",[a]), "Időpont foglalva");
      assert.equal(await scalar("select count(*)::int from documents where appointment_id=$1",[a]), 0);
    });
    await check("A07/A12: repeat completion deducts once; another job uses remaining stock", async () => {
      await complete();
      await complete();
      assert.equal(await scalar("select stock from inventory_stock"), "8");
      assert.equal(await scalar("select stock from material_inventory"), "17");
      await complete(b, []);
      assert.equal(await scalar("select stock from inventory_stock"), "7");
      assert.equal(await scalar("select count(*)::int from documents where appointment_id=$1",[a]), 1);
      await rejected(() => db.query("update appointments set stock_deducted_at=null where id=$1",[a]), /jelolese nem torolheto/);
    });
    await check("A02: existing signed report cannot move to another installation", async () => {
      await rejected(() => db.query("update work_reports set appointment_id=$1",[a]), /nem helyezheto at/);
      assert.equal(await scalar("select signature_data_url from work_reports"), "SYNTHETIC-SIGNATURE");
    });
    await check("Stock adjustments apply deltas to current stock and never make it negative", async () => {
      await complete();
      await db.query("select adjust_climate_stock($1,'ac',5)",[ws]);
      assert.equal(await scalar("select stock from inventory_stock"), "13");
      await rejected(() => db.query("select adjust_climate_stock($1,'ac',-20)",[ws]), /Nincs eleg/);
      assert.equal(await scalar("select stock from inventory_stock"), "13");
      await db.query("select adjust_material_stock($1,'Pipe',2)",[ws]);
      assert.equal(await scalar("select stock from material_inventory"), "19.0");
    });
    await check("A13: survey conversion is rejected; old appointment remains unchanged", async () => {
      await rejected(() => db.query("update appointments set appointment_type='installation' where appointment_type='survey'"), /uj idopontot/);
      assert.equal(await scalar("select count(*)::int from appointments where appointment_type='survey'"), 1);
      await rejected(() => saveQuote([item], b), /Masik munka/);
    });
    await check("A09: independent checklists and documents coexist for one customer", async () => {
      await db.query("insert into work_checklists(workspace_id,customer_id,appointment_id,signature) values($1,$2,$3,false)",[ws,customer,a]);
      await db.query("insert into documents(workspace_id,customer_id,appointment_id,document_type) values($1,$2,$3,'work_report')",[ws,customer,a]);
      assert.equal(await scalar("select count(*)::int from work_checklists"), 2);
      assert.equal(await scalar("select signature from work_checklists where appointment_id=$1",[a]), false);
      assert.equal(await scalar("select count(*)::int from documents where document_type='work_report'"), 2);
    });
    await check("A10/A12: rescheduling preserves completion and saves work-scoped materials", async () => {
      await complete();
      const args = [a,customer,q,"Customer One","2026-09-09","09:00","installation","Időpont foglalva","Test street","",null,ws,usage];
      await db.query("select * from save_appointment_with_resources($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",args);
      assert.equal(await scalar("select status from appointments where id=$1",[a]), "Lezárva");
      assert.equal(await scalar("select material_usage->'materials'->0->>'qty' from appointments where id=$1",[a]), "3");
      assert.equal(await scalar("select material_usage from appointments where id=$1",[b]), null);
      assert.equal(await scalar("select status from jobs where legacy_source_key=$1",["appointments:"+a]), "Lezárva");
    });
    await check("RPC authorization rejects wrong workspace and anonymous execution", async () => {
      await rejected(() => complete(a, [], "Lezárva", "10000000-0000-0000-0000-000000000002"), /jogosultsag/);
      await db.exec("set role anon");
      await rejected(() => complete(), /permission denied/);
    });
  } finally { await db.close(); }
});
