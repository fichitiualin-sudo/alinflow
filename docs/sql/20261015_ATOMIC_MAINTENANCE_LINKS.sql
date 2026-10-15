-- Replace a maintenance's installation links in one transaction. Existing links
-- are not touched until every requested installation has passed the same scope
-- checks. No historical row, policy, foreign key or trigger changes on install.
-- Prerequisites: workspace isolation, maintenance items, audit data safety.
-- Rollback: drop only this function; all existing links remain intact.
begin;

create or replace function public.replace_maintenance_appointment_links(
  p_workspace_id uuid,
  p_maintenance_appointment_id uuid,
  p_customer_id uuid,
  p_installation_appointment_ids uuid[]
)
returns uuid[]
language plpgsql
security invoker
set search_path=pg_catalog,pg_temp
as $$
declare
  installation_ids uuid[];
  saved_ids uuid[];
  valid_count integer;
begin
  perform public.require_workspace_member(p_workspace_id);
  if p_maintenance_appointment_id is null or p_customer_id is null
    or p_installation_appointment_ids is null
    or array_position(p_installation_appointment_ids,null) is not null then
    raise exception 'Hiányos karbantartási kapcsolat. Frissítsd a telepítések listáját.' using errcode='22023';
  end if;

  perform c.id from public.customers c
    where c.id=p_customer_id and c.workspace_id=p_workspace_id for key share;
  if not found then
    raise exception 'Az ügyfél nem érhető el ezen a munkaterületen.' using errcode='42501';
  end if;

  -- Serialize replacements and completion of the same maintenance. The shared
  -- maintenance completion trigger also locks this row before a late link.
  perform a.id from public.appointments a
    where a.id=p_maintenance_appointment_id and a.workspace_id=p_workspace_id
      and a.customer_id=p_customer_id and a.appointment_type='maintenance'
    for update;
  if not found then
    raise exception 'A karbantartási időpont nem érhető el ehhez az ügyfélhez.' using errcode='42501';
  end if;

  select coalesce(array_agg(distinct requested.id order by requested.id),'{}'::uuid[])
    into installation_ids from unnest(p_installation_appointment_ids) requested(id);

  -- Lock valid source rows against concurrent deletion. Job-mirror UUIDs are
  -- deliberately not accepted as installation identities. Legacy null types
  -- retain the existing interpretation of an installation.
  perform a.id from public.appointments a
    where a.id=any(installation_ids) and a.workspace_id=p_workspace_id
      and a.customer_id=p_customer_id and coalesce(a.appointment_type,'installation')='installation'
    order by a.id for key share;
  get diagnostics valid_count=row_count;
  if valid_count<>cardinality(installation_ids) then
    raise exception 'Egy kiválasztott telepítés már nem érhető el ehhez az ügyfélhez. Frissítsd a listát; a korábbi kapcsolatok megmaradtak.' using errcode='23514';
  end if;

  -- Retain unchanged rows, their provenance and creation time. In particular,
  -- a harmless retry must not reinsert completed shared-maintenance links.
  delete from public.maintenance_appointment_items item
    where item.workspace_id=p_workspace_id and item.customer_id=p_customer_id
      and item.maintenance_appointment_id=p_maintenance_appointment_id
      and not(item.installation_appointment_id=any(installation_ids));

  insert into public.maintenance_appointment_items(
    workspace_id,customer_id,maintenance_appointment_id,installation_appointment_id,created_by,legacy_source_key
  )
  select p_workspace_id,p_customer_id,p_maintenance_appointment_id,requested.id,auth.uid(),
    'quick-maintenance:'||p_maintenance_appointment_id::text||':'||requested.id::text
  from unnest(installation_ids) requested(id)
  where not exists(select 1 from public.maintenance_appointment_items item
    where item.workspace_id=p_workspace_id and item.customer_id=p_customer_id
      and item.maintenance_appointment_id=p_maintenance_appointment_id and item.installation_appointment_id=requested.id)
  on conflict(maintenance_appointment_id,installation_appointment_id) do nothing;

  -- A policy or trigger must never turn a partial replacement into success.
  select coalesce(array_agg(item.installation_appointment_id order by item.installation_appointment_id),'{}'::uuid[])
    into saved_ids from public.maintenance_appointment_items item
    where item.workspace_id=p_workspace_id and item.customer_id=p_customer_id
      and item.maintenance_appointment_id=p_maintenance_appointment_id;
  if saved_ids is distinct from installation_ids then
    raise exception 'A karbantartási kapcsolatok mentése nem igazolható. A korábbi kapcsolatok megmaradtak.' using errcode='23514';
  end if;
  return saved_ids;
end;
$$;

revoke all on function public.replace_maintenance_appointment_links(uuid,uuid,uuid,uuid[]) from public,anon;
grant execute on function public.replace_maintenance_appointment_links(uuid,uuid,uuid,uuid[]) to authenticated;
commit;
