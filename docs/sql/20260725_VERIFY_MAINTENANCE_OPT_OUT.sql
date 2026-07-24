-- 20260725_VERIFY_MAINTENANCE_OPT_OUT.sql
-- Ellenorzes a "nem ker karbantartast" jeloleshez.

select
  'appointments.maintenance_opt_out exists' as check_name,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'maintenance_opt_out'
  ) as passed
union all
select
  'appointments.maintenance_opt_out_at exists' as check_name,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'maintenance_opt_out_at'
  ) as passed
union all
select
  'appointments maintenance opt-out index exists' as check_name,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'appointments'
      and indexname = 'appointments_maintenance_opt_out_idx'
  ) as passed
union all
select
  'opt-out rows have timestamp' as check_name,
  not exists (
    select 1
    from public.appointments
    where maintenance_opt_out = true
      and maintenance_opt_out_at is null
  ) as passed;

select
  count(*) filter (
    where appointment_type = 'installation'
      and coalesce(status, '') <> 'Lemondva'
  ) as active_installation_appointments,
  count(*) filter (
    where appointment_type = 'installation'
      and coalesce(status, '') <> 'Lemondva'
      and maintenance_opt_out = true
  ) as maintenance_opt_out_installations
from public.appointments;
