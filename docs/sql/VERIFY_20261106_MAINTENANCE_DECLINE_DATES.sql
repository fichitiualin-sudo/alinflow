-- Aggregate-only read-only postflight; never emits customer/device identities.
begin read only;
select column_name,data_type,is_nullable,column_default from information_schema.columns
where table_schema='public' and table_name='maintenance_contact_preferences'
  and column_name in ('declined_at','declined_device_dates') order by column_name;
select count(*) as preferences,count(*) filter(where declined_at is not null) as known_whole_decline_dates,
  count(*) filter(where declined_device_dates is not null) as known_device_decline_dates,
  count(*) filter(where choice<>'declined' and declined_at is not null) as inconsistent_whole_dates
from public.maintenance_contact_preferences;
select p.proname,strpos(p.prosrc,'maintenance-decline-dates-v1')>0 as refusal_dates_returned,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as member_callable,
  not has_function_privilege('anon',p.oid,'EXECUTE') as no_anonymous_access
from pg_proc p where p.oid in(to_regprocedure('public.list_maintenance_contact_preferences(uuid)'),
  to_regprocedure('public.set_maintenance_contact_preference(uuid,uuid,text,timestamptz,uuid)'),
  to_regprocedure('public.set_maintenance_device_preference(uuid,uuid,jsonb,boolean,timestamptz,uuid)'));
select p.prosecdef,p.proconfig,
  not has_function_privilege('authenticated',p.oid,'EXECUTE') as no_member_direct_execute,
  not has_function_privilege('anon',p.oid,'EXECUTE') as no_anonymous_execute,
  not has_function_privilege('service_role',p.oid,'EXECUTE') as no_server_direct_execute
from pg_proc p where p.oid=to_regprocedure('public.record_maintenance_decline_dates()');
select count(*)=1 and bool_and(t.tgenabled='O') as refusal_dates_trigger_enabled
from pg_trigger t where t.tgrelid='public.maintenance_contact_preferences'::regclass
  and t.tgname='maintenance_decline_dates_record' and not t.tgisinternal;
commit;
