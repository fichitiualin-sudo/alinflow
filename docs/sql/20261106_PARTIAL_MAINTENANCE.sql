-- Per-device maintenance selection. Apply after the atomic-link, shared-history
-- and extra-item migrations. No historical selection is inferred or rewritten.
-- NULL remains the legacy meaning: every device in the linked installation.
-- Rollback: retain this additive schema and disable the new UI. Never discard
-- selected_devices after a partial maintenance has been recorded.
begin;

alter table public.maintenance_appointment_items add column if not exists selected_devices jsonb;

create or replace function public.normalize_maintenance_device_selection(p_selection jsonb)
returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_selection is null or p_selection='null'::jsonb then return null; end if;
  if jsonb_typeof(p_selection)<>'array' then
    raise exception 'A karbantartandó készülékek listája hibás.' using errcode='22023';
  end if;
  if jsonb_array_length(p_selection)<1 or jsonb_array_length(p_selection)>1000 then
    raise exception 'Válassz legalább egy, legfeljebb 1000 készüléket.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_selection) d where jsonb_typeof(d)<>'object'
    or jsonb_typeof(d->'productName') is distinct from 'string' or length(btrim(d->>'productName')) not between 1 and 300
    or jsonb_typeof(d->'unitNumber') is distinct from 'number' or (d->>'unitNumber') !~ '^[1-9][0-9]{0,3}$'
    or (d-'productName'-'unitNumber')<>'{}'::jsonb) then
    raise exception 'A kiválasztott készülék azonosítója hibás.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_selection) d where (d->>'unitNumber')::integer>1000)
    or exists(select 1 from jsonb_array_elements(p_selection) d
      group by lower(btrim(d->>'productName')),(d->>'unitNumber')::integer having count(*)>1) then
    raise exception 'A készülékek számozása hibás vagy ismétlődik.' using errcode='22023';
  end if;
  select jsonb_agg(jsonb_build_object('productName',btrim(d->>'productName'),'unitNumber',(d->>'unitNumber')::integer)
    order by lower(btrim(d->>'productName')),(d->>'unitNumber')::integer) into result
    from jsonb_array_elements(p_selection) d;
  return result;
end;
$$;

