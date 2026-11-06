-- Persistent per-device decline, after 20261106_PARTIAL_MAINTENANCE.sql.
-- Existing global/legacy choices are unchanged until an explicit user action.
-- Source identities, exact-user grants, locks and optimistic concurrency are
-- inherited from the installed contact-choice RPC; no new table access grants.
begin;

alter table public.maintenance_contact_preferences add column if not exists declined_devices jsonb;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.maintenance_contact_preferences'::regclass
    and conname='maintenance_contact_declined_devices_array') then
    alter table public.maintenance_contact_preferences add constraint maintenance_contact_declined_devices_array
      check(declined_devices is null or jsonb_typeof(declined_devices)='array');
  end if;
end $$;

-- Build the new operation from the current ACL/identity/lock implementation,
-- changing only argument validation and the final preference calculation/write.
do $device_rpc$
declare
  f oid := to_regprocedure('public.set_maintenance_contact_preference(uuid,uuid,text,timestamptz,uuid)');
  existing oid := to_regprocedure('public.set_maintenance_device_preference(uuid,uuid,jsonb,boolean,timestamptz,uuid)');
  definition text; old_text text; new_text text;
  calculation constant text := $calculation$
  /* maintenance-device-preferences-v1 */
  -- The source appointment is already locked. save_quote_with_items takes the
  -- same lock, so unit validation cannot race a normal source quote edit.
  v_device := public.validate_maintenance_device_selection(v_source_workspace,source_installation.customer_id,
    v_source_installation,jsonb_build_array(p_device))->0;
  with models as (
    select lower(btrim(qi.product_name)) model,min(btrim(qi.product_name)) product_name,sum(qi.quantity)::integer quantity
    from public.quotes q join public.quote_items qi on qi.quote_id=q.id and qi.workspace_id=q.workspace_id
    where q.id=source_installation.quote_id and q.customer_id=source_installation.customer_id and q.workspace_id=v_source_workspace
      and coalesce(qi.description,'') !~ '(^|[|])item_type=extra([|]|$)'
      and qi.quantity>0 and qi.quantity<=1000 and qi.quantity=trunc(qi.quantity)
    group by lower(btrim(qi.product_name))
  ) select coalesce(jsonb_agg(jsonb_build_object('productName',m.product_name,'unitNumber',u.unit_number)
      order by m.model,u.unit_number),'[]'::jsonb) into v_all_devices
    from models m cross join lateral generate_series(1,m.quantity) u(unit_number);
  if jsonb_array_length(v_all_devices)>1000 then
    raise exception 'Egy telepítésnél legfeljebb 1000 készülék jelölhető.' using errcode='22023';
  end if;
  if previous.source_installation_id is not null then
    v_declined := case when previous.choice='declined' then v_all_devices else coalesce(previous.declined_devices,'[]'::jsonb) end;
  else
    -- Existing explicit decisions take precedence. Only absent decisions use
    -- the same source / accepted mirror / contact-only legacy fallback as UI.
    if v_is_source then v_legacy_declined := coalesce(source_installation.maintenance_opt_out,false);
    elsif own_installation.id is not null then v_legacy_declined := coalesce(own_installation.maintenance_opt_out,false);
    else
      select coalesce(p.maintenance_opt_out,false) into v_legacy_declined from public.shared_maintenance_preferences p
        where p.source_workspace_id=v_source_workspace and p.source_installation_id=v_source_installation
          and p.target_workspace_id=p_workspace_id;
    end if;
    v_declined := case when coalesce(v_legacy_declined,false) then v_all_devices else '[]'::jsonb end;
  end if;
  -- Reject stale stored unit identities instead of silently changing other
  -- checkboxes when the installation's device list has been edited separately.
  if jsonb_array_length(v_declined)>0 then
    v_declined := public.validate_maintenance_device_selection(v_source_workspace,source_installation.customer_id,
      v_source_installation,v_declined);
  end if;
  select coalesce(jsonb_agg(d order by lower(btrim(d->>'productName')),(d->>'unitNumber')::integer),'[]'::jsonb)
    into v_declined from jsonb_array_elements(v_declined) d
    where not(lower(btrim(d->>'productName'))=lower(btrim(v_device->>'productName'))
      and (d->>'unitNumber')::integer=(v_device->>'unitNumber')::integer);
  if p_declined then
    v_declined := public.normalize_maintenance_device_selection(v_declined || jsonb_build_array(v_device));
  end if;
  p_choice := case when jsonb_array_length(v_declined)=jsonb_array_length(v_all_devices) then 'declined' else 'open' end;
  if p_choice='declined' or jsonb_array_length(v_declined)=0 then v_declined := null; end if;
