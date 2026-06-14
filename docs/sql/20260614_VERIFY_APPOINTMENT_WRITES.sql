select
  'save function exists' as check_name,
  to_regprocedure('public.save_appointment_with_job_mirror(uuid, uuid, uuid, text, date, text, text, text, text, text, uuid)') is not null as passed;

select
  'cancel function exists' as check_name,
  to_regprocedure('public.cancel_appointment_with_job_mirror(uuid, uuid, timestamptz, text)') is not null as passed;

select
  'save function executable by authenticated' as check_name,
  has_function_privilege(
    'authenticated',
    'public.save_appointment_with_job_mirror(uuid, uuid, uuid, text, date, text, text, text, text, text, uuid)',
    'execute'
  ) as passed;

select
  'cancel function executable by authenticated' as check_name,
  has_function_privilege(
    'authenticated',
    'public.cancel_appointment_with_job_mirror(uuid, uuid, timestamptz, text)',
    'execute'
  ) as passed;

select
  'appointments without customer' as check_name,
  count(*) as row_count
from public.appointments a
left join public.customers c on c.id = a.customer_id
where c.id is null;

select
  'appointments without valid legacy jobs mirror' as check_name,
  count(*) as row_count
from public.appointments a
left join public.jobs j on j.id = case
  when a.legacy_source_key ~ '^jobs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then substring(a.legacy_source_key from 6)::uuid
  else null
end
where a.legacy_source_key ~ '^jobs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and j.id is null;

select
  'duplicate appointment legacy_source_key' as check_name,
  legacy_source_key,
  count(*) as row_count
from public.appointments
where legacy_source_key is not null
group by legacy_source_key
having count(*) > 1;

select
  'appointments by type/status' as check_name,
  appointment_type,
  status,
  count(*) as row_count
from public.appointments
group by appointment_type, status
order by appointment_type, status;

with summary as (
  select
    'save function exists' as check_name,
    (to_regprocedure('public.save_appointment_with_job_mirror(uuid, uuid, uuid, text, date, text, text, text, text, text, uuid)') is not null) as passed,
    null::text as details
  union all
  select
    'cancel function exists',
    (to_regprocedure('public.cancel_appointment_with_job_mirror(uuid, uuid, timestamptz, text)') is not null),
    null::text
  union all
  select
    'save function executable by authenticated',
    has_function_privilege(
      'authenticated',
      'public.save_appointment_with_job_mirror(uuid, uuid, uuid, text, date, text, text, text, text, text, uuid)',
      'execute'
    ),
    null::text
  union all
  select
    'cancel function executable by authenticated',
    has_function_privilege(
      'authenticated',
      'public.cancel_appointment_with_job_mirror(uuid, uuid, timestamptz, text)',
      'execute'
    ),
    null::text
  union all
  select
    'appointments without customer',
    count(*) = 0,
    count(*)::text
  from public.appointments a
  left join public.customers c on c.id = a.customer_id
  where c.id is null
  union all
  select
    'appointments without valid legacy jobs mirror',
    count(*) = 0,
    count(*)::text
  from public.appointments a
  left join public.jobs j on j.id = case
    when a.legacy_source_key ~ '^jobs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then substring(a.legacy_source_key from 6)::uuid
    else null
  end
  where a.legacy_source_key ~ '^jobs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and j.id is null
  union all
  select
    'duplicate appointment legacy_source_key',
    count(*) = 0,
    count(*)::text
  from (
    select legacy_source_key
    from public.appointments
    where legacy_source_key is not null
    group by legacy_source_key
    having count(*) > 1
  ) duplicates
)
select check_name, passed, details
from summary
order by check_name;
