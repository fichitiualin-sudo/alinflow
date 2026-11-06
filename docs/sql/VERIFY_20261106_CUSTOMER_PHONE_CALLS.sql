-- Read-only postflight: schema, access and aggregate consistency only.
-- No names, phone numbers, dates or activity payloads are returned.
begin read only;
select column_name,data_type,is_nullable from information_schema.columns
where table_schema='public' and table_name='customers' and column_name='last_phone_call_at';
select c.relrowsecurity as phone_calls_rls_enabled,
  not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as no_direct_member_access,
  not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as no_anonymous_access,
  not has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') as no_direct_server_access
from pg_class c where c.oid=to_regclass('public.customer_phone_calls');
select p.proname,p.prosecdef,p.proconfig,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as member_callable,
  not has_function_privilege('anon',p.oid,'EXECUTE') as no_anonymous_execute,
  not has_function_privilege('service_role',p.oid,'EXECUTE') as no_server_execute
from pg_proc p where p.oid in (
  to_regprocedure('public.record_customer_phone_call(uuid,uuid,uuid,text,timestamptz,uuid)'),
  to_regprocedure('public.list_customer_phone_calls(uuid,uuid)'),
  to_regprocedure('public.record_shared_maintenance_phone_call(uuid,uuid,uuid,text,timestamptz,uuid)'),
  to_regprocedure('public.list_shared_maintenance_phone_calls(uuid,uuid,uuid)'),
  to_regprocedure('public.customer_phone_call_json(public.customer_phone_calls)'),
  to_regprocedure('public.insert_customer_phone_call(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,uuid)'))
order by p.proname;
select count(*) as calls,count(*) filter(where kind='initiated') as initiated_calls,
  count(*) filter(where kind='recorded') as manually_recorded_calls from public.customer_phone_calls;
select count(*) as latest_call_timestamp_inconsistent from (
  select p.source_workspace_id,p.source_customer_id,max(p.occurred_at) as latest
  from public.customer_phone_calls p group by p.source_workspace_id,p.source_customer_id
) p left join public.customers c on c.id=p.source_customer_id and c.workspace_id=p.source_workspace_id
where c.id is null or c.last_phone_call_at is null or c.last_phone_call_at<p.latest;
commit;
