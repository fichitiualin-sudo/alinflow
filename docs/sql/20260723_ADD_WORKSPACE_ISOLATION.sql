begin;

create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_user_id uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_id_idx
  on public.workspace_members (user_id);

create or replace function public.admin_create_workspace_for_user(
  p_user_email text,
  p_workspace_name text,
  p_workspace_slug text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_workspace_id uuid;
begin
  select u.id
    into v_user_id
    from auth.users u
    where lower(u.email) = lower(trim(p_user_email))
    limit 1;

  if v_user_id is null then
    raise exception 'No Supabase auth user found for email: %', p_user_email;
  end if;

  insert into public.workspaces (name, slug, owner_user_id)
  values (trim(p_workspace_name), trim(p_workspace_slug), v_user_id)
  on conflict (slug) do update
    set name = excluded.name,
        owner_user_id = coalesce(public.workspaces.owner_user_id, excluded.owner_user_id),
        active = true,
        updated_at = now()
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role, active)
  values (v_workspace_id, v_user_id, 'owner', true)
  on conflict (workspace_id, user_id) do update
    set role = excluded.role,
        active = true;

  return v_workspace_id;
end;
$$;

revoke execute on function public.admin_create_workspace_for_user(text, text, text) from public;
revoke execute on function public.admin_create_workspace_for_user(text, text, text) from anon;
revoke execute on function public.admin_create_workspace_for_user(text, text, text) from authenticated;

do $$
begin
  alter table public.customers add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.appointments add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.jobs add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.quotes add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.quote_items add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.documents add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.work_reports add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.work_checklists add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.purchase_declarations add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.maintenance_appointment_items add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.seller_companies add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.climate_products add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.inventory_stock add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
  alter table public.material_inventory add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
exception
  when undefined_table then
    raise notice 'Some optional AlinFlow tables are missing. Run the earlier AlinFlow migrations before workspace isolation.';
end $$;

create index if not exists customers_workspace_id_idx on public.customers (workspace_id);
create index if not exists appointments_workspace_id_idx on public.appointments (workspace_id);
create index if not exists jobs_workspace_id_idx on public.jobs (workspace_id);
create index if not exists quotes_workspace_id_idx on public.quotes (workspace_id);
create index if not exists quote_items_workspace_id_idx on public.quote_items (workspace_id);
create index if not exists documents_workspace_id_idx on public.documents (workspace_id);
create index if not exists work_reports_workspace_id_idx on public.work_reports (workspace_id);
create index if not exists work_checklists_workspace_id_idx on public.work_checklists (workspace_id);
create index if not exists purchase_declarations_workspace_id_idx on public.purchase_declarations (workspace_id);
create index if not exists maintenance_appointment_items_workspace_id_idx on public.maintenance_appointment_items (workspace_id);
create index if not exists seller_companies_workspace_id_idx on public.seller_companies (workspace_id);
create index if not exists climate_products_workspace_id_idx on public.climate_products (workspace_id);
create index if not exists inventory_stock_workspace_id_idx on public.inventory_stock (workspace_id);
create index if not exists material_inventory_workspace_id_idx on public.material_inventory (workspace_id);

create unique index if not exists inventory_stock_workspace_product_uidx
  on public.inventory_stock (workspace_id, product_id);

do $$
declare
  v_material_pk text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'material_inventory'
      and column_name = 'id'
  ) then
    return;
  end if;

  alter table public.material_inventory
    add column id uuid default gen_random_uuid();

  update public.material_inventory
    set id = gen_random_uuid()
    where id is null;

  alter table public.material_inventory
    alter column id set not null;

  select c.conname
    into v_material_pk
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'material_inventory'
      and c.contype = 'p'
    limit 1;

  if v_material_pk is not null then
    execute format('alter table public.material_inventory drop constraint %I', v_material_pk);
  end if;

  alter table public.material_inventory
    add constraint material_inventory_pkey primary key (id);
end $$;

create unique index if not exists material_inventory_workspace_name_uidx
  on public.material_inventory (workspace_id, name);

do $$
declare
  v_seller_uidx text;
begin
  if exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'seller_companies'
      and indexname = 'seller_companies_name_tax_uidx'
  ) then
    drop index public.seller_companies_name_tax_uidx;
  end if;
end $$;

create unique index if not exists seller_companies_workspace_name_tax_uidx
  on public.seller_companies (workspace_id, name, tax_number);

do $$
declare
  v_workspace_id uuid;
