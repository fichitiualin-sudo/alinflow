-- 20260725_ADD_MAINTENANCE_OPT_OUT.sql
-- Additiv jeloles arra, ha egy telepitett klima tulajdonosa nem ker karbantartast.
-- Nem torol regi adatot, es idempotensen ujrafuttathato.

begin;

alter table public.appointments
  add column if not exists maintenance_opt_out boolean not null default false,
  add column if not exists maintenance_opt_out_at timestamptz;

create index if not exists appointments_maintenance_opt_out_idx
  on public.appointments (workspace_id, maintenance_opt_out)
  where maintenance_opt_out = true;

commit;
