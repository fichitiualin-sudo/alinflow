-- Read-only postflight: schema/permission flags and aggregate counts only.
-- No customer, workspace, user, installation or grant identities are returned.
begin read only;

select count(*)=1 as table_exists,
  coalesce(bool_and(c.relrowsecurity),false) as rls_enabled,
  coalesce(bool_and(not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),false) as no_direct_member_access,
  coalesce(bool_and(not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),false) as no_anonymous_access,
  coalesce(bool_and(not has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),false) as no_direct_service_access,
  coalesce(bool_and(not exists(select 1 from pg_policy p where p.polrelid=c.oid)),false) as no_rls_policies
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='maintenance_contact_preferences';

select expected.signature,p.oid is not null as function_exists,p.prosecdef as security_definer,
  p.proconfig=array['search_path=pg_catalog, pg_temp'] as fixed_search_path,
  pg_get_function_result(p.oid)='jsonb' as expected_return_type,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as expected_member_access,
  not has_function_privilege('anon',p.oid,'EXECUTE') as no_anonymous_execute,
  not has_function_privilege('service_role',p.oid,'EXECUTE') as no_service_execute,
  strpos(p.prosrc,'shared_maintenance_installation_rows')>0 as reuses_existing_scope_helper
from (values ('public.list_maintenance_contact_preferences(uuid)'),
  ('public.set_maintenance_contact_preference(uuid,uuid,text,timestamptz,uuid)')) expected(signature)
left join pg_proc p on p.oid=to_regprocedure(expected.signature)
order by expected.signature;

select strpos(p.prosrc,'not coalesce(a.maintenance_opt_out,false)')>0 as source_opt_out_filter_preserved
from pg_proc p where p.oid=to_regprocedure('public.shared_maintenance_installation_rows(uuid)');

select count(*) as preference_rows,
  count(*) filter(where choice='open') as explicit_open_rows,
  count(*) filter(where choice='original_installer') as original_installer_rows,
  count(*) filter(where choice='declined') as declined_rows,
  count(*) filter(where choice not in ('open','original_installer','declined') or updated_at is null) as invalid_rows
from public.maintenance_contact_preferences;

commit;