begin
  insert into public.workspaces (name, slug)
  values ('AlinFlow - meglevo adatok', 'alinflow-existing')
  on conflict (slug) do update
    set active = true,
        updated_at = now()
  returning id into v_workspace_id;

  update public.customers set workspace_id = v_workspace_id where workspace_id is null;
  update public.appointments a set workspace_id = coalesce(c.workspace_id, v_workspace_id)
    from public.customers c
    where a.workspace_id is null and c.id = a.customer_id;
  update public.appointments set workspace_id = v_workspace_id where workspace_id is null;

  update public.jobs j set workspace_id = coalesce(c.workspace_id, v_workspace_id)
    from public.customers c
    where j.workspace_id is null and c.id = j.customer_id;
  update public.jobs set workspace_id = v_workspace_id where workspace_id is null;

  update public.quotes q set workspace_id = coalesce(a.workspace_id, v_workspace_id)
    from public.appointments a
    where q.workspace_id is null and a.id = q.appointment_id;
  update public.quotes q set workspace_id = coalesce(c.workspace_id, v_workspace_id)
    from public.customers c
    where q.workspace_id is null and c.id = q.customer_id;
  update public.quotes set workspace_id = v_workspace_id where workspace_id is null;

  update public.quote_items qi set workspace_id = coalesce(q.workspace_id, v_workspace_id)
    from public.quotes q
    where qi.workspace_id is null and q.id = qi.quote_id;
  update public.quote_items set workspace_id = v_workspace_id where workspace_id is null;

  update public.documents d set workspace_id = coalesce(a.workspace_id, v_workspace_id)
    from public.appointments a
    where d.workspace_id is null and a.id = d.appointment_id;
  update public.documents d set workspace_id = coalesce(c.workspace_id, v_workspace_id)
    from public.customers c
    where d.workspace_id is null and c.id = d.customer_id;
  update public.documents set workspace_id = v_workspace_id where workspace_id is null;

  update public.work_reports wr set workspace_id = coalesce(a.workspace_id, v_workspace_id)
    from public.appointments a
    where wr.workspace_id is null and a.id = wr.appointment_id;
  update public.work_reports wr set workspace_id = coalesce(c.workspace_id, v_workspace_id)
    from public.customers c
    where wr.workspace_id is null and c.id = wr.customer_id;
  update public.work_reports set workspace_id = v_workspace_id where workspace_id is null;

  update public.work_checklists wc set workspace_id = coalesce(a.workspace_id, v_workspace_id)
    from public.appointments a
    where wc.workspace_id is null and a.id = wc.appointment_id;
  update public.work_checklists wc set workspace_id = coalesce(c.workspace_id, v_workspace_id)
    from public.customers c
    where wc.workspace_id is null and c.id = wc.customer_id;
  update public.work_checklists set workspace_id = v_workspace_id where workspace_id is null;

  update public.purchase_declarations pd set workspace_id = coalesce(a.workspace_id, v_workspace_id)
    from public.appointments a
    where pd.workspace_id is null and a.id = pd.appointment_id;
  update public.purchase_declarations pd set workspace_id = coalesce(c.workspace_id, v_workspace_id)
    from public.customers c
    where pd.workspace_id is null and c.id = pd.customer_id;
  update public.purchase_declarations set workspace_id = v_workspace_id where workspace_id is null;

  update public.maintenance_appointment_items mai set workspace_id = coalesce(a.workspace_id, v_workspace_id)
    from public.appointments a
    where mai.workspace_id is null and a.id = mai.maintenance_appointment_id;
  update public.maintenance_appointment_items mai set workspace_id = coalesce(c.workspace_id, v_workspace_id)
    from public.customers c
    where mai.workspace_id is null and c.id = mai.customer_id;
  update public.maintenance_appointment_items set workspace_id = v_workspace_id where workspace_id is null;

  update public.seller_companies set workspace_id = v_workspace_id where workspace_id is null;
  update public.climate_products set workspace_id = v_workspace_id where workspace_id is null;
  update public.inventory_stock set workspace_id = v_workspace_id where workspace_id is null;
  update public.material_inventory set workspace_id = v_workspace_id where workspace_id is null;

  insert into public.workspace_members (workspace_id, user_id, role, active)
  select distinct v_workspace_id, created_by, 'owner', true
  from (
    select created_by from public.customers where created_by is not null
    union
    select created_by from public.appointments where created_by is not null
    union
    select created_by from public.jobs where created_by is not null
    union
    select created_by from public.quotes where created_by is not null
    union
    select created_by from public.documents where created_by is not null
    union
    select created_by from public.work_reports where created_by is not null
    union
    select created_by from public.purchase_declarations where created_by is not null
  ) creators
  on conflict (workspace_id, user_id) do update
    set active = true;
