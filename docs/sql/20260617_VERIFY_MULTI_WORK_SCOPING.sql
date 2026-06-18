select *
from (
  values
    (
      'quotes.appointment_id exists',
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'quotes'
          and column_name = 'appointment_id'
      )
    ),
    (
      'documents.appointment_id exists',
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'documents'
          and column_name = 'appointment_id'
      )
    ),
    (
      'work_checklists.appointment_id exists',
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'work_checklists'
          and column_name = 'appointment_id'
      )
    ),
    (
      'jobs.legacy_source_key exists',
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'jobs'
          and column_name = 'legacy_source_key'
      )
    ),
    (
      'jobs.cancelled_at exists',
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'jobs'
          and column_name = 'cancelled_at'
      )
    ),
    (
      'maintenance link table exists',
      to_regclass('public.maintenance_appointment_items') is not null
    ),
    (
      'documents scoped unique index exists',
      to_regclass('public.documents_customer_type_appointment_uidx') is not null
    ),
    (
      'work_checklists scoped unique index exists',
      to_regclass('public.work_checklists_customer_appointment_uidx') is not null
    ),
    (
      'jobs legacy_source_key unique index exists',
      to_regclass('public.jobs_legacy_source_key_uidx') is not null
    ),
    (
      'save appointment function exists',
      to_regprocedure('public.save_appointment_with_job_mirror(uuid, uuid, uuid, text, date, text, text, text, text, text, uuid)') is not null
    ),
    (
      'appointments with quote linked back to quote',
      not exists (
        select 1
        from public.appointments a
        join public.quotes q on q.id = a.quote_id
        where q.appointment_id is distinct from a.id
      )
    )
) as checks(check_name, passed);
