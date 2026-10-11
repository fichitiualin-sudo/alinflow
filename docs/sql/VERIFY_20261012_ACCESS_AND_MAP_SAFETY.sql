-- Read-only preflight/postflight; no customer, contact or signed document data.
begin read only;
select c.relname as table_name,c.relrowsecurity as rls_enabled,
  exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='workspace_id' and not a.attisdropped) as has_workspace_id
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('customers','appointments','jobs','quotes','quote_items',
  'documents','work_reports','work_checklists','purchase_declarations','maintenance_appointment_items',
  'seller_companies','climate_products','inventory_stock','material_inventory','workspace_settings',
  'appointment_devices','h_tariff_requests','work_photos','profiles') order by c.relname;

select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where policyname in ('active_workspace_guard','AlinFlow active workspace storage guard',
  'profiles_self_guard','profiles_provisioner_insert_guard','profiles_provisioner_delete_guard')
order by schemaname,tablename,policyname;

select p.proname,p.prosecdef,p.proconfig,md5(p.prosrc) as implementation_hash,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_callable,
  has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_callable
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('active_workspace_member','require_workspace_member',
  'finish_work_photo_delete','guard_profile_authority','invalidate_appointment_geocode',
  'invalidate_customer_installation_geocodes','save_maintenance_geocode','shared_maintenance_installation_rows');

select tgname,tgenabled,pg_get_triggerdef(oid) as definition from pg_trigger
where not tgisinternal and tgname in ('appointment_geocode_address_guard','customer_geocode_address_guard','profile_authority_guard');

-- Review these names before tightening profiles. Authority must not come from
-- a user-editable profile role. Function bodies/customer data are not returned.
select p.proname,p.prosecdef,pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosrc ~* '\mrole\M' as mentions_role
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','auth') and p.prosrc ~* '\mprofiles\M';
select schemaname,tablename,policyname,cmd from pg_policies
where coalesce(qual,'') ~* '\mprofiles\M' or coalesce(with_check,'') ~* '\mprofiles\M';

select p.prosrc like '%lastMaintenanceProviderName%' as carries_actual_provider,
  p.prosrc like '%prior.target_workspace_id<>p_target_workspace_id%' as excludes_recipient_local_history,
  p.prosrc like '%shared_maintenance_has_signed_notice%' as validates_partner_signature
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='shared_maintenance_installation_rows';

select count(*) as grants,count(*) filter(where revoked_at is null) as active_grants from public.shared_maintenance_grants;
select count(*) as accepted_orders from public.shared_maintenance_handoffs;
commit;
