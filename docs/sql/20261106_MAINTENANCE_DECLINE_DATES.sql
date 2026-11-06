-- Record the start of each currently active refusal. No historical backfill:
-- updated_at is a concurrency token, not evidence of when a device was refused.
-- Apply after 20261106_MAINTENANCE_DEVICE_PREFERENCES.sql. Re-runnable.
begin;

alter table public.maintenance_contact_preferences
  add column if not exists declined_at timestamptz,
  add column if not exists declined_device_dates jsonb;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.maintenance_contact_preferences'::regclass
    and conname='maintenance_declined_device_dates_array') then
    alter table public.maintenance_contact_preferences add constraint maintenance_declined_device_dates_array
      check(declined_device_dates is null or jsonb_typeof(declined_device_dates)='array');
  end if;
end $$;

-- Both public setters already serialize on the source appointment and enforce
-- the same exact-user grants and expected updated_at. This private trigger adds
-- dates to their existing write without changing those authorization paths.
create or replace function public.record_maintenance_decline_dates()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  previous public.maintenance_contact_preferences%rowtype;
  source_installation public.appointments%rowtype;
  prior_all boolean := false;
  prior_devices jsonb := '[]'::jsonb;
  current_devices jsonb := '[]'::jsonb;
  all_devices jsonb := '[]'::jsonb;
  marked_at timestamptz := clock_timestamp();
begin
  if tg_table_schema<>'public' or tg_table_name<>'maintenance_contact_preferences' or tg_op not in ('INSERT','UPDATE') then
    raise exception 'Érvénytelen karbantartási dátumművelet.' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if (new.source_workspace_id,new.source_installation_id) is distinct from (old.source_workspace_id,old.source_installation_id) then
      raise exception 'A karbantartási jelölés telepítése nem módosítható.' using errcode='23514';
    end if;
    previous := old;
  else
    -- BEFORE INSERT also runs for ON CONFLICT updates. Read the existing row so
    -- repeated RPC saves never replace an earlier device's refusal timestamp.
    select p.* into previous from public.maintenance_contact_preferences p
      where p.source_workspace_id=new.source_workspace_id and p.source_installation_id=new.source_installation_id;
  end if;
  select a.* into source_installation from public.appointments a
    where a.id=new.source_installation_id and a.workspace_id=new.source_workspace_id and a.appointment_type='installation';
  if not found then raise exception 'A telepítés nem érhető el.' using errcode='23514'; end if;
  with models as (
    select lower(btrim(qi.product_name)) model,min(btrim(qi.product_name)) product_name,sum(qi.quantity)::integer quantity
    from public.quotes q join public.quote_items qi on qi.quote_id=q.id and qi.workspace_id=q.workspace_id
    where q.id=source_installation.quote_id and q.workspace_id=source_installation.workspace_id
      and q.customer_id=source_installation.customer_id
      and coalesce(qi.description,'') !~ '(^|[|])item_type=extra([|]|$)'
      and qi.quantity>0 and qi.quantity<=1000 and qi.quantity=trunc(qi.quantity)
    group by lower(btrim(qi.product_name))
  ) select coalesce(jsonb_agg(jsonb_build_object('productName',m.product_name,'unitNumber',u.unit_number)
      order by m.model,u.unit_number),'[]'::jsonb) into all_devices
    from models m cross join lateral generate_series(1,m.quantity) u(unit_number);

  if previous.source_installation_id is not null then
    prior_all := previous.choice='declined';
    prior_devices := case when prior_all then all_devices else coalesce(previous.declined_devices,'[]'::jsonb) end;
  else
    -- A legacy true flag is an already active refusal with an unknown date in
    -- this new history. Do not relabel it as today's refusal on an unrelated tap.
    if new.updated_workspace_id=new.source_workspace_id then
      prior_all := coalesce(source_installation.maintenance_opt_out,false);
    else
      select case when mirror.id is not null then coalesce(mirror.maintenance_opt_out,false)
        else coalesce(legacy.maintenance_opt_out,false) end into prior_all
      from (select 1) singleton
      left join public.shared_maintenance_handoffs h on h.source_workspace_id=new.source_workspace_id
        and h.source_installation_id=new.source_installation_id and h.target_workspace_id=new.updated_workspace_id
      left join public.appointments mirror on mirror.id=h.target_installation_id and mirror.workspace_id=h.target_workspace_id
        and mirror.customer_id=h.target_customer_id and mirror.appointment_type='installation' and mirror.maintenance_origin='external'
      left join public.shared_maintenance_preferences legacy on legacy.source_workspace_id=new.source_workspace_id
        and legacy.source_installation_id=new.source_installation_id and legacy.target_workspace_id=new.updated_workspace_id;
    end if;
    prior_devices := case when coalesce(prior_all,false) then all_devices else '[]'::jsonb end;
  end if;

  current_devices := case when new.choice='declined' then all_devices else coalesce(new.declined_devices,'[]'::jsonb) end;
  new.declined_at := case when new.choice='declined' then
    case when coalesce(prior_all,false) then previous.declined_at else marked_at end else null end;
  -- Keep known dates for units that remain refused. New false -> true units get
  -- server time. Unknown old dates remain absent, including global normalization.
  select jsonb_agg(jsonb_build_object('productName',d->>'productName','unitNumber',(d->>'unitNumber')::integer,
      'declinedAt',case when exists(select 1 from jsonb_array_elements(prior_devices) prior
        where lower(btrim(prior->>'productName'))=lower(btrim(d->>'productName'))
          and (prior->>'unitNumber')::integer=(d->>'unitNumber')::integer)
        then known->'declinedAt' else to_jsonb(marked_at) end)
      order by lower(btrim(d->>'productName')),(d->>'unitNumber')::integer)
    into new.declined_device_dates
    from jsonb_array_elements(current_devices) d
    left join lateral (
      select value as known from jsonb_array_elements(coalesce(previous.declined_device_dates,'[]'::jsonb))
      where lower(btrim(value->>'productName'))=lower(btrim(d->>'productName'))
        and (value->>'unitNumber')::integer=(d->>'unitNumber')::integer
      limit 1
    ) saved on true
    where known->>'declinedAt' is not null or not exists(select 1 from jsonb_array_elements(prior_devices) prior
      where lower(btrim(prior->>'productName'))=lower(btrim(d->>'productName'))
        and (prior->>'unitNumber')::integer=(d->>'unitNumber')::integer);
  return new;
