-- Read-only aggregate postflight. Compare historical counts/fingerprints with
-- the preflight captured before migration; no identities or customer data emit.
begin read only;
select column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public' and table_name='maintenance_appointment_items'
  and column_name='selected_devices';
select count(*) as links,count(*) filter(where selected_devices is null) as legacy_whole_installations,
  count(*) filter(where selected_devices is not null) as explicit_selections
from public.maintenance_appointment_items;
select expected.signature,p.oid is not null as installed,p.prosecdef as security_definer,
  p.proconfig=array['search_path=pg_catalog, pg_temp'] as fixed_search_path,
  has_function_privilege('authenticated',p.oid,'EXECUTE')=expected.member_callable as expected_member_access,
  not has_function_privilege('anon',p.oid,'EXECUTE') as no_anonymous_execute
from (values
  ('public.replace_maintenance_device_links(uuid,uuid,uuid,jsonb)',true),
  ('public.normalize_maintenance_device_selection(jsonb)',true),
  ('public.validate_maintenance_device_selection(uuid,uuid,uuid,jsonb)',false),
  ('public.guard_maintenance_device_selection()',false)
) expected(signature,member_callable) left join pg_proc p on p.oid=to_regprocedure(expected.signature);
select count(*)=1 and bool_and(t.tgenabled='O') as device_guard_enabled
from pg_trigger t where t.tgrelid='public.maintenance_appointment_items'::regclass
  and t.tgname='maintenance_device_selection_guard' and not t.tgisinternal;
select p.proname,strpos(p.prosrc,'selected_devices')>0 as device_selection_returned,
  case when p.proname='shared_maintenance_installation_rows' then strpos(p.prosrc,'maintenanceHistory')>0 else true end as history_returned
from pg_proc p where p.oid in(to_regprocedure('public.shared_maintenance_installation_rows(uuid)'),
  to_regprocedure('public.list_shared_maintenance_results(uuid)'));
select c.relrowsecurity as rls_enabled from pg_class c where c.oid='public.maintenance_appointment_items'::regclass;
select has_column_privilege('service_role','public.maintenance_appointment_items','selected_devices','SELECT') as server_can_read_selection;
select strpos(p.prosrc,'partial-maintenance-signed-quote-v1')>0 as signed_maintenance_quote_guard
from pg_proc p where p.oid=to_regprocedure('public.save_quote_with_items(uuid,uuid,uuid,uuid,text,text,jsonb)');
commit;
