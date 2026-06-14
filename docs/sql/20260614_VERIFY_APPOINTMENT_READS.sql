-- AlinFlow compatible appointment read verification
-- Read-only: checks customer, quote, climate item, type, status and date relations.

with current_appointments as (
  select appointment.*
  from (
    select
      appointments.*,
      row_number() over (
        partition by appointments.customer_id
        order by
          case
            when appointments.cancelled_at is not null
              or lower(btrim(appointments.status)) = 'lemondva'
            then 1 else 0
          end,
          appointments.created_at desc,
          appointments.updated_at desc,
          appointments.id desc
      ) as current_rank
    from public.appointments appointments
  ) appointment
  where appointment.current_rank = 1
),
type_counts as (
  select coalesce(
    jsonb_object_agg(appointment_type, row_count),
    '{}'::jsonb
  ) as values
  from (
    select appointment_type, count(*) as row_count
    from public.appointments
    group by appointment_type
  ) grouped
),
status_counts as (
  select coalesce(
    jsonb_object_agg(status, row_count),
    '{}'::jsonb
  ) as values
  from (
    select
      coalesce(nullif(btrim(status), ''), '<empty>') as status,
      count(*) as row_count
    from public.appointments
    group by coalesce(nullif(btrim(status), ''), '<empty>')
  ) grouped
)
select jsonb_build_object(
  'appointments_total', (
    select count(*) from public.appointments
  ),
  'customers_with_appointments', (
    select count(distinct customer_id) from public.appointments
  ),
  'customers_with_multiple_appointments', (
    select count(*)
    from (
      select customer_id
      from public.appointments
      group by customer_id
      having count(*) > 1
    ) multiple
  ),
  'current_appointments', (
    select count(*) from current_appointments
  ),
  'orphan_customers', (
    select count(*)
    from public.appointments appointments
    left join public.customers customers
      on customers.id = appointments.customer_id
    where customers.id is null
  ),
  'orphan_quotes', (
    select count(*)
    from public.appointments appointments
    left join public.quotes quotes
      on quotes.id = appointments.quote_id
    where appointments.quote_id is not null
      and quotes.id is null
  ),
  'quote_customer_mismatches', (
    select count(*)
    from public.appointments appointments
    join public.quotes quotes
      on quotes.id = appointments.quote_id
    where quotes.customer_id is distinct from appointments.customer_id
  ),
  'appointments_with_quote_without_items', (
    select count(*)
    from public.appointments appointments
    where appointments.quote_id is not null
      and not exists (
        select 1
        from public.quote_items items
        where items.quote_id = appointments.quote_id
      )
  ),
  'installation_without_quote', (
    select count(*)
    from public.appointments
    where appointment_type = 'installation'
      and quote_id is null
  ),
  'missing_date', (
    select count(*)
    from public.appointments
    where scheduled_date is null
  ),
  'missing_time', (
    select count(*)
    from public.appointments
    where scheduled_time is null
      or btrim(scheduled_time) = ''
  ),
  'invalid_type', (
    select count(*)
    from public.appointments
    where appointment_type not in (
      'installation',
      'survey',
      'maintenance'
    )
  ),
  'empty_status', (
    select count(*)
    from public.appointments
    where status is null
      or btrim(status) = ''
  ),
  'cancelled_rows', (
    select count(*)
    from public.appointments
    where cancelled_at is not null
      or lower(btrim(status)) = 'lemondva'
  ),
  'legacy_jobs_without_appointment', (
    select count(*)
    from public.jobs jobs
    where not exists (
      select 1
      from public.appointments appointments
      where appointments.legacy_source_key = 'jobs:' || jobs.id::text
    )
  ),
  'legacy_jobs_newer_than_appointment', (
    select count(*)
    from public.jobs jobs
    join public.appointments appointments
      on appointments.legacy_source_key = 'jobs:' || jobs.id::text
    where jobs.updated_at > appointments.updated_at
  ),
  'types', type_counts.values,
  'statuses', status_counts.values
) as appointment_read_audit
from type_counts
cross join status_counts;