end;
$$;

revoke all on function public.record_maintenance_decline_dates() from public,anon,authenticated,service_role;
drop trigger if exists maintenance_decline_dates_record on public.maintenance_contact_preferences;
create trigger maintenance_decline_dates_record before insert or update on public.maintenance_contact_preferences
  for each row execute function public.record_maintenance_decline_dates();

-- Return stored trigger-generated dates rather than updated_at or browser time.
-- Existing functions retain owner, ACL, arguments, volatility and search_path.
do $date_views$
declare f oid; definition text; metadata jsonb; old_text text; new_text text; replacements integer;
begin
  for f in select unnest(array[
    to_regprocedure('public.list_maintenance_contact_preferences(uuid)')::oid,
    to_regprocedure('public.set_maintenance_contact_preference(uuid,uuid,text,timestamptz,uuid)')::oid,
    to_regprocedure('public.set_maintenance_device_preference(uuid,uuid,jsonb,boolean,timestamptz,uuid)')::oid]) loop
    if f is null then raise exception 'Install device preferences before refusal dates.'; end if;
    select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,metadata from pg_proc p where p.oid=f;
    if strpos(definition,'maintenance-decline-dates-v1')>0 then continue; end if;
    if f=to_regprocedure('public.list_maintenance_contact_preferences(uuid)') then
      old_text := $old$'declinedDevices',p.declined_devices,'updatedAt',p.updated_at$old$;
      new_text := $new$'declinedDevices',p.declined_devices,/* maintenance-decline-dates-v1 */
      'declinedAt',p.declined_at,'declinedDeviceDates',p.declined_device_dates,'updatedAt',p.updated_at$new$;
      replacements := 2;
    else
      old_text := '  v_saved_at timestamptz;';
      if (length(definition)-length(replace(definition,old_text,'')))<>length(old_text) then
        raise exception 'Unexpected preference declarations. No function was changed.';
      end if;
      definition := replace(definition,old_text,old_text||E'\n  saved_dates public.maintenance_contact_preferences%rowtype;');
      old_text := '  select name into v_source_name from public.workspaces where id=v_source_workspace;';
      if (length(definition)-length(replace(definition,old_text,'')))<>length(old_text) then
        raise exception 'Unexpected preference result scope. No function was changed.';
      end if;
      definition := replace(definition,old_text,
        $new$  select p.* into saved_dates from public.maintenance_contact_preferences p
    where p.source_workspace_id=v_source_workspace and p.source_installation_id=v_source_installation;
$new$||old_text);
      old_text := $old$'updatedAt',v_saved_at,'isSource',v_is_source$old$;
      new_text := $new$/* maintenance-decline-dates-v1 */ 'declinedAt',saved_dates.declined_at,
    'declinedDeviceDates',saved_dates.declined_device_dates,'updatedAt',v_saved_at,'isSource',v_is_source$new$;
      replacements := 1;
    end if;
    if (length(definition)-length(replace(definition,old_text,'')))<>length(old_text)*replacements then
      raise exception 'Unexpected preference DTO. No function was changed.';
    end if;
    definition := replace(definition,old_text,new_text);
    execute definition;
    if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=f) is distinct from metadata then
      raise exception 'Preference function permissions or metadata changed unexpectedly.';
    end if;
  end loop;
end;
$date_views$;
commit;
