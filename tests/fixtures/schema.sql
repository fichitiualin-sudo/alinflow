-- Synthetic schema only. No production records or credentials.
create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.workspace_members(workspace_id uuid,user_id uuid,active boolean,primary key(workspace_id,user_id));
create table public.customers(id uuid primary key,workspace_id uuid,name text,status text,stock_deducted boolean default false,updated_at timestamptz default now());
create table public.quotes(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid references customers(id),
 appointment_id uuid,status text,notes text,total_amount numeric,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.appointments(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid references customers(id),quote_id uuid references quotes(id),
 title text,scheduled_date date,scheduled_time text,appointment_type text,status text,address text,notes text,created_by uuid,
 legacy_source_key text unique,cancelled_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
alter table quotes add foreign key(appointment_id) references appointments(id);
create table public.jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid references customers(id),quote_id uuid references quotes(id),
 title text,scheduled_date date,scheduled_time text,appointment_type text,status text,address text,notes text,created_by uuid,
 legacy_source_key text unique,cancelled_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.quote_items(id uuid primary key default gen_random_uuid(),workspace_id uuid,quote_id uuid references quotes(id),
 product_name text,description text,quantity numeric,unit_price numeric,total_price numeric);
create table public.work_reports(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid references customers(id),
 appointment_id uuid references appointments(id),appointment_type text,work_date date,work_time text,signature_data_url text);
create table public.work_checklists(customer_id uuid primary key references customers(id),workspace_id uuid,appointment_id uuid references appointments(id),
 worksheet boolean default false,signature boolean default false,alin_invoice boolean default false,amova_invoice boolean default false);
create table public.documents(id uuid primary key default gen_random_uuid(),workspace_id uuid,customer_id uuid references customers(id),
 appointment_id uuid references appointments(id),document_type text,title text,status text,sent_at timestamptz,created_by uuid,
 unique(customer_id,document_type));
create unique index documents_workspace_customer_type_appointment_uidx on documents(workspace_id,customer_id,document_type,appointment_id);
create table public.inventory_stock(workspace_id uuid,product_id text,stock numeric,primary key(workspace_id,product_id));
create table public.climate_products(id text primary key,workspace_id uuid,name text);
create table public.material_inventory(workspace_id uuid,name text,stock numeric,primary key(workspace_id,name));

insert into workspace_members values
 ('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',true),
 ('10000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000002',true);
insert into customers(id,workspace_id,name) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Customer One'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Foreign Customer');
insert into quotes(id,workspace_id,customer_id,status,total_amount) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Időpont foglalva',200),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Időpont foglalva',100);
insert into appointments(id,workspace_id,customer_id,quote_id,scheduled_date,scheduled_time,appointment_type,status) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-09-06','08:00','installation','Időpont foglalva'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','2026-09-07','08:00','installation','Időpont foglalva'),
 ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',null,'2025-01-01','08:00','installation','Lezárva'),
 ('40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',null,'2026-01-01','08:00','survey','Időpont foglalva');
update quotes set appointment_id='40000000-0000-0000-0000-000000000001' where id='30000000-0000-0000-0000-000000000001';
update quotes set appointment_id='40000000-0000-0000-0000-000000000002' where id='30000000-0000-0000-0000-000000000002';
insert into quote_items(workspace_id,quote_id,product_name,description,quantity,unit_price,total_price) values
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','AC','ac|install_price=0',2,100,200),
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','AC','ac|install_price=0',1,100,100);
insert into inventory_stock values('10000000-0000-0000-0000-000000000001','ac',10);
insert into climate_products values('ac','10000000-0000-0000-0000-000000000001','AC');
insert into material_inventory values('10000000-0000-0000-0000-000000000001','Pipe',20);
insert into work_reports(id,workspace_id,customer_id,appointment_id,appointment_type,work_date,work_time,signature_data_url)
 values('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
 '40000000-0000-0000-0000-000000000003','installation','2025-01-01','08:00','SYNTHETIC-SIGNATURE');
insert into work_checklists(customer_id,workspace_id,appointment_id,signature) values(
 '20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003',true);
insert into documents(workspace_id,customer_id,appointment_id,document_type,title,status) values(
 '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','work_report','Existing Report','Aláírva');

grant usage on schema public,auth to authenticated,anon;
grant select,insert,update,delete on all tables in schema public to authenticated;
do $$
declare t text;
begin
 foreach t in array array['customers','quotes','quote_items','appointments','jobs','documents','work_reports','work_checklists','inventory_stock','material_inventory'] loop
 execute format('alter table %I enable row level security',t);
 execute format('create policy member_all on %I for all to authenticated using(exists(select 1 from workspace_members wm where wm.workspace_id=%I.workspace_id and wm.user_id=auth.uid() and wm.active)) with check(exists(select 1 from workspace_members wm where wm.workspace_id=%I.workspace_id and wm.user_id=auth.uid() and wm.active))',t,t,t);
 end loop;
end;
$$;