$calculation$;
begin
  if existing is not null then
    if strpos(pg_get_functiondef(existing),'maintenance-device-preferences-v1')>0 then return; end if;
    raise exception 'Unexpected existing per-device preference function.';
  end if;
  if f is null or to_regprocedure('public.validate_maintenance_device_selection(uuid,uuid,uuid,jsonb)') is null then
    raise exception 'Install contact choices and partial maintenance first.';
  end if;
  select pg_get_functiondef(p.oid) into definition from pg_proc p where p.oid=f
    and p.prosecdef and p.proconfig=array['search_path=pg_catalog, pg_temp'];
  if definition is null or strpos(definition,'g.target_user_id is distinct from auth.uid()')=0
    or strpos(definition,'previous.updated_at is distinct from p_expected_updated_at')=0
    or strpos(definition,'perform 1 from public.shared_maintenance_installation_rows(p_workspace_id)')=0 then
    raise exception 'Unexpected contact-choice access guards. No function was changed.';
  end if;
  definition := regexp_replace(definition,'FUNCTION public.set_maintenance_contact_preference\([^)]*\)',
    'FUNCTION public.set_maintenance_device_preference(p_workspace_id uuid, p_installation_id uuid, p_device jsonb, p_declined boolean, p_expected_updated_at timestamp with time zone, p_grant_id uuid DEFAULT NULL::uuid)');
  for old_text,new_text in select * from (values
    ($old$  v_saved_at timestamptz;$old$,$new$  v_saved_at timestamptz;
  p_choice text; v_device jsonb; v_all_devices jsonb; v_declined jsonb; v_legacy_declined boolean;$new$),
    ($old$  if p_choice is null or p_choice not in ('open','original_installer','declined') then$old$,
     $new$  if p_declined is null or p_device is null or jsonb_typeof(p_device)<>'object' then$new$),
    ($old$  v_saved_at := greatest($old$,calculation||$new$  v_saved_at := greatest($new$),
    ($old$source_installation_id,choice,updated_at,updated_by,updated_workspace_id)$old$,
     $new$source_installation_id,choice,declined_devices,updated_at,updated_by,updated_workspace_id)$new$),
    ($old$values(v_source_workspace,v_source_installation,p_choice,v_saved_at,auth.uid(),p_workspace_id)$old$,
     $new$values(v_source_workspace,v_source_installation,p_choice,v_declined,v_saved_at,auth.uid(),p_workspace_id)$new$),
    ($old$do update set choice=excluded.choice,updated_at=excluded.updated_at,$old$,
     $new$do update set choice=excluded.choice,declined_devices=excluded.declined_devices,updated_at=excluded.updated_at,$new$),
    ($old$'choice',p_choice,'updatedAt',v_saved_at$old$,
     $new$'choice',p_choice,'declinedDevices',v_declined,'updatedAt',v_saved_at$new$)
  ) replacements(old_value,new_value) loop
    if (length(definition)-length(replace(definition,old_text,'')))<>length(old_text) then
      raise exception 'Unexpected contact-choice implementation. No function was changed.';
    end if;
    definition := replace(definition,old_text,new_text);
  end loop;
  if strpos(definition,'FUNCTION public.set_maintenance_device_preference(')=0 then
    raise exception 'Unexpected contact-choice signature. No function was changed.';
  end if;
  execute definition;
end;
$device_rpc$;

revoke all on function public.set_maintenance_device_preference(uuid,uuid,jsonb,boolean,timestamptz,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.set_maintenance_device_preference(uuid,uuid,jsonb,boolean,timestamptz,uuid) to authenticated;

do $read_and_whole$
declare f oid; definition text; metadata jsonb; old_text text; new_text text; expected_count integer;
begin
  for f in select unnest(array[
    to_regprocedure('public.list_maintenance_contact_preferences(uuid)')::oid,
    to_regprocedure('public.set_maintenance_contact_preference(uuid,uuid,text,timestamptz,uuid)')::oid]) loop
    if f is null then raise exception 'Install existing contact-choice functions first.'; end if;
    select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,metadata from pg_proc p where p.oid=f;
    if strpos(definition,'maintenance-device-choice-view-v1')>0 then continue; end if;
    if f=to_regprocedure('public.list_maintenance_contact_preferences(uuid)') then
      old_text := $old$'choice',p.choice,'updatedAt',p.updated_at$old$;
      new_text := $new$'choice',p.choice,/* maintenance-device-choice-view-v1 */ 'declinedDevices',p.declined_devices,'updatedAt',p.updated_at$new$;
      expected_count := 2;
    else
      old_text := $old$do update set choice=excluded.choice,updated_at=excluded.updated_at,$old$;
      new_text := $new$do update set choice=excluded.choice,declined_devices=null,updated_at=excluded.updated_at,$new$;
      expected_count := 1;
    end if;
    if (length(definition)-length(replace(definition,old_text,'')))<>length(old_text)*expected_count then
      raise exception 'Unexpected contact-choice view or whole-choice write. No function was changed.';
    end if;
    definition := replace(definition,old_text,new_text);
    if expected_count=1 then
      old_text := $old$'choice',p_choice,'updatedAt',v_saved_at$old$;
      if (length(definition)-length(replace(definition,old_text,'')))<>length(old_text) then
        raise exception 'Unexpected whole-choice response. No function was changed.';
      end if;
      definition := replace(definition,old_text,
        $new$'choice',p_choice,/* maintenance-device-choice-view-v1 */ 'declinedDevices',null,'updatedAt',v_saved_at$new$);
    end if;
    execute definition;
    if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=f) is distinct from metadata then
      raise exception 'Contact-choice permissions or function metadata changed unexpectedly.';
    end if;
  end loop;
end;
$read_and_whole$;
commit;
