-- Additive classification of installed systems in the maintenance list.
-- Prerequisites: refreshed schema audit and a verified backup, workspace isolation.
-- Existing records stay 'own'; no historical dates, documents or jobs are rewritten.
-- The source name is a display label, never an account, workspace or permission.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'workspace_id'
  ) then
    raise exception 'appointments.workspace_id is missing. Apply workspace isolation first.';
  end if;
end
$$;

alter table public.appointments
  add column if not exists maintenance_origin text not null default 'own',
  add column if not exists maintenance_source_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass and conname = 'appointments_maintenance_origin_check'
  ) then
    alter table public.appointments add constraint appointments_maintenance_origin_check
      check (maintenance_origin in ('own', 'external'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass and conname = 'appointments_maintenance_origin_installation_check'
  ) then
    alter table public.appointments add constraint appointments_maintenance_origin_installation_check
      check (maintenance_origin = 'own' or coalesce(appointment_type, 'installation') = 'installation');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass and conname = 'appointments_maintenance_source_name_check'
  ) then
    alter table public.appointments add constraint appointments_maintenance_source_name_check
      check (
        maintenance_source_name is null
        or (
          maintenance_origin = 'external'
          and char_length(maintenance_source_name) between 1 and 160
          and maintenance_source_name = btrim(maintenance_source_name)
          and maintenance_source_name !~ '[[:cntrl:]]|^[[:space:]]|[[:space:]]$'
        )
      );
  end if;
end
$$;

comment on column public.appointments.maintenance_origin is
  'Maintenance-list classification of an installation: own (default) or external. Does not grant access.';
comment on column public.appointments.maintenance_source_name is
  'Optional display label for an external installation source; not an authorization or workspace identifier.';

-- No policy, grant, membership, RPC or existing row is changed by this migration.
commit;
