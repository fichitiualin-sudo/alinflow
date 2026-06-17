begin;

alter table public.quotes
  add column if not exists appointment_id uuid;

alter table public.documents
  add column if not exists appointment_id uuid;

alter table public.work_checklists
  add column if not exists appointment_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quotes_appointment_id_fkey'
      and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_appointment_id_fkey
      foreign key (appointment_id)
      references public.appointments(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'documents_appointment_id_fkey'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
      add constraint documents_appointment_id_fkey
      foreign key (appointment_id)
      references public.appointments(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'work_checklists_appointment_id_fkey'
      and conrelid = 'public.work_checklists'::regclass
  ) then
    alter table public.work_checklists
      add constraint work_checklists_appointment_id_fkey
      foreign key (appointment_id)
      references public.appointments(id)
      on delete set null;
  end if;
end $$;

create index if not exists quotes_appointment_id_idx
  on public.quotes (appointment_id);

create index if not exists documents_appointment_id_idx
  on public.documents (appointment_id);

create index if not exists work_checklists_appointment_id_idx
  on public.work_checklists (appointment_id);

create unique index if not exists documents_customer_type_appointment_uidx
  on public.documents (customer_id, document_type, appointment_id);

create unique index if not exists work_checklists_customer_appointment_uidx
  on public.work_checklists (customer_id, appointment_id);

create table if not exists public.maintenance_appointment_items (
  id uuid primary key default gen_random_uuid(),
  maintenance_appointment_id uuid not null references public.appointments(id) on delete cascade,
  installation_appointment_id uuid not null references public.appointments(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  legacy_source_key text
);

create unique index if not exists maintenance_appointment_items_pair_uidx
  on public.maintenance_appointment_items (maintenance_appointment_id, installation_appointment_id);

create unique index if not exists maintenance_appointment_items_legacy_source_key_uidx
  on public.maintenance_appointment_items (legacy_source_key)
  where legacy_source_key is not null;

alter table public.maintenance_appointment_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'maintenance_appointment_items'
      and policyname = 'AlinFlow authenticated manage maintenance appointment items'
  ) then
    create policy "AlinFlow authenticated manage maintenance appointment items"
      on public.maintenance_appointment_items
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

update public.quotes q
set appointment_id = a.id
from public.appointments a
where q.appointment_id is null
  and a.quote_id = q.id;

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
  p_created_by uuid
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

  if p_appointment_id is not null then
    update public.appointments
      set quote_id = p_quote_id,
          title = p_title,
          scheduled_date = p_scheduled_date,
          scheduled_time = p_scheduled_time,
          appointment_type = p_appointment_type,
          status = p_status,
          address = p_address,
          notes = p_notes,
          cancelled_at = null,
          updated_at = now()
      where id = p_appointment_id
        and customer_id = p_customer_id
      returning id, legacy_source_key
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
      created_by
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
      p_created_by
    )
    returning id, legacy_source_key
    into v_appointment_id, v_legacy_source_key;
  end if;

  update public.quotes
    set appointment_id = v_appointment_id
    where id = p_quote_id
      and appointment_id is distinct from v_appointment_id;

  if v_legacy_source_key ~ '^jobs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_existing_job_id := substring(v_legacy_source_key from 6)::uuid;

    update public.jobs
      set quote_id = p_quote_id,
          title = p_title,
          scheduled_date = p_scheduled_date,
          scheduled_time = p_scheduled_time,
          appointment_type = p_appointment_type,
          status = p_status,
          address = p_address,
          notes = p_notes,
          cancelled_at = null,
          updated_at = now()
      where id = v_existing_job_id
      returning id
      into v_job_id;
  end if;

  if v_job_id is null then
    v_job_key := 'appointments:' || v_appointment_id::text;

    select id
      into v_job_id
      from public.jobs
      where legacy_source_key = v_job_key
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
        legacy_source_key
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
        v_job_key
      )
      returning id
      into v_job_id;
    else
      update public.jobs
        set quote_id = p_quote_id,
            title = p_title,
            scheduled_date = p_scheduled_date,
            scheduled_time = p_scheduled_time,
            appointment_type = p_appointment_type,
            status = p_status,
            address = p_address,
            notes = p_notes,
            cancelled_at = null,
            updated_at = now()
        where id = v_job_id;
    end if;

    update public.appointments
      set legacy_source_key = 'jobs:' || v_job_id::text
      where id = v_appointment_id
        and legacy_source_key is null;
  end if;

  return query select v_appointment_id, v_job_id;
end;
$$;

grant execute on function public.save_appointment_with_job_mirror(uuid, uuid, uuid, text, date, text, text, text, text, text, uuid) to authenticated;

commit;
