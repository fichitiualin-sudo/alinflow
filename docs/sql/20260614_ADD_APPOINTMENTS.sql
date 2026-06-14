-- AlinFlow 1.0 - additive appointments table
-- Safe to rerun: schema objects are guarded and legacy rows use a unique source key.

begin;

do $$
declare
  invalid_jobs bigint;
begin
  if to_regclass('public.jobs') is null then
    raise exception 'Required source table public.jobs does not exist';
  end if;

  select count(*)
  into invalid_jobs
  from public.jobs
  where customer_id is null
     or scheduled_date is null
     or scheduled_time is null
     or btrim(scheduled_time) = ''
     or appointment_type not in ('installation', 'survey', 'maintenance');

  if invalid_jobs > 0 then
    raise exception
      'Appointments migration stopped: % jobs rows fail the required backfill checks',
      invalid_jobs;
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Required function public.set_updated_at() does not exist';
  end if;
end
$$;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null
    references public.customers(id) on delete cascade,
  quote_id uuid
    references public.quotes(id) on delete set null,
  title text,
  scheduled_date date not null,
  scheduled_time text not null,
  appointment_type text not null default 'installation',
  status text not null default 'Időpont foglalva',
  address text,
  notes text,
  cancelled_at timestamp with time zone,
  created_by uuid
    references auth.users(id) on delete set null,
  legacy_source_key text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint appointments_appointment_type_check
    check (appointment_type in ('installation', 'survey', 'maintenance'))
);

create unique index if not exists appointments_legacy_source_key_uidx
  on public.appointments (legacy_source_key);

create index if not exists appointments_customer_date_idx
  on public.appointments (
    customer_id,
    scheduled_date desc,
    scheduled_time desc,
    created_at desc
  );

create index if not exists appointments_customer_type_date_idx
  on public.appointments (
    customer_id,
    appointment_type,
    scheduled_date desc,
    created_at desc
  );

create index if not exists appointments_schedule_idx
  on public.appointments (scheduled_date, scheduled_time);

alter table public.appointments enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'appointments'
      and policyname = 'AlinFlow authenticated manage appointments'
  ) then
    create policy "AlinFlow authenticated manage appointments"
      on public.appointments
      as permissive
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'set_appointments_updated_at'
      and not tgisinternal
  ) then
    create trigger set_appointments_updated_at
      before update on public.appointments
      for each row
      execute function public.set_updated_at();
  end if;
end
$$;

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
  legacy_source_key,
  created_at,
  updated_at
)
select
  jobs.customer_id,
  jobs.quote_id,
  jobs.title,
  jobs.scheduled_date,
  jobs.scheduled_time,
  jobs.appointment_type,
  jobs.status,
  jobs.address,
  jobs.notes,
  jobs.created_by,
  'jobs:' || jobs.id::text,
  jobs.created_at,
  jobs.updated_at
from public.jobs
on conflict (legacy_source_key) do nothing;

commit;
