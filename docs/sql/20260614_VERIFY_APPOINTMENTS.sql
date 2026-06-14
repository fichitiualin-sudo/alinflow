-- AlinFlow appointments migration verification
-- Read-only: run after the first migration and after every rerun.

select jsonb_build_object(
  'appointments_exists', to_regclass('public.appointments') is not null,
  'jobs_total', (select count(*) from public.jobs),
  'appointments_total', (select count(*) from public.appointments),
  'legacy_appointments', (
    select count(*)
    from public.appointments
    where legacy_source_key like 'jobs:%'
  ),
  'missing_legacy_rows', (
    select count(*)
    from public.jobs jobs
    where not exists (
      select 1
      from public.appointments appointments
      where appointments.legacy_source_key = 'jobs:' || jobs.id::text
    )
  ),
  'duplicate_legacy_keys', (
    select count(*)
    from (
      select legacy_source_key
      from public.appointments
      where legacy_source_key is not null
      group by legacy_source_key
      having count(*) > 1
    ) duplicates
  ),
  'legacy_value_mismatches', (
    select count(*)
    from public.jobs jobs
    join public.appointments appointments
      on appointments.legacy_source_key = 'jobs:' || jobs.id::text
    where row(
      appointments.customer_id,
      appointments.quote_id,
      appointments.title,
      appointments.scheduled_date,
      appointments.scheduled_time,
      appointments.appointment_type,
      appointments.status,
      appointments.address,
      appointments.notes,
      appointments.created_by,
      appointments.created_at,
      appointments.updated_at
    ) is distinct from row(
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
      jobs.created_at,
      jobs.updated_at
    )
  ),
  'invalid_appointment_types', (
    select count(*)
    from public.appointments
    where appointment_type not in ('installation', 'survey', 'maintenance')
  ),
  'appointments_by_type', (
    select coalesce(
      jsonb_object_agg(appointment_type, appointment_count),
      '{}'::jsonb
    )
    from (
      select appointment_type, count(*) as appointment_count
      from public.appointments
      group by appointment_type
    ) grouped_appointments
  ),
  'legacy_unique_index_exists', (
    select to_regclass(
      'public.appointments_legacy_source_key_uidx'
    ) is not null
  ),
  'appointment_type_constraint_count', (
    select count(*)
    from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_appointment_type_check'
  ),
  'rls_enabled', (
    select relrowsecurity
    from pg_class
    where oid = 'public.appointments'::regclass
  ),
  'policy_count', (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'appointments'
      and policyname = 'AlinFlow authenticated manage appointments'
  ),
  'updated_at_trigger_count', (
    select count(*)
    from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'set_appointments_updated_at'
      and not tgisinternal
  )
) as appointments_migration_verification;
