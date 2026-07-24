-- 20260724_VERIFY_MAINTENANCE_MAP_COORDINATES.sql
-- Read-only verification for maintenance map coordinate support.

select
  'appointments.latitude exists' as check_name,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'latitude'
  ) as passed
union all
select
  'appointments.longitude exists',
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'longitude'
  )
union all
select
  'appointments.geocoded_at exists',
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'geocoded_at'
  )
union all
select
  'appointments.geocode_status exists',
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'geocode_status'
  )
union all
select
  'appointments.geocode_error exists',
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointments'
      and column_name = 'geocode_error'
  )
union all
select
  'appointments geocode status constraint exists',
  exists (
    select 1
    from pg_constraint
    where conname = 'appointments_geocode_status_check'
      and conrelid = 'public.appointments'::regclass
  )
union all
select
  'appointments map coordinates index exists',
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'appointments'
      and indexname = 'appointments_map_coordinates_idx'
  )
union all
select
  'appointments geocode status index exists',
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'appointments'
      and indexname = 'appointments_geocode_status_idx'
  )
union all
select
  'stored coordinates are in valid range',
  not exists (
    select 1
    from public.appointments
    where latitude is not null
      and (latitude < -90 or latitude > 90)
  )
  and not exists (
    select 1
    from public.appointments
    where longitude is not null
      and (longitude < -180 or longitude > 180)
  );

select
  count(*) filter (where appointment_type = 'installation' and coalesce(status, '') <> 'Lemondva') as active_installation_appointments,
  count(*) filter (
    where appointment_type = 'installation'
      and coalesce(status, '') <> 'Lemondva'
      and latitude is not null
      and longitude is not null
  ) as mapped_installation_appointments,
  count(*) filter (
    where appointment_type = 'installation'
      and coalesce(status, '') <> 'Lemondva'
      and nullif(trim(coalesce(address, '')), '') is not null
      and (latitude is null or longitude is null)
  ) as installation_appointments_waiting_for_geocode
from public.appointments;
