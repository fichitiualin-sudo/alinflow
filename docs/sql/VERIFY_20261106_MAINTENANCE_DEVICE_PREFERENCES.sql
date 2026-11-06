-- Read-only verification; emits no customer or device identities.
begin read only;
select column_name,data_type,is_nullable,column_default from information_schema.columns
where table_schema='public' and table_name='maintenance_contact_preferences' and column_name='declined_devices';
select count(*) as preferences,count(*) filter(where declined_devices is not null) as partial_declines,
  count(*) filter(where declined_devices is not null and (choice<>'open' or jsonb_array_length(declined_devices)=0)) as inconsistent_rows
from public.maintenance_contact_preferences;
select p.proname,p.prosecdef,p.proconfig,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as member_callable,
  not has_function_privilege('anon',p.oid,'EXECUTE') as no_anonymous_access,
  not has_function_privilege('service_role',p.oid,'EXECUTE') as no_server_direct_access
from pg_proc p where p.oid=to_regprocedure('public.set_maintenance_device_preference(uuid,uuid,jsonb,boolean,timestamptz,uuid)');
select p.proname,strpos(p.prosrc,'maintenance-device-choice-view-v1')>0 as device_choice_available
from pg_proc p where p.oid in(to_regprocedure('public.list_maintenance_contact_preferences(uuid)'),
  to_regprocedure('public.set_maintenance_contact_preference(uuid,uuid,text,timestamptz,uuid)'));
select c.relrowsecurity as rls_enabled,
  not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as no_direct_member_table_access
from pg_class c where c.oid='public.maintenance_contact_preferences'::regclass;
commit;
