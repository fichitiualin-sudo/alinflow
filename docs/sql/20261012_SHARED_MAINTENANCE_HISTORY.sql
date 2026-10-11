-- Fix the received installation's maintenance schedule after another provider
-- completed a signed service. Run after 20261011_SHARED_MAINTENANCE_ACCESS.sql.
-- Read-model only: no grants, business rows, notices or prices are copied.
-- Re-running is safe. Rollback: restore only this function from the prior migration.
begin;

create or replace function public.shared_maintenance_installation_rows(p_target_workspace_id uuid)
returns table(grant_id uuid,installation_id uuid,source_workspace_id uuid,source_customer_id uuid,payload jsonb)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select g.id,a.id,g.source_workspace_id,c.id,
    jsonb_build_object('grantId',g.id,'installationId',a.id,'sourceWorkspaceId',g.source_workspace_id,
      'sourceWorkspaceName',w.name,'customer',jsonb_build_object('name',c.name,'phone',coalesce(c.phone,''),
        'email',coalesce(c.email,''),'postalCode',coalesce(c.postal_code,''),'city',coalesce(c.city,''),
        'address',coalesce(nullif(a.address,''),c.address,'')),
      'installationDate',a.scheduled_date,'installationTime',a.scheduled_time,
      'climates',coalesce((select jsonb_agg(jsonb_build_object('productName',left(qi.product_name,300),'quantity',qi.quantity) order by qi.id)
        from public.quote_items qi join public.quotes q on q.id=qi.quote_id and q.workspace_id=qi.workspace_id
        where q.id=a.quote_id and q.customer_id=c.id and q.workspace_id=g.source_workspace_id
          and qi.quantity>0 and qi.quantity<=1000),'[]'::jsonb),
      'latitude',a.latitude,'longitude',a.longitude,
      'lastMaintenanceDate',history.last_date,'maintenanceCount',history.completed_count,
      'lastMaintenanceProviderName',history.provider_name,
      'targetCustomerId',h.target_customer_id,'targetInstallationId',h.target_installation_id)
  from public.shared_maintenance_grants g
  join public.workspaces w on w.id=g.source_workspace_id and w.active
  join public.appointments a on a.workspace_id=g.source_workspace_id
  join public.customers c on c.id=a.customer_id and c.workspace_id=g.source_workspace_id
  left join public.shared_maintenance_handoffs h on h.source_workspace_id=g.source_workspace_id
    and h.source_installation_id=a.id and h.target_workspace_id=g.target_workspace_id
  left join lateral (
    select max(completed.scheduled_date) as last_date,count(*) as completed_count,
      (array_agg(completed.provider_name order by completed.scheduled_date desc,completed.workspace_id,completed.id))[1] as provider_name
    from (
      -- The recipient already counts its own accepted-service history locally.
      -- Only the source and other providers belong in this additional summary.
      select distinct ma.id,ma.workspace_id,ma.scheduled_date,w.name as provider_name
      from public.maintenance_appointment_items mi
      join public.appointments ma on ma.id=mi.maintenance_appointment_id and ma.workspace_id=mi.workspace_id
      where mi.installation_appointment_id=a.id and mi.workspace_id=g.source_workspace_id and mi.customer_id=c.id
        and ma.customer_id=c.id and ma.appointment_type='maintenance' and ma.status='Lezárva'
        and ma.cancelled_at is null and ma.scheduled_date<=current_date
      union
      select distinct ma.id,ma.workspace_id,ma.scheduled_date,provider.name
      from public.shared_maintenance_handoffs prior
      join public.workspaces provider on provider.id=prior.target_workspace_id
      join public.maintenance_appointment_items mi on mi.installation_appointment_id=prior.target_installation_id
        and mi.workspace_id=prior.target_workspace_id and mi.customer_id=prior.target_customer_id
      join public.appointments ma on ma.id=mi.maintenance_appointment_id and ma.workspace_id=mi.workspace_id
        and ma.customer_id=mi.customer_id
      where prior.source_workspace_id=g.source_workspace_id and prior.source_installation_id=a.id
        and prior.target_workspace_id<>p_target_workspace_id
        and ma.appointment_type='maintenance' and ma.status='Lezárva' and ma.cancelled_at is null
        and ma.scheduled_date<=current_date
        and public.shared_maintenance_has_signed_notice(ma.workspace_id,ma.customer_id,ma.id)
    ) completed
  ) history on true
  where g.target_workspace_id=p_target_workspace_id and g.target_user_id=auth.uid() and g.revoked_at is null
    and public.shared_maintenance_member(g.target_workspace_id,auth.uid(),false)
    and a.appointment_type='installation' and a.maintenance_origin='own'
    and not exists(select 1 from public.shared_maintenance_handoffs provenance
      where provenance.target_installation_id=a.id and provenance.target_workspace_id=a.workspace_id)
    and a.status in ('Lezárva','Szerelés kész – admin folyamatban') and a.cancelled_at is null
    and a.scheduled_date<=g.cutoff_date and a.scheduled_date<=current_date and a.created_at<=g.created_at
    and not coalesce(a.maintenance_opt_out,false);
$$;

revoke all on function public.shared_maintenance_installation_rows(uuid) from public,anon,authenticated,service_role;
commit;