end $$;

create unique index if not exists documents_workspace_customer_type_appointment_uidx
  on public.documents (workspace_id, customer_id, document_type, appointment_id);

create unique index if not exists work_checklists_workspace_customer_appointment_uidx
  on public.work_checklists (workspace_id, customer_id, appointment_id);

create unique index if not exists work_checklists_workspace_customer_legacy_uidx
  on public.work_checklists (workspace_id, customer_id)
  where appointment_id is null;

create or replace function public.save_appointment_with_job_mirror(
  p_appointment_id uuid,
  p_customer_id uuid,
  p_quote_id uuid,
  p_title text,
  p_scheduled_date date,
  p_scheduled_time text,
  p_appointment_type text,
  p_status text,
  p_address text,
  p_notes text,
  p_created_by uuid,
  p_workspace_id uuid default null
)
returns table(appointment_id uuid, job_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_appointment_id uuid;
  v_legacy_source_key text;
  v_job_id uuid;
  v_existing_job_id uuid;
  v_job_key text;
  v_customer_workspace_id uuid;
  v_workspace_id uuid;
begin
  if p_customer_id is null then
    raise exception 'customer_id is required';
  end if;

  if p_scheduled_date is null then
    raise exception 'scheduled_date is required';
  end if;

  if coalesce(trim(p_scheduled_time), '') = '' then
    raise exception 'scheduled_time is required';
  end if;

  if coalesce(p_appointment_type, '') not in ('installation', 'survey', 'maintenance') then
    raise exception 'unsupported appointment_type: %', p_appointment_type;
  end if;

  select c.workspace_id
    into v_customer_workspace_id
    from public.customers c
    where c.id = p_customer_id;

  v_workspace_id := coalesce(p_workspace_id, v_customer_workspace_id);

  if v_workspace_id is null then
    raise exception 'workspace_id is required';
  end if;

  if v_customer_workspace_id is not null and v_customer_workspace_id <> v_workspace_id then
    raise exception 'customer workspace mismatch';
  end if;

  if p_appointment_id is not null then
    update public.appointments a
      set quote_id = p_quote_id,
          title = p_title,
          scheduled_date = p_scheduled_date,
          scheduled_time = p_scheduled_time,
          appointment_type = p_appointment_type,
          status = p_status,
          address = p_address,
          notes = p_notes,
          workspace_id = v_workspace_id,
          cancelled_at = null,
          updated_at = now()
      where a.id = p_appointment_id
        and a.customer_id = p_customer_id
        and a.workspace_id = v_workspace_id
      returning a.id, a.legacy_source_key
      into v_appointment_id, v_legacy_source_key;
  end if;

  if v_appointment_id is null then
    insert into public.appointments (
      customer_id,
      quote_id,
      title,
      scheduled_date,
      scheduled_time,
      appointment_type,
      status,
      address,
      notes,
      created_by,
      workspace_id
    )
    values (
      p_customer_id,
      p_quote_id,
      p_title,
      p_scheduled_date,
      p_scheduled_time,
      p_appointment_type,
      p_status,
      p_address,
      p_notes,
      p_created_by,
      v_workspace_id
    )
    returning id, legacy_source_key
    into v_appointment_id, v_legacy_source_key;
  end if;

  update public.quotes q
    set appointment_id = v_appointment_id,
        workspace_id = v_workspace_id
    where q.id = p_quote_id
      and q.workspace_id = v_workspace_id
      and q.appointment_id is distinct from v_appointment_id;

  if v_legacy_source_key ~ '^jobs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_existing_job_id := substring(v_legacy_source_key from 6)::uuid;

    update public.jobs j
      set quote_id = p_quote_id,
          title = p_title,
          scheduled_date = p_scheduled_date,
          scheduled_time = p_scheduled_time,
          appointment_type = p_appointment_type,
          status = p_status,
          address = p_address,
          notes = p_notes,
          workspace_id = v_workspace_id,
          cancelled_at = null,
          updated_at = now()
      where j.id = v_existing_job_id
        and j.workspace_id = v_workspace_id
      returning j.id
      into v_job_id;
  end if;

  if v_job_id is null then
    v_job_key := 'appointments:' || v_appointment_id::text;

    select j.id
      into v_job_id
      from public.jobs j
      where j.legacy_source_key = v_job_key
        and j.workspace_id = v_workspace_id
      limit 1;

    if v_job_id is null then
      insert into public.jobs (
        customer_id,
        quote_id,
        title,
        scheduled_date,
        scheduled_time,
        appointment_type,
        status,
        address,
        notes,
        created_by,
        legacy_source_key,
        workspace_id
      )
      values (
        p_customer_id,
        p_quote_id,
        p_title,
        p_scheduled_date,
        p_scheduled_time,
        p_appointment_type,
        p_status,
        p_address,
        p_notes,
        p_created_by,
        v_job_key,
        v_workspace_id
      )
      returning id
      into v_job_id;
    else
      update public.jobs j
        set quote_id = p_quote_id,
            title = p_title,
            scheduled_date = p_scheduled_date,
            scheduled_time = p_scheduled_time,
            appointment_type = p_appointment_type,
            status = p_status,
            address = p_address,
            notes = p_notes,
            workspace_id = v_workspace_id,
            cancelled_at = null,
            updated_at = now()
        where j.id = v_job_id
          and j.workspace_id = v_workspace_id;
    end if;

    update public.appointments a
      set legacy_source_key = 'jobs:' || v_job_id::text
      where a.id = v_appointment_id
        and a.workspace_id = v_workspace_id
        and a.legacy_source_key is null;
  end if;

  return query select v_appointment_id, v_job_id;
end;
$$;

grant execute on function public.save_appointment_with_job_mirror(uuid, uuid, uuid, text, date, text, text, text, text, text, uuid, uuid) to authenticated;

create or replace function public.cancel_appointment_with_job_mirror(
  p_appointment_id uuid,
  p_customer_id uuid,
  p_cancelled_at timestamptz,
  p_status text,
  p_workspace_id uuid default null
)
returns table(appointment_id uuid, job_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_appointment_id uuid;
  v_job_id uuid;
  v_legacy_source_key text;
  v_workspace_id uuid;
begin
  select c.workspace_id
    into v_workspace_id
    from public.customers c
    where c.id = p_customer_id;

  v_workspace_id := coalesce(p_workspace_id, v_workspace_id);

  if v_workspace_id is null then
    raise exception 'workspace_id is required';
  end if;

  update public.appointments a
    set status = coalesce(p_status, 'Lemondva'),
        cancelled_at = coalesce(p_cancelled_at, now()),
        updated_at = now()
    where a.id = p_appointment_id
      and a.customer_id = p_customer_id
      and a.workspace_id = v_workspace_id
    returning a.id, a.legacy_source_key
    into v_appointment_id, v_legacy_source_key;

  if v_legacy_source_key ~ '^jobs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_job_id := substring(v_legacy_source_key from 6)::uuid;
  end if;

  if v_job_id is null and v_appointment_id is not null then
    select j.id
      into v_job_id
      from public.jobs j
      where j.legacy_source_key = 'appointments:' || v_appointment_id::text
        and j.workspace_id = v_workspace_id
      limit 1;
  end if;

  if v_job_id is not null then
    update public.jobs j
      set status = coalesce(p_status, 'Lemondva'),
          cancelled_at = coalesce(p_cancelled_at, now()),
          updated_at = now()
      where j.id = v_job_id
        and j.workspace_id = v_workspace_id;
  end if;

  return query select v_appointment_id, v_job_id;
end;
$$;

grant execute on function public.cancel_appointment_with_job_mirror(uuid, uuid, timestamptz, text, uuid) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

do $$
declare
  p record;
begin
  for p in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('workspaces', 'workspace_members')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy workspaces_member_select
  on public.workspaces
  for select
  to authenticated
  using (
    owner_user_id = auth.uid()
    or exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = auth.uid()
        and wm.active
    )
  );

create policy workspaces_self_insert
  on public.workspaces
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

create policy workspaces_owner_update
  on public.workspaces
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy workspace_members_select_own
  on public.workspace_members
  for select
  to authenticated
  using (user_id = auth.uid());

create policy workspace_members_insert_owned_workspace
  on public.workspace_members
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.workspaces w
      where w.id = workspace_members.workspace_id
        and w.owner_user_id = auth.uid()
    )
  );

do $$
declare
  v_table text;
  p record;
begin
  foreach v_table in array array[
    'customers',
    'appointments',
    'jobs',
    'quotes',
    'quote_items',
    'documents',
    'work_reports',
    'work_checklists',
    'purchase_declarations',
    'maintenance_appointment_items',
    'seller_companies',
    'climate_products',
    'inventory_stock',
    'material_inventory'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);

    for p in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = v_table
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, v_table);
    end loop;

    execute format(
      'create policy %I on public.%I for all to authenticated using (exists (select 1 from public.workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = auth.uid() and wm.active)) with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = auth.uid() and wm.active))',
      v_table || '_workspace_member_all',
      v_table,
      v_table,
      v_table
    );
  end loop;
end $$;

commit;
