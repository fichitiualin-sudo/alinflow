-- Read-only postflight: no customer identities or document content is returned.
begin read only;
select c.relname as table_name, c.relrowsecurity as rls_enabled,
  not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as no_direct_member_access,
  not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as no_anonymous_access
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('shared_maintenance_grants','shared_maintenance_contacts',
  'shared_maintenance_handoffs','shared_maintenance_events','shared_maintenance_work_origins');
select p.proname, p.prosecdef as security_definer,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as member_callable,
  has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_callable
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('grant_shared_maintenance_access','list_shared_maintenance_grants',
  'revoke_shared_maintenance_access','list_received_maintenance_installations','accept_shared_maintenance_order',
  'list_shared_maintenance_results','shared_maintenance_installation_rows','shared_maintenance_has_signed_notice');
select count(*) as grants, count(*) filter(where revoked_at is null) as active_grants from public.shared_maintenance_grants;
select count(*) as accepted_orders from public.shared_maintenance_handoffs;
select count(*) as completion_guards from pg_trigger where not tgisinternal
  and tgname in ('shared_maintenance_completion_guard','shared_maintenance_link_completion_guard');
commit;
