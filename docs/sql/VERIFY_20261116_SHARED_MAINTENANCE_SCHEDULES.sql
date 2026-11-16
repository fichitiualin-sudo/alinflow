-- Read-only postflight; no customer identities or appointment content emitted.
begin read only;
select p.oid is not null as installed,p.prosecdef as security_definer,p.provolatile='s' as stable_read,
  p.proconfig=array['search_path=pg_catalog, pg_temp'] as fixed_search_path,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as member_callable,
  not has_function_privilege('anon',p.oid,'EXECUTE') as no_anonymous_execute,
  not has_function_privilege('service_role',p.oid,'EXECUTE') as no_service_role_execute,
  not exists(select 1 from aclexplode(p.proacl) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as no_public_execute,
  strpos(p.prosrc,'g.revoked_at is null')>0 as active_grants,
  strpos(p.prosrc,'g.target_user_id=auth.uid()')>0 as named_recipient,
  strpos(p.prosrc,'a.scheduled_date<=g.cutoff_date')>0 as historical_cutoff,
  strpos(p.prosrc,'a.created_at<=g.created_at')>0 as creation_cutoff,
  strpos(p.prosrc,'ma.cancelled_at is null')>0 as cancellation_guard,
  strpos(p.prosrc,'jsonb_array_length(mi.selected_devices)>0')>0 as explicit_device_selection
from (values('public.list_shared_maintenance_schedules(uuid)')) expected(signature)
left join pg_proc p on p.oid=to_regprocedure(expected.signature);
-- Completed-history contracts and their signed-notice restriction remain intact.
select p.proname,md5(p.prosrc) as definition_fingerprint,
  strpos(p.prosrc,'shared_maintenance_has_signed_notice')>0 as existing_signed_notice_guard
from pg_proc p where p.oid in(to_regprocedure('public.list_shared_maintenance_results(uuid)'),
  to_regprocedure('public.shared_maintenance_installation_rows(uuid)'));
commit;
