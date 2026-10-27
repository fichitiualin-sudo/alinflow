-- Read-only postflight. Returns schema/permission flags and aggregate counts;
-- never returns customer, workspace, user, installation or grant identities.
begin read only;

select c.relname as table_name,c.relrowsecurity as rls_enabled,
  not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as no_direct_member_access,
  not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as no_anonymous_access,
  not has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as no_direct_service_access,
  not exists(select 1 from pg_policy p where p.polrelid=c.oid) as no_rls_policies
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='shared_maintenance_preferences';

select expected.signature,p.oid is not null as function_exists,p.prosecdef as security_definer,
  p.proconfig=array['search_path=pg_catalog, pg_temp'] as fixed_search_path,
  pg_get_function_result(p.oid) as return_type,
  pg_get_function_result(p.oid)=expected.return_type as expected_return_type,
  has_function_privilege('authenticated',p.oid,'EXECUTE')=expected.member_callable as expected_member_access,
  not has_function_privilege('anon',p.oid,'EXECUTE') as no_anonymous_execute,
  not has_function_privilege('service_role',p.oid,'EXECUTE') as no_service_execute,
  case when expected.return_type='jsonb' then
    strpos(p.prosrc,'maintenanceOptOut')>0 and strpos(p.prosrc,'maintenanceOptOutAt')>0
    else null end as opt_out_response_fields
from (values
  ('public.set_shared_maintenance_opt_out(uuid,uuid,boolean)','jsonb',true),
  ('public.list_received_maintenance_installations(uuid)','jsonb',true),
  ('public.copy_shared_maintenance_opt_out()','trigger',false)
) expected(signature,return_type,member_callable)
left join pg_proc p on p.oid=to_regprocedure(expected.signature)
order by expected.signature;

select count(*)=1 as mirror_copy_trigger_installed,
  coalesce(bool_and(t.tgenabled='O' and t.tgfoid=to_regprocedure('public.copy_shared_maintenance_opt_out()')),false) as mirror_copy_trigger_enabled
from pg_trigger t
where t.tgrelid='public.appointments'::regclass and not t.tgisinternal and t.tgname='shared_maintenance_opt_out_copy';

select strpos(p.prosrc,'shared_maintenance_installation_rows')>0 as list_reuses_existing_scope_helper
from pg_proc p where p.oid=to_regprocedure('public.list_received_maintenance_installations(uuid)');
select strpos(p.prosrc,'not coalesce(a.maintenance_opt_out,false)')>0 as source_opt_out_filter_preserved
from pg_proc p where p.oid=to_regprocedure('public.shared_maintenance_installation_rows(uuid)');

select count(*) as preference_rows,
  count(*) filter(where maintenance_opt_out) as opted_out_rows,
  count(*) filter(where maintenance_opt_out is distinct from (maintenance_opt_out_at is not null)) as inconsistent_timestamp_rows
from public.shared_maintenance_preferences;

commit;
