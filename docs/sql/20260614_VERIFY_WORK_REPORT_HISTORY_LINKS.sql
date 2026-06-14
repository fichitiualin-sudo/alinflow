with summary as (
  select
    'appointment_id column exists' as check_name,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'work_reports'
        and column_name = 'appointment_id'
    ) as passed,
    null::text as details
  union all
  select
    'legacy_source_key column exists',
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'work_reports'
        and column_name = 'legacy_source_key'
    ),
    null::text
  union all
  select
    'legacy_source_key unique index exists',
    to_regclass('public.work_reports_legacy_source_key_uidx') is not null,
    null::text
  union all
  select
    'appointment_id foreign key exists',
    exists (
      select 1
      from pg_constraint
      where conname = 'work_reports_appointment_id_fkey'
        and conrelid = 'public.work_reports'::regclass
    ),
    null::text
  union all
  select
    'work reports missing legacy_source_key',
    count(*) = 0,
    count(*)::text
  from public.work_reports
  where legacy_source_key is null
  union all
  select
    'duplicate work report legacy_source_key',
    count(*) = 0,
    count(*)::text
  from (
    select legacy_source_key
    from public.work_reports
    where legacy_source_key is not null
    group by legacy_source_key
    having count(*) > 1
  ) duplicates
  union all
  select
    'work reports with missing appointment link target',
    count(*) = 0,
    count(*)::text
  from public.work_reports wr
  left join public.appointments a on a.id = wr.appointment_id
  where wr.appointment_id is not null
    and a.id is null
)
select check_name, passed, details
from summary
order by check_name;

select
  coalesce(appointment_type, 'installation') as appointment_type,
  count(*) as total_reports,
  count(appointment_id) as linked_reports
from public.work_reports
group by coalesce(appointment_type, 'installation')
order by appointment_type;
