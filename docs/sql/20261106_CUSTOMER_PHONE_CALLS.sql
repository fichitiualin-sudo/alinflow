-- Append-only phone activity. Dialer opening is an initiated event, never proof
-- that a conversation took place. No existing notes or documents are changed.
begin;

-- Latest activity is separate from customer notes and generic updated_at.
alter table public.customers add column if not exists last_phone_call_at timestamptz;

create table if not exists public.customer_phone_calls (
  id uuid primary key,
  source_workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_customer_id uuid not null references public.customers(id) on delete cascade,
  source_appointment_id uuid references public.appointments(id) on delete set null,
  source_installation_id uuid references public.appointments(id) on delete set null,
  actor_workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null,
  actor_name text not null,
  grant_id uuid references public.shared_maintenance_grants(id) on delete restrict,
  kind text not null check (kind in ('initiated','recorded')),
  occurred_at timestamptz not null check (isfinite(occurred_at)),
  recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists customer_phone_calls_customer_idx
  on public.customer_phone_calls(source_workspace_id,source_customer_id,occurred_at desc,id);
create index if not exists customer_phone_calls_shared_idx
  on public.customer_phone_calls(source_installation_id,actor_workspace_id,occurred_at desc,id);
alter table public.customer_phone_calls enable row level security;
revoke all on public.customer_phone_calls from public,anon,authenticated,service_role;

create or replace function public.customer_phone_call_json(p_call public.customer_phone_calls)
returns jsonb language sql immutable security definer set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('id',p_call.id,'kind',p_call.kind,'occurredAt',p_call.occurred_at,
    'recordedAt',p_call.recorded_at,'actorName',p_call.actor_name,'installationId',p_call.source_installation_id);
$$;

-- Private writer; callers have already locked and checked their exact scope.
create or replace function public.insert_customer_phone_call(
  p_source_workspace_id uuid,p_source_customer_id uuid,p_source_appointment_id uuid,p_source_installation_id uuid,
  p_actor_workspace_id uuid,p_grant_id uuid,p_kind text,p_occurred_at timestamptz,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare saved public.customer_phone_calls%rowtype; occurred timestamptz; actor_name text;
begin
  if p_request_id is null or p_kind is null or p_kind not in ('initiated','recorded') then
    raise exception 'A hívásrögzítés adatai hiányosak.' using errcode='22023';
  end if;
  if p_kind='initiated' then
    if p_occurred_at is not null then raise exception 'A hívásindítás idejét a szerver rögzíti.' using errcode='22023'; end if;
    occurred := clock_timestamp();
  else
    if p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>clock_timestamp() then
      raise exception 'Adj meg érvényes, nem jövőbeli hívásidőpontot.' using errcode='22023';
    end if;
    occurred := p_occurred_at;
  end if;
  select w.name into actor_name from public.workspaces w where w.id=p_actor_workspace_id and w.active;
  if actor_name is null then raise exception 'A munkaterület nem érhető el.' using errcode='42501'; end if;
  insert into public.customer_phone_calls(id,source_workspace_id,source_customer_id,source_appointment_id,
    source_installation_id,actor_workspace_id,actor_id,actor_name,grant_id,kind,occurred_at)
    values(p_request_id,p_source_workspace_id,p_source_customer_id,p_source_appointment_id,p_source_installation_id,
      p_actor_workspace_id,auth.uid(),actor_name,p_grant_id,p_kind,occurred)
    on conflict(id) do nothing;
  select * into saved from public.customer_phone_calls where id=p_request_id;
  if not found or (saved.source_workspace_id,saved.source_customer_id,saved.source_appointment_id,
      saved.source_installation_id,saved.actor_workspace_id,saved.actor_id,saved.grant_id,saved.kind)
    is distinct from (p_source_workspace_id,p_source_customer_id,p_source_appointment_id,
      p_source_installation_id,p_actor_workspace_id,auth.uid(),p_grant_id,p_kind)
    or (p_kind='recorded' and saved.occurred_at is distinct from p_occurred_at) then
    raise exception 'A hívásrögzítés azonosítója másik művelethez tartozik.' using errcode='23514';
  end if;
  update public.customers c set last_phone_call_at=saved.occurred_at
    where c.id=p_source_customer_id and c.workspace_id=p_source_workspace_id
      and (c.last_phone_call_at is null or c.last_phone_call_at<saved.occurred_at);
  return public.customer_phone_call_json(saved);
end;
$$;

create or replace function public.record_customer_phone_call(p_workspace_id uuid,p_customer_id uuid,
  p_appointment_id uuid,p_kind text,p_occurred_at timestamptz,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if not public.shared_maintenance_member(p_workspace_id,auth.uid(),false) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  -- Serialize timestamp updates before locking appointments: same order as
  -- address/geocode writes; parallel calls never upgrade shared customer locks.
  perform 1 from public.customers c where c.id=p_customer_id and c.workspace_id=p_workspace_id for update;
  if not found then raise exception 'Az ügyfél nem érhető el.' using errcode='42501'; end if;
  if p_appointment_id is not null then
    perform 1 from public.appointments a where a.id=p_appointment_id and a.workspace_id=p_workspace_id
      and a.customer_id=p_customer_id for share;
    if not found then raise exception 'Az időpont nem ehhez az ügyfélhez tartozik.' using errcode='42501'; end if;
  end if;
  return public.insert_customer_phone_call(p_workspace_id,p_customer_id,p_appointment_id,null,
    p_workspace_id,null,p_kind,p_occurred_at,p_request_id);
end;
$$;

create or replace function public.list_customer_phone_calls(p_workspace_id uuid,p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  if not public.shared_maintenance_member(p_workspace_id,auth.uid(),false)
    or not exists(select 1 from public.customers c where c.id=p_customer_id and c.workspace_id=p_workspace_id) then
    raise exception 'Az ügyfél nem érhető el.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(public.customer_phone_call_json(recent) order by recent.occurred_at desc,recent.id)
    from (select c.* from public.customer_phone_calls c where c.source_workspace_id=p_workspace_id
      and c.source_customer_id=p_customer_id order by c.occurred_at desc,c.id limit 100) recent),'[]'::jsonb);
end;
$$;

create or replace function public.record_shared_maintenance_phone_call(p_workspace_id uuid,p_grant_id uuid,
  p_installation_id uuid,p_kind text,p_occurred_at timestamptz,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare g public.shared_maintenance_grants%rowtype; source_customer uuid;
begin
  if not public.shared_maintenance_member(p_workspace_id,auth.uid(),false) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  -- Same grant -> source ordering as acceptance and revocation. No handoff is
  -- created; a contact-only caller remains contact-only after recording a call.
  select * into g from public.shared_maintenance_grants where id=p_grant_id for share;
  if not found or g.revoked_at is not null or g.target_workspace_id is distinct from p_workspace_id
    or g.target_user_id is distinct from auth.uid() then
    raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501';
  end if;
  -- Discover, then lock customer -> appointment explicitly. A joined FOR SHARE
  -- can lock in planner-dependent order and deadlock with customer address edits.
  select a.customer_id into source_customer from public.appointments a
    where a.id=p_installation_id and a.workspace_id=g.source_workspace_id and a.appointment_type='installation';
  if not found then raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501'; end if;
  perform 1 from public.customers c where c.id=source_customer and c.workspace_id=g.source_workspace_id for update;
  if not found then raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501'; end if;
  perform 1 from public.appointments a where a.id=p_installation_id and a.workspace_id=g.source_workspace_id
    and a.customer_id=source_customer and a.appointment_type='installation' for share;
  if not found then raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501'; end if;
  perform 1 from public.shared_maintenance_installation_rows(p_workspace_id) r
    where r.grant_id=g.id and r.installation_id=p_installation_id and r.source_workspace_id=g.source_workspace_id
      and r.source_customer_id=source_customer;
  if not found then raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501'; end if;
  return public.insert_customer_phone_call(g.source_workspace_id,source_customer,null,p_installation_id,
    p_workspace_id,g.id,p_kind,p_occurred_at,p_request_id);
end;
$$;

create or replace function public.list_shared_maintenance_phone_calls(p_workspace_id uuid,p_grant_id uuid,p_installation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare source_workspace uuid; source_customer uuid;
begin
  if not public.shared_maintenance_member(p_workspace_id,auth.uid(),false) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  select r.source_workspace_id,r.source_customer_id into source_workspace,source_customer
    from public.shared_maintenance_installation_rows(p_workspace_id) r
    where r.grant_id=p_grant_id and r.installation_id=p_installation_id;
  if not found then raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(public.customer_phone_call_json(recent) order by recent.occurred_at desc,recent.id)
    from (select c.* from public.customer_phone_calls c where c.source_workspace_id=source_workspace
      and c.source_customer_id=source_customer and c.source_installation_id=p_installation_id
      and c.actor_workspace_id=p_workspace_id order by c.occurred_at desc,c.id limit 100) recent),'[]'::jsonb);
end;
$$;

revoke all on function public.customer_phone_call_json(public.customer_phone_calls),
  public.insert_customer_phone_call(uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz,uuid),
  public.record_customer_phone_call(uuid,uuid,uuid,text,timestamptz,uuid),
  public.list_customer_phone_calls(uuid,uuid),
  public.record_shared_maintenance_phone_call(uuid,uuid,uuid,text,timestamptz,uuid),
  public.list_shared_maintenance_phone_calls(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.record_customer_phone_call(uuid,uuid,uuid,text,timestamptz,uuid),
  public.list_customer_phone_calls(uuid,uuid),
  public.record_shared_maintenance_phone_call(uuid,uuid,uuid,text,timestamptz,uuid),
  public.list_shared_maintenance_phone_calls(uuid,uuid,uuid) to authenticated;
commit;