-- Private validation is also used by the direct-write trigger. Its queries are
-- explicitly scoped and it returns only the selected, already-visible names.
create or replace function public.validate_maintenance_device_selection(
  p_workspace_id uuid,p_customer_id uuid,p_installation_id uuid,p_selection jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare normalized jsonb; result jsonb;
begin
  normalized := public.normalize_maintenance_device_selection(p_selection);
  if normalized is null then return null; end if;
  with models as (
    select lower(btrim(qi.product_name)) model,min(btrim(qi.product_name)) product_name,sum(qi.quantity)::integer quantity
    from public.appointments a join public.quotes q on q.id=a.quote_id and q.workspace_id=a.workspace_id and q.customer_id=a.customer_id
    join public.quote_items qi on qi.quote_id=q.id and qi.workspace_id=q.workspace_id
    where a.id=p_installation_id and a.workspace_id=p_workspace_id and a.customer_id=p_customer_id
      and coalesce(a.appointment_type,'installation')='installation'
      and coalesce(qi.description,'') !~ '(^|[|])item_type=extra([|]|$)'
      and qi.quantity>0 and qi.quantity<=1000 and qi.quantity=trunc(qi.quantity)
    group by lower(btrim(qi.product_name))
  )
  select jsonb_agg(jsonb_build_object('productName',m.product_name,'unitNumber',(d->>'unitNumber')::integer)
    order by m.model,(d->>'unitNumber')::integer) into result
  from jsonb_array_elements(normalized) d join models m on m.model=lower(btrim(d->>'productName'))
    and (d->>'unitNumber')::integer<=m.quantity;
  if result is null or jsonb_array_length(result)<>jsonb_array_length(normalized) then
    raise exception 'A kiválasztott készülék már nem tartozik ehhez a telepítéshez. Frissítsd a listát.' using errcode='23514';
  end if;
  return result;
end;
$$;

create or replace function public.guard_maintenance_device_selection()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare work public.appointments%rowtype; selected jsonb; is_locked boolean;
begin
  if tg_table_schema<>'public' or tg_table_name<>'maintenance_appointment_items' then
    raise exception 'Érvénytelen karbantartási művelet.' using errcode='42501';
  end if;
  -- Parent deletion cascades stay possible. Ordinary link edits serialize with
  -- appointment completion, including writes through the old RPC or REST.
  select a.* into work from public.appointments a
    where a.id=case when tg_op='DELETE' then old.maintenance_appointment_id else new.maintenance_appointment_id end
    for update;
  if not found then
    if tg_op='DELETE' then return old; end if;
    raise exception 'A karbantartási időpont nem érhető el.' using errcode='23514';
  end if;
  if tg_op='UPDATE' and (new.workspace_id,new.customer_id,new.maintenance_appointment_id,new.installation_appointment_id)
    is distinct from (old.workspace_id,old.customer_id,old.maintenance_appointment_id,old.installation_appointment_id) then
    raise exception 'A karbantartási kapcsolat azonossága nem módosítható.' using errcode='23514';
  end if;
  if tg_op='UPDATE' and new.selected_devices is not distinct from old.selected_devices then return new; end if;
  is_locked := work.status='Lezárva' or exists(select 1 from public.work_reports wr
    where wr.workspace_id=work.workspace_id and wr.customer_id=work.customer_id and wr.appointment_id=work.id
      and wr.appointment_type='maintenance' and wr.signed_at is not null and nullif(btrim(wr.signature_data_url),'') is not null);
  if is_locked and exists(select 1 from public.customers c where c.id=work.customer_id and c.workspace_id=work.workspace_id) then
    raise exception 'Aláírt vagy lezárt karbantartás készülékei nem módosíthatók. Új karbantartást rögzíts.' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; end if;
  if work.workspace_id is distinct from new.workspace_id or work.customer_id is distinct from new.customer_id
    or work.appointment_type is distinct from 'maintenance' then
    raise exception 'A készülékek másik karbantartáshoz tartoznak.' using errcode='23514';
  end if;
  if not exists(select 1 from public.appointments a join public.customers c on c.id=a.customer_id and c.workspace_id=a.workspace_id
    where a.id=new.installation_appointment_id and a.workspace_id=new.workspace_id and a.customer_id=new.customer_id
      and coalesce(a.appointment_type,'installation')='installation') then
    raise exception 'A telepítés nem érhető el ehhez az ügyfélhez.' using errcode='23514';
  end if;
  selected := public.validate_maintenance_device_selection(new.workspace_id,new.customer_id,new.installation_appointment_id,new.selected_devices);
  new.selected_devices := selected;
  return new;
end;
$$;

drop trigger if exists maintenance_device_selection_guard on public.maintenance_appointment_items;
create trigger maintenance_device_selection_guard before insert or update or delete on public.maintenance_appointment_items
  for each row execute function public.guard_maintenance_device_selection();

create or replace function public.replace_maintenance_device_links(
  p_workspace_id uuid,p_maintenance_appointment_id uuid,p_customer_id uuid,p_installations jsonb)
returns uuid[] language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare requested jsonb; prepared jsonb := '[]'::jsonb; installation_id uuid; selected jsonb;
  installation_ids uuid[]; saved_ids uuid[]; valid_count integer; is_locked boolean; work public.appointments%rowtype;
begin
  perform public.require_workspace_member(p_workspace_id);
  if p_maintenance_appointment_id is null or p_customer_id is null or p_installations is null
    or jsonb_typeof(p_installations)<>'array' then
    raise exception 'Hiányos karbantartási kapcsolat.' using errcode='22023';
  end if;
  if jsonb_array_length(p_installations)>1000 then raise exception 'Túl sok telepítés.' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_installations) r where jsonb_typeof(r)<>'object'
    or jsonb_typeof(r->'installationId') is distinct from 'string'
    or coalesce(r->>'installationId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or not(r ? 'selectedDevices') or (r-'installationId'-'selectedDevices')<>'{}'::jsonb)
    or exists(select 1 from jsonb_array_elements(p_installations) r group by lower(r->>'installationId') having count(*)>1) then
    raise exception 'A telepítések listája hibás vagy ismétlődik.' using errcode='22023';
  end if;
  perform c.id from public.customers c where c.id=p_customer_id and c.workspace_id=p_workspace_id for key share;
  if not found then raise exception 'Az ügyfél nem érhető el ezen a munkaterületen.' using errcode='42501'; end if;
  select a.* into work from public.appointments a where a.id=p_maintenance_appointment_id and a.workspace_id=p_workspace_id
    and a.customer_id=p_customer_id and a.appointment_type='maintenance' for update;
  if not found then raise exception 'A karbantartási időpont nem érhető el ehhez az ügyfélhez.' using errcode='42501'; end if;
  select coalesce(array_agg((r->>'installationId')::uuid order by (r->>'installationId')::uuid),'{}'::uuid[])
    into installation_ids from jsonb_array_elements(p_installations) r;
  perform a.id from public.appointments a where a.id=any(installation_ids) and a.workspace_id=p_workspace_id
    and a.customer_id=p_customer_id and coalesce(a.appointment_type,'installation')='installation' order by a.id for key share;
  get diagnostics valid_count=row_count;
  if valid_count<>cardinality(installation_ids) then
    raise exception 'Egy kiválasztott telepítés már nem érhető el ehhez az ügyfélhez. Frissítsd a listát.' using errcode='23514';
  end if;
  -- Check every payload before deleting a link. Device existence is validated
  -- by the direct-write trigger; any failure rolls back the entire replacement.
  for requested in select value from jsonb_array_elements(p_installations) loop
    installation_id := (requested->>'installationId')::uuid;
    selected := public.normalize_maintenance_device_selection(requested->'selectedDevices');
    -- Explicit null selects the whole installation, including mixed requests
    -- with a partial first installation and a complete second installation.
    -- The trigger validates selection contents before each change; unchanged
    -- historical selections need no reinterpretation against a later catalog.
    prepared := prepared || jsonb_build_array(jsonb_build_object('installationId',installation_id,'selectedDevices',selected));
  end loop;
  is_locked := work.status='Lezárva' or exists(select 1 from public.work_reports wr where wr.workspace_id=p_workspace_id
    and wr.customer_id=p_customer_id and wr.appointment_id=p_maintenance_appointment_id and wr.appointment_type='maintenance'
    and wr.signed_at is not null and nullif(btrim(wr.signature_data_url),'') is not null);
  if is_locked and (exists(select 1 from public.maintenance_appointment_items mi where mi.workspace_id=p_workspace_id
      and mi.customer_id=p_customer_id and mi.maintenance_appointment_id=p_maintenance_appointment_id
      and not(mi.installation_appointment_id=any(installation_ids)))
    or exists(select 1 from jsonb_array_elements(prepared) r where not exists(select 1 from public.maintenance_appointment_items mi
      where mi.workspace_id=p_workspace_id and mi.customer_id=p_customer_id and mi.maintenance_appointment_id=p_maintenance_appointment_id
        and mi.installation_appointment_id=(r->>'installationId')::uuid
        and coalesce(mi.selected_devices,'null'::jsonb)=r->'selectedDevices'))) then
    raise exception 'Aláírt vagy lezárt karbantartás készülékei nem módosíthatók. Új karbantartást rögzíts.' using errcode='23514';
  end if;
  delete from public.maintenance_appointment_items mi where mi.workspace_id=p_workspace_id and mi.customer_id=p_customer_id
    and mi.maintenance_appointment_id=p_maintenance_appointment_id and not(mi.installation_appointment_id=any(installation_ids));
  for requested in select value from jsonb_array_elements(prepared) loop
    installation_id := (requested->>'installationId')::uuid;
    selected := nullif(requested->'selectedDevices','null'::jsonb);
    insert into public.maintenance_appointment_items(workspace_id,customer_id,maintenance_appointment_id,installation_appointment_id,
      selected_devices,created_by,legacy_source_key)
    select p_workspace_id,p_customer_id,p_maintenance_appointment_id,installation_id,selected,auth.uid(),
      'partial-maintenance:'||p_maintenance_appointment_id::text||':'||installation_id::text
    where not exists(select 1 from public.maintenance_appointment_items mi where mi.workspace_id=p_workspace_id and mi.customer_id=p_customer_id
      and mi.maintenance_appointment_id=p_maintenance_appointment_id and mi.installation_appointment_id=installation_id);
    update public.maintenance_appointment_items mi set selected_devices=selected where mi.workspace_id=p_workspace_id
      and mi.customer_id=p_customer_id and mi.maintenance_appointment_id=p_maintenance_appointment_id
      and mi.installation_appointment_id=installation_id and mi.selected_devices is distinct from selected;
  end loop;
  select coalesce(array_agg(mi.installation_appointment_id order by mi.installation_appointment_id),'{}'::uuid[]) into saved_ids
    from public.maintenance_appointment_items mi where mi.workspace_id=p_workspace_id and mi.customer_id=p_customer_id
      and mi.maintenance_appointment_id=p_maintenance_appointment_id;
  if saved_ids is distinct from installation_ids then
    raise exception 'A karbantartási kapcsolatok mentése nem igazolható. A korábbi kapcsolatok megmaradtak.' using errcode='23514';
  end if;
  return saved_ids;
end;
$$;

revoke all on function public.normalize_maintenance_device_selection(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.normalize_maintenance_device_selection(jsonb) to authenticated;
revoke all on function public.validate_maintenance_device_selection(uuid,uuid,uuid,jsonb),public.guard_maintenance_device_selection()
  from public,anon,authenticated,service_role;
revoke all on function public.replace_maintenance_device_links(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.replace_maintenance_device_links(uuid,uuid,uuid,jsonb) to authenticated;

-- The application saves quote items before replacing maintenance links. Protect
-- a saved signature at that earlier boundary too, while the existing RPC holds
-- the appointment lock. Unchanged saves are true no-ops, preserving row IDs.
do $signed_quote$
declare f oid := to_regprocedure('public.save_quote_with_items(uuid,uuid,uuid,uuid,text,text,jsonb)');
  definition text; metadata jsonb; needle constant text := '  if p_quote_id is not null then';
  guard_sql constant text := $guard$
  /* partial-maintenance-signed-quote-v1 */
  if exists(select 1 from public.appointments protected
    where (protected.id=p_appointment_id or protected.quote_id=p_quote_id)
      and protected.workspace_id=p_workspace_id and protected.customer_id=p_customer_id
      and protected.appointment_type='maintenance'
      and (protected.status='Lezárva' or exists(select 1 from public.work_reports wr
        where wr.workspace_id=p_workspace_id and wr.customer_id=p_customer_id and wr.appointment_id=protected.id
          and wr.appointment_type='maintenance' and wr.signed_at is not null and nullif(btrim(wr.signature_data_url),'') is not null))) then
    if p_quote_id is null or not exists(select 1 from public.appointments protected join public.quotes q
      on q.id=protected.quote_id and q.workspace_id=protected.workspace_id and q.customer_id=protected.customer_id
      where protected.id=p_appointment_id and protected.workspace_id=p_workspace_id and protected.customer_id=p_customer_id
        and q.id=p_quote_id and (q.appointment_id is null or q.appointment_id=p_appointment_id)) then
      raise exception 'Aláírt vagy lezárt karbantartás tételei nem cserélhetők le. Új karbantartást rögzíts.' using errcode='23514';
    end if;
    perform 1 from public.quotes q where q.id=p_quote_id and q.workspace_id=p_workspace_id and q.customer_id=p_customer_id for update;
    if (select coalesce(jsonb_agg(jsonb_build_array(qi.product_name,qi.description,qi.quantity,qi.unit_price)
          order by qi.product_name,qi.description,qi.quantity,qi.unit_price),'[]'::jsonb)
        from public.quote_items qi where qi.quote_id=p_quote_id and qi.workspace_id=p_workspace_id)
      is distinct from
      (select coalesce(jsonb_agg(jsonb_build_array(i->>'product_name',i->>'description',(i->>'quantity')::numeric,(i->>'unit_price')::numeric)
          order by i->>'product_name',i->>'description',(i->>'quantity')::numeric,(i->>'unit_price')::numeric),'[]'::jsonb)
        from jsonb_array_elements(p_items) i) then
      raise exception 'Aláírt vagy lezárt karbantartás tételei nem módosíthatók. Új karbantartást rögzíts.' using errcode='23514';
    end if;
    return p_quote_id;
  end if;
$guard$;
begin
  if f is null then raise exception 'The atomic quote RPC must be installed first.'; end if;
  select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,metadata from pg_proc p where p.oid=f;
  if strpos(definition,'partial-maintenance-signed-quote-v1')>0 then return; end if;
  if (length(definition)-length(replace(definition,needle,'')))<>length(needle)
    or strpos(definition,'and a.customer_id = p_customer_id and a.workspace_id = p_workspace_id for update')=0 then
    raise exception 'Unexpected atomic quote implementation. No function was overwritten.';
  end if;
  execute replace(definition,needle,guard_sql||needle);
  if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=f) is distinct from metadata then
    raise exception 'Quote RPC metadata or permissions changed unexpectedly.';
  end if;
end;
$signed_quote$;

-- Shared read models follow below, preserving existing eligibility and access.
do $shared_history$
declare f oid := to_regprocedure('public.shared_maintenance_installation_rows(uuid)');
  definition text; metadata jsonb; old_text text; new_text text;
begin
  if f is null then raise exception 'The shared maintenance read model must be installed first.'; end if;
  select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,metadata from pg_proc p where p.oid=f;
  if strpos(definition,'partial-maintenance-device-history-v1')>0 then return; end if;
  -- These exact fragments deliberately fail closed on an unexpected read model.
  -- Its original ACL, owner, volatility and fixed search_path are preserved.
  for old_text,new_text in select * from (values
    ($old$'lastMaintenanceProviderName',history.provider_name,$old$,
     $new$'lastMaintenanceProviderName',history.provider_name,
      /* partial-maintenance-device-history-v1 */
      'maintenanceHistory',coalesce(history.maintenance_history,'[]'::jsonb),$new$),
    ($old$(array_agg(completed.provider_name order by completed.scheduled_date desc,completed.workspace_id,completed.id))[1] as provider_name$old$,
     $new$(array_agg(completed.provider_name order by completed.scheduled_date desc,completed.workspace_id,completed.id))[1] as provider_name,
      jsonb_agg(jsonb_build_object('date',completed.scheduled_date,'providerName',completed.provider_name,
        'status','Lezárva','selectedDevices',completed.selected_devices)
        order by completed.scheduled_date desc,completed.workspace_id,completed.id) as maintenance_history$new$),
    ($old$select distinct ma.id,ma.workspace_id,ma.scheduled_date,w.name as provider_name$old$,
     $new$select distinct ma.id,ma.workspace_id,ma.scheduled_date,w.name as provider_name,mi.selected_devices$new$),
    ($old$select distinct ma.id,ma.workspace_id,ma.scheduled_date,provider.name$old$,
     $new$select distinct ma.id,ma.workspace_id,ma.scheduled_date,provider.name,mi.selected_devices$new$)
  ) replacements(old_value,new_value) loop
    if (length(definition)-length(replace(definition,old_text,'')))<>length(old_text) then
      raise exception 'Unexpected shared maintenance history. No function was overwritten.';
    end if;
    definition := replace(definition,old_text,new_text);
  end loop;
  if strpos(definition,'item_type=extra')=0 or strpos(definition,'g.target_user_id=auth.uid()')=0
    or strpos(definition,'not coalesce(a.maintenance_opt_out,false)')=0 then
    raise exception 'Required shared-maintenance visibility guards are missing.';
  end if;
  execute definition;
  if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=f) is distinct from metadata then
    raise exception 'Shared maintenance function permissions or metadata changed unexpectedly.';
  end if;
end;
$shared_history$;

do $shared_results$
declare f oid := to_regprocedure('public.list_shared_maintenance_results(uuid)');
  definition text; metadata jsonb; old_text text; new_text text;
begin
  if f is null then raise exception 'The shared maintenance result read model must be installed first.'; end if;
  select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,metadata from pg_proc p where p.oid=f;
  if strpos(definition,'partial-maintenance-device-results-v1')>0 then return; end if;
  old_text := $old$'date',ma.scheduled_date,'providerName',w.name,'status',ma.status)$old$;
  new_text := $new$'date',ma.scheduled_date,'providerName',w.name,'status',ma.status,
      /* partial-maintenance-device-results-v1 */ 'selectedDevices',mi.selected_devices)$new$;
  if (length(definition)-length(replace(definition,old_text,'')))<>length(old_text) then
    raise exception 'Unexpected shared maintenance results. No function was overwritten.';
  end if;
  definition := replace(definition,old_text,new_text);
  old_text := 'where h.source_workspace_id=p_source_workspace_id and ma.scheduled_date<=current_date';
  if (length(definition)-length(replace(definition,old_text,'')))<>length(old_text) then
    raise exception 'Unexpected shared maintenance result scope. No function was overwritten.';
  end if;
  definition := replace(definition,old_text,old_text||' and ma.cancelled_at is null');
  execute definition;
  if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=f) is distinct from metadata then
    raise exception 'Shared result function permissions or metadata changed unexpectedly.';
  end if;
end;
$shared_results$;
commit;
