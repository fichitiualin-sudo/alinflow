-- 20260724_ADD_MAINTENANCE_MAP_COORDINATES.sql
-- Additive, idempotent support for showing installed climate units on a maintenance map.

begin;

alter table public.appointments
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geocoded_at timestamptz,
  add column if not exists geocode_status text,
  add column if not exists geocode_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_geocode_status_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_geocode_status_check
      check (
        geocode_status is null
        or geocode_status in ('pending', 'ok', 'failed', 'manual')
      );
  end if;
end $$;

create index if not exists appointments_map_coordinates_idx
  on public.appointments (workspace_id, appointment_type, latitude, longitude)
  where latitude is not null and longitude is not null;

create index if not exists appointments_geocode_status_idx
  on public.appointments (workspace_id, appointment_type, geocode_status)
  where appointment_type = 'installation';

commit;
