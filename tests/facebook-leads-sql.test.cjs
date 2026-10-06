const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { repo } = require("./helpers.cjs");

const modulePath = process.env.PGLITE_MODULE_PATH;
const workspace = "10000000-0000-0000-0000-000000000001";
const otherWorkspace = "10000000-0000-0000-0000-000000000002";
const user = "90000000-0000-0000-0000-000000000001";
const otherUser = "90000000-0000-0000-0000-000000000002";
const customer = "20000000-0000-0000-0000-000000000001";
const foreignCustomer = "20000000-0000-0000-0000-000000000002";
const migration = fs.readFileSync(path.join(repo, "docs/sql/FACEBOOK_LEAD_IMPORT.sql"), "utf8");
const payload = {
  name: "Import teszt", phone: "+36 30 123 4567", email: "TEST@example.invalid",
  city: "Budapest", postal_code: "1101", climate_name: "Teszt klíma",
  submitted_at: "2026-10-06T10:30:00.000Z", form_id: "201", ad_id: "301", ad_name: "Teszt hirdetés",
  campaign_id: "401", campaign_name: "Teszt kampány",
};

test("Facebook lead migration, import transactions and access control", {
  skip: !modulePath && "Set PGLITE_MODULE_PATH to the isolated PGlite package",
}, async t => {
  const { PGlite } = require(modulePath);
  const db = new PGlite();
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const importLead = async (lead = "501", patch = {}, ws = workspace, page = "101") =>
    scalar("select public.import_facebook_lead($1,$2,$3,$4::jsonb)", [ws, page, lead, JSON.stringify({ ...payload, ...patch })]);
  const role = async (name, uid = user) => {
    assert.ok(["authenticated", "anon", "service_role"].includes(name));
    await db.exec(`set role ${name}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
  };
  const rejected = async (run, pattern) => {
    await db.exec("savepoint expected_error");
    await assert.rejects(run, pattern);
    await db.exec("rollback to savepoint expected_error");
  };
  const check = async (name, run) => t.test(name, async () => {
    await db.exec("reset role; begin");
    try { await run(); } finally { await db.exec("rollback; reset role"); }
  });

  try {
    await db.exec(fs.readFileSync(path.join(__dirname, "fixtures/schema.sql"), "utf8"));
    // This test's isolated database adds the customer columns used by the live
    // app. No production connection, records or shared fixture changes.
    await db.exec(`
      create role service_role bypassrls;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${user}'),('${otherUser}');
      create table public.workspaces(id uuid primary key,active boolean not null default true);
      insert into public.workspaces(id) values ('${workspace}'),('${otherWorkspace}');
      alter table public.customers alter column id set default gen_random_uuid();
      alter table public.customers add column phone text, add column email text, add column city text,
        add column postal_code text,add column address text,add column source text,add column need text,
        add column notes text,add column created_by uuid references auth.users(id),
        add column created_at timestamptz not null default now();
      alter table public.workspace_members enable row level security;
      create policy membership_read on public.workspace_members for select to authenticated using(user_id=auth.uid());
      alter table public.workspaces enable row level security;
      create policy workspace_read on public.workspaces for select to authenticated using(exists(
        select 1 from public.workspace_members wm where wm.workspace_id=workspaces.id and wm.user_id=auth.uid() and wm.active));
      grant usage on schema public,auth to service_role;
      grant select on public.workspaces to authenticated;
    `);
    await db.exec(migration);
    await db.exec(migration);

    await check("migration is repeatable and preserves customer/work records", async () => {
      assert.equal(await scalar("select count(*)::int from customers"), 2);
      assert.equal(await scalar("select count(*)::int from appointments"), 4);
      assert.equal(await scalar("select signature_data_url from work_reports"), "SYNTHETIC-SIGNATURE");
      assert.equal(await scalar("select count(*)::int from facebook_lead_imports"), 0);
    });

    await check("new lead saves city, climate and original inquiry time", async () => {
      await role("service_role");
      const saved = await importLead();
      assert.equal(saved.duplicate, false);
      assert.equal(saved.status, "created");
      assert.equal(saved.city, payload.city);
      assert.equal(saved.climate_name, payload.climate_name);
      assert.equal(saved.phone, payload.phone);
      assert.equal(saved.ad_id, payload.ad_id);
      assert.equal(saved.form_id, payload.form_id);
      assert.equal(saved.campaign_name, payload.campaign_name);
      assert.equal(saved.acknowledged_at, null);
      assert.equal(saved.review_reason, null);
      await db.exec("reset role");
      const created = (await db.query("select * from customers where id=$1", [saved.customer_id])).rows[0];
      assert.equal(created.name, payload.name);
      assert.equal(created.phone, "06301234567");
      assert.equal(created.email, "test@example.invalid");
      assert.equal(created.city, payload.city);
      assert.equal(created.postal_code, payload.postal_code);
      assert.equal(created.need, payload.climate_name);
      assert.equal(created.status, "Visszahívandó");
      assert.equal(created.source, "Facebook");
      assert.equal(created.created_at.toISOString(), payload.submitted_at);
      assert.equal(created.created_by, null);
      assert.equal(await scalar("select count(*)::int from quotes"), 2);
      assert.equal(await scalar("select count(*)::int from appointments"), 4);
    });

    await check("replay preserves first snapshot and does not recreate a deleted customer", async () => {
      await role("service_role");
      const saved = await importLead();
      const replay = await importLead("501", { name: "Changed", climate_name: "Changed climate" });
      assert.deepEqual(replay, { ...saved, duplicate: true });
      await db.exec("reset role");
      await db.query("delete from customers where id=$1", [saved.customer_id]);
      await role("service_role");
      const afterDeletion = await importLead();
      assert.equal(afterDeletion.id, saved.id);
      assert.equal(afterDeletion.customer_id, null);
      assert.equal(afterDeletion.duplicate, true);
      await db.exec("reset role");
      assert.equal(await scalar("select count(*)::int from customers"), 2);
      assert.equal(await scalar("select count(*)::int from facebook_lead_imports"), 1);
    });

    await check("independent inquiries match normalized phone and never change existing customer", async () => {
      await db.query("update customers set phone='0036 30 123-4567',email='Existing@Example.Invalid',city='Old city',status='Lezárva',need='Old climate',notes='Keep me' where id=$1", [customer]);
      const before = await scalar("select to_jsonb(c) from customers c where id=$1", [customer]);
      await role("service_role");
      for (const [lead, phone] of [["501", "+36 30 123 4567"], ["502", "06301234567"], ["503", "30/1234567"]]) {
        const result = await importLead(lead, { phone, email: "different@example.invalid" });
        assert.equal(result.status, "matched");
        assert.equal(result.customer_id, customer);
      }
      const emailMatch = await importLead("504", { phone: "", email: " EXISTING@example.invalid " });
      assert.equal(emailMatch.customer_id, customer);
      assert.equal(emailMatch.status, "matched");
      await db.exec("reset role");
      assert.deepEqual(await scalar("select to_jsonb(c) from customers c where id=$1", [customer]), before);
      assert.equal(await scalar("select count(*)::int from facebook_lead_imports"), 4);
      assert.equal(await scalar("select signature_data_url from work_reports"), "SYNTHETIC-SIGNATURE");
    });

    await check("missing and ambiguous contacts stay visible for review without customer writes", async () => {
      await db.query("update customers set phone=$1 where id=$2", ["06301234567", customer]);
      await db.query("insert into customers(id,workspace_id,name,email) values(gen_random_uuid(),$1,'Another person',$2)", [workspace, payload.email.toLowerCase()]);
      const before = await scalar("select count(*)::int from customers");
      await role("service_role");
      for (const [lead, patch, reason] of [
        ["501", { phone: "", email: "" }, "no_contact"],
        ["502", { phone: "abc", email: "bad-email" }, "no_contact"],
        ["503", { name: "   " }, "missing_name"],
        ["504", {}, "ambiguous_contact"],
      ]) {
        const saved = await importLead(lead, patch);
        assert.equal(saved.status, "review");
        assert.equal(saved.review_reason, reason);
        assert.equal(saved.customer_id, null);
      }
      await db.exec("reset role");
      assert.equal(await scalar("select count(*)::int from customers"), before);
      assert.equal(await scalar("select count(*)::int from facebook_lead_imports"), 4);
    });

    await check("matching and deduplication never cross workspaces or pages", async () => {
      await db.query("update customers set phone='06301234567' where id=$1", [foreignCustomer]);
      await role("service_role");
      const local = await importLead();
      assert.equal(local.status, "created");
      assert.notEqual(local.customer_id, foreignCustomer);
      const foreign = await importLead("501", {}, otherWorkspace);
      assert.equal(foreign.status, "matched");
      assert.equal(foreign.customer_id, foreignCustomer);
      assert.equal(foreign.duplicate, false);
      const otherPage = await importLead("501", {}, workspace, "102");
      assert.equal(otherPage.status, "matched");
      assert.equal(otherPage.customer_id, local.customer_id);
      assert.equal(otherPage.duplicate, false);
    });

    await check("blank contacts never match unrelated customers", async () => {
      await role("service_role");
      const saved = await importLead("501", { phone: "", email: "unique@example.invalid" });
      assert.equal(saved.status, "created");
      assert.notEqual(saved.customer_id, customer);
    });

    await check("invalid payloads and inactive scopes make no partial writes", async () => {
      await role("service_role");
      for (const patch of [{ name: "x".repeat(301) }, { phone: {} }, { submitted_at: "yesterday" },
        { submitted_at: "2026-99-06T10:30:00Z" }, { ad_id: "not-id" }, { customer_id: customer }]) {
        await rejected(() => importLead("501", patch), /hosszú|mezőtípus|idő|out of range|azonosító|Ismeretlen/i);
      }
      await rejected(() => importLead("not-id"), /azonosító/);
      await rejected(() => importLead("501", {}, "10000000-0000-0000-0000-000000000099"), /munkaterülete/);
      await db.exec("reset role");
      await db.query("update workspaces set active=false where id=$1", [workspace]);
      await role("service_role");
      await rejected(() => importLead(), /inaktív/);
      await db.exec("reset role");
      assert.equal(await scalar("select count(*)::int from customers"), 2);
      assert.equal(await scalar("select count(*)::int from facebook_lead_imports"), 0);
    });

    await check("ledger insertion failure rolls back customer creation atomically", async () => {
      await db.exec("create function fail_import_test() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end; $$; create trigger fail_import_test before insert on facebook_lead_imports for each row execute function fail_import_test()");
      await role("service_role");
      await rejected(() => importLead(), /injected failure/);
      await db.exec("reset role");
      assert.equal(await scalar("select count(*)::int from customers"), 2);
      assert.equal(await scalar("select count(*)::int from facebook_lead_imports"), 0);
    });

    await check("only service role can import; even an accidental execute grant fails closed", async () => {
      for (const deniedRole of ["authenticated", "anon"]) {
        await role(deniedRole);
        await rejected(() => importLead(), /permission denied/);
      }
      await db.exec("reset role; grant execute on function public.import_facebook_lead(uuid,text,text,jsonb) to authenticated");
      await role("authenticated");
      await rejected(() => importLead(), /csak a szerver/);
      await role("service_role");
      await importLead();
      assert.deepEqual((await db.query("select lead_id from facebook_lead_imports where workspace_id=$1 and page_id=$2", [workspace, "101"])).rows,
        [{ lead_id: "501" }]);
      for (const statement of ["select * from facebook_lead_imports", "select name from facebook_lead_imports",
        "select phone,email from facebook_lead_imports"]) {
        await rejected(() => db.exec(statement), /permission denied/);
      }
      for (const deniedRole of ["authenticated", "anon", "service_role"]) {
        await role(deniedRole);
        for (const statement of ["delete from facebook_lead_imports", "update facebook_lead_imports set name='Changed'",
          "insert into facebook_lead_imports default values"]) {
          await rejected(() => db.exec(statement), /permission denied/);
        }
      }
    });

    await check("member-only reads and scoped idempotent acknowledgement", async () => {
      await role("service_role");
      const own = await importLead();
      const foreign = await importLead("501", {}, otherWorkspace);
      await role("authenticated");
      assert.equal(await scalar("select count(*)::int from facebook_lead_imports"), 1);
      const acknowledge = (ws = workspace, id = own.id) => scalar("select acknowledge_facebook_lead($1,$2)", [ws, id]);
      const acknowledged = await acknowledge();
      assert.equal(acknowledged.acknowledged_by, user);
      assert.ok(acknowledged.acknowledged_at);
      assert.deepEqual(await acknowledge(), acknowledged);
      assert.deepEqual({ ...acknowledged, acknowledged_at: null, acknowledged_by: null },
        Object.fromEntries(Object.entries(own).filter(([key]) => key !== "duplicate")));
      await rejected(() => acknowledge(otherWorkspace, foreign.id), /hozzáférés/);
      await rejected(() => acknowledge(workspace, foreign.id), /nem található/);
      await role("authenticated", otherUser);
      assert.equal(await scalar("select count(*)::int from facebook_lead_imports"), 1);
      await rejected(() => acknowledge(), /hozzáférés/);
      await db.exec("reset role");
      await db.query("update workspace_members set active=false where workspace_id=$1 and user_id=$2", [workspace, user]);
      await role("authenticated");
      assert.equal(await scalar("select count(*)::int from facebook_lead_imports"), 0);
      await rejected(() => acknowledge(), /hozzáférés/);
      await role("anon");
      await rejected(() => db.query("select * from facebook_lead_imports"), /permission denied/);
      await rejected(() => acknowledge(), /permission denied/);
    });

    await check("queued duplicate deliveries leave one customer and one ledger entry", async () => {
      await role("service_role");
      const replies = await Promise.all(Array.from({ length: 8 }, () => importLead()));
      assert.equal(replies.filter(row => !row.duplicate).length, 1);
      assert.equal(new Set(replies.map(row => row.id)).size, 1);
      await db.exec("reset role");
      assert.equal(await scalar("select count(*)::int from customers"), 3);
      assert.equal(await scalar("select count(*)::int from facebook_lead_imports"), 1);
    });

    for (const [name, mutation] of [
      ["unknown table shape", "alter table facebook_lead_imports add column unexpected text"],
      ["changed RPC", "create or replace function public.facebook_lead_phone_key(p_phone text) returns text language sql as $$select 'changed'::text$$"],
      ["unknown read policy", "create policy unexpected on facebook_lead_imports for select to anon using(true)"],
      ["changed member policy", "alter policy facebook_lead_member_read on facebook_lead_imports using(true)"],
    ]) {
      await t.test(`migration rolls back on ${name}`, async () => {
        try {
          await db.exec(`reset role; begin; ${mutation}`);
          await assert.rejects(() => db.exec(migration), /Audit|audit/);
        }
        finally { await db.exec("rollback"); }
        assert.equal(await scalar("select count(*)::int from customers"), 2);
        assert.equal(await scalar("select signature_data_url from work_reports"), "SYNTHETIC-SIGNATURE");
      });
    }
  } finally { await db.close(); }
});
