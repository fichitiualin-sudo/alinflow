-- Additive, read-only coordination summaries for already authorized installations.
-- Requires the shared-maintenance and per-device selection migrations.
-- No existing RPC, table, grant, appointment or completed-history row is changed.
-- Pending bookings are shared under the active coordination grant; the existing
-- signed-notice guard for completed partner work remains unchanged.
-- Rollback: drop function public.list_shared_maintenance_schedules(uuid).
begin;

create or replace function public.list_shared_maintenance_schedules(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  if not public.shared_maintenance_member(p_workspace_id,auth.uid(),false) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  return coalesce((
    with authorized_installations as (
      select g.id as grant_id,g.source_workspace_id,g.target_workspace_id,
        a.id as source_installation_id,a.customer_id as source_customer_id,
        h.target_installation_id,h.target_customer_id,source.name as source_name,target.name as target_name
      from public.shared_maintenance_grants g
      join public.workspaces source on source.id=g.source_workspace_id and source.active
      join public.workspaces target on target.id=g.target_workspace_id and target.active
      join public.appointments a on a.workspace_id=g.source_workspace_id
      join public.customers c on c.id=a.customer_id and c.workspace_id=a.workspace_id
      left join public.shared_maintenance_handoffs h on h.grant_id=g.id
        and h.source_workspace_id=g.source_workspace_id and h.source_installation_id=a.id
        and h.target_workspace_id=g.target_workspace_id
      where g.revoked_at is null and g.scope='historical_installations'
        and public.shared_maintenance_member(g.target_workspace_id,g.target_user_id,false)
        and (g.source_workspace_id=p_workspace_id
          or (g.target_workspace_id=p_workspace_id and g.target_user_id=auth.uid()))
        -- Preserve the original historical-installation grant boundary.
        and a.appointment_type='installation' and a.maintenance_origin='own'
        and a.status in ('Lezárva','Szerelés kész – admin folyamatban') and a.cancelled_at is null
        and a.scheduled_date<=g.cutoff_date and a.scheduled_date<=current_date and a.created_at<=g.created_at
        and not coalesce(a.maintenance_opt_out,false)
        and not exists(select 1 from public.shared_maintenance_handoffs provenance
          where provenance.target_installation_id=a.id and provenance.target_workspace_id=a.workspace_id)
        and not exists (
          select 1 from public.quotes extra_quote
          where extra_quote.id=a.quote_id and extra_quote.customer_id=c.id and extra_quote.workspace_id=g.source_workspace_id
            and exists(select 1 from public.quote_items extra_item
              where extra_item.quote_id=extra_quote.id and extra_item.workspace_id=extra_quote.workspace_id
                and coalesce(extra_item.description,'') ~ '(^|[|])item_type=extra([|]|$)')
            and not exists(select 1 from public.quote_items climate_item
              where climate_item.quote_id=extra_quote.id and climate_item.workspace_id=extra_quote.workspace_id
                and coalesce(climate_item.description,'') !~ '(^|[|])item_type=extra([|]|$)')
        )
    ), linked_schedules as (
      -- The source sees a partner's booked work only after accepting that exact
      -- installation. Never infer links from a name, phone number or address.
      select a.source_installation_id as installation_id,a.source_workspace_id,a.source_installation_id,
        ma.id as maintenance_appointment_id,ma.scheduled_date,ma.scheduled_time,mi.selected_devices,a.target_name as provider_name
      from authorized_installations a
      join public.appointments target_installation on target_installation.id=a.target_installation_id
        and target_installation.workspace_id=a.target_workspace_id and target_installation.customer_id=a.target_customer_id
        and target_installation.appointment_type='installation' and target_installation.cancelled_at is null
      join public.maintenance_appointment_items mi on mi.installation_appointment_id=a.target_installation_id
        and mi.workspace_id=a.target_workspace_id and mi.customer_id=a.target_customer_id
      join public.appointments ma on ma.id=mi.maintenance_appointment_id
        and ma.workspace_id=mi.workspace_id and ma.customer_id=mi.customer_id
      where a.source_workspace_id=p_workspace_id
        and ma.appointment_type='maintenance' and ma.status in ('Időpont foglalva','Szerelés folyamatban')
        and ma.cancelled_at is null and ma.scheduled_date is not null
        and ma.scheduled_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        and case when jsonb_typeof(mi.selected_devices)='array' then jsonb_array_length(mi.selected_devices)>0 else false end
      union
      -- A recipient sees source bookings for authorized installations even
      -- before creating its local mirror. The provenance IDs remain explicit.
      select coalesce(a.target_installation_id,a.source_installation_id),a.source_workspace_id,a.source_installation_id,
        ma.id,ma.scheduled_date,ma.scheduled_time,mi.selected_devices,a.source_name
      from authorized_installations a
      join public.maintenance_appointment_items mi on mi.installation_appointment_id=a.source_installation_id
        and mi.workspace_id=a.source_workspace_id and mi.customer_id=a.source_customer_id
      join public.appointments ma on ma.id=mi.maintenance_appointment_id
        and ma.workspace_id=mi.workspace_id and ma.customer_id=mi.customer_id
      where a.target_workspace_id=p_workspace_id
        and ma.appointment_type='maintenance' and ma.status in ('Időpont foglalva','Szerelés folyamatban')
        and ma.cancelled_at is null and ma.scheduled_date is not null
        and ma.scheduled_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        and case when jsonb_typeof(mi.selected_devices)='array' then jsonb_array_length(mi.selected_devices)>0 else false end
    )
    select jsonb_agg(jsonb_build_object('installationId',installation_id,'sourceWorkspaceId',source_workspace_id,
      'sourceInstallationId',source_installation_id,'maintenanceAppointmentId',maintenance_appointment_id,
      'date',scheduled_date,'time',scheduled_time,'selectedDevices',selected_devices,'providerName',provider_name)
      order by scheduled_date,scheduled_time,maintenance_appointment_id,installation_id)
    from linked_schedules
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.list_shared_maintenance_schedules(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_shared_maintenance_schedules(uuid) to authenticated;
comment on function public.list_shared_maintenance_schedules(uuid)
  is 'AlinFlow scheduled maintenance coordination v1: active grants, exact device links, no completed history';
commit;
