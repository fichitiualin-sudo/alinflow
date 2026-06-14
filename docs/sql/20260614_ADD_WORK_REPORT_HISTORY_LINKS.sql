begin;

alter table public.work_reports
  add column if not exists appointment_id uuid;

alter table public.work_reports
  add column if not exists legacy_source_key text;

update public.work_reports
set legacy_source_key = 'work_reports:' || id::text
where legacy_source_key is null;

create unique index if not exists work_reports_legacy_source_key_uidx
  on public.work_reports (legacy_source_key)
  where legacy_source_key is not null;

create index if not exists work_reports_appointment_id_idx
  on public.work_reports (appointment_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'work_reports_appointment_id_fkey'
      and conrelid = 'public.work_reports'::regclass
  ) then
    alter table public.work_reports
      add constraint work_reports_appointment_id_fkey
      foreign key (appointment_id)
      references public.appointments(id)
      on delete set null;
  end if;
end;
$$;

with matches as (
  select
    wr.id as report_id,
    a.id as appointment_id,
    count(*) over (partition by wr.id) as match_count,
    row_number() over (
      partition by wr.id
      order by
        case when coalesce(a.scheduled_time, '') = coalesce(wr.work_time, '') then 0 else 1 end,
        a.updated_at desc nulls last,
        a.created_at desc nulls last,
        a.id desc
    ) as match_rank
  from public.work_reports wr
  join public.appointments a
    on a.customer_id = wr.customer_id
   and a.scheduled_date = wr.work_date
   and coalesce(a.appointment_type, 'installation') = coalesce(wr.appointment_type, 'installation')
  where wr.appointment_id is null
    and wr.work_date is not null
)
update public.work_reports wr
set appointment_id = matches.appointment_id
from matches
where wr.id = matches.report_id
  and matches.match_count = 1
  and matches.match_rank = 1
  and wr.appointment_id is null;

commit;
