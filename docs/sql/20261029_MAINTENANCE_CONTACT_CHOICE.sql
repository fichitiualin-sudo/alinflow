-- Explicit, shared maintenance contact choice. Run after the existing shared
-- access/history/opt-out migrations. Re-runnable; installation, mirror and
-- legacy per-recipient preferences are never migrated or reclassified.
begin;

create table if not exists public.maintenance_contact_preferences (
  source_workspace_id uuid not null references public.workspaces(id) on delete restrict,
  source_installation_id uuid not null references public.appointments(id) on delete cascade,
  choice text not null check(choice in ('open','original_installer','declined')),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_workspace_id uuid not null references public.workspaces(id) on delete restrict,
  primary key(source_workspace_id,source_installation_id)
);

alter table public.maintenance_contact_preferences enable row level security;
revoke all on public.maintenance_contact_preferences from public,anon,authenticated,service_role;

create or replace function public.list_maintenance_contact_preferences(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare own_preferences jsonb; received_preferences jsonb := '[]'::jsonb;
begin
  if not public.shared_maintenance_member(p_workspace_id,auth.uid(),false) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  -- Local source installations, including manually recorded external units.
  -- A delegated mirror can never become a source through an edited label.
  select coalesce(jsonb_agg(jsonb_build_object('installationId',a.id,
      'sourceInstallationId',a.id,'sourceWorkspaceId',a.workspace_id,'sourceWorkspaceName',w.name,
      'choice',p.choice,'updatedAt',p.updated_at,'isSource',true)),'[]'::jsonb) into own_preferences
    from public.maintenance_contact_preferences p
    join public.appointments a on a.id=p.source_installation_id and a.workspace_id=p.source_workspace_id
    join public.customers c on c.id=a.customer_id and c.workspace_id=a.workspace_id
    join public.workspaces w on w.id=a.workspace_id and w.active
    where a.workspace_id=p_workspace_id and a.appointment_type='installation'
      and not exists(select 1 from public.shared_maintenance_handoffs provenance where provenance.target_installation_id=a.id);
  -- The private helper builds contact/device payloads and maintenance history.
  -- Do not call it unless an incoming grant's source has any explicit choice.
  -- This is only an inexpensive presence check, never an authorization source.
  if exists(select 1 from public.shared_maintenance_grants g
    join public.maintenance_contact_preferences p on p.source_workspace_id=g.source_workspace_id
    where g.target_workspace_id=p_workspace_id and g.target_user_id=auth.uid() and g.revoked_at is null) then
    -- Reuse, do not broaden, the existing exact-user grant eligibility rules.
    select coalesce(jsonb_agg(jsonb_build_object('installationId',coalesce(mirror.id,r.installation_id),
      'sourceInstallationId',r.installation_id,'sourceWorkspaceId',r.source_workspace_id,
      'sourceWorkspaceName',r.payload->>'sourceWorkspaceName','choice',p.choice,'updatedAt',p.updated_at,'isSource',false)),'[]'::jsonb)
      into received_preferences
    from public.shared_maintenance_installation_rows(p_workspace_id) r
    join public.maintenance_contact_preferences p on p.source_workspace_id=r.source_workspace_id and p.source_installation_id=r.installation_id
    left join public.shared_maintenance_handoffs h on h.source_workspace_id=r.source_workspace_id
      and h.source_installation_id=r.installation_id and h.target_workspace_id=p_workspace_id
    left join public.appointments mirror on mirror.id=h.target_installation_id and mirror.workspace_id=p_workspace_id
      and mirror.customer_id=h.target_customer_id and mirror.appointment_type='installation' and mirror.maintenance_origin='external'
      and exists(select 1 from public.customers mc where mc.id=mirror.customer_id and mc.workspace_id=mirror.workspace_id)
    where h.target_installation_id is null or mirror.id is not null;
  end if;
  return coalesce((select jsonb_agg(entry.payload order by (entry.payload->>'installationId')::uuid)
    from jsonb_array_elements(own_preferences || received_preferences) entry(payload)),'[]'::jsonb);
end;
$$;

create or replace function public.set_maintenance_contact_preference(
  p_workspace_id uuid,p_installation_id uuid,p_choice text,p_expected_updated_at timestamptz,p_grant_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  g public.shared_maintenance_grants%rowtype;
  handoff public.shared_maintenance_handoffs%rowtype;
  own_installation public.appointments%rowtype;
  source_installation public.appointments%rowtype;
  previous public.maintenance_contact_preferences%rowtype;
  v_source_workspace uuid;
  v_source_installation uuid;
  v_view_installation uuid;
  v_source_name text;
  v_grant uuid;
  v_is_source boolean := false;
  v_saved_at timestamptz;
begin
  if p_choice is null or p_choice not in ('open','original_installer','declined') then
    raise exception 'Érvénytelen karbantartási jelölés.' using errcode='22023';
  end if;
  if not public.shared_maintenance_member(p_workspace_id,auth.uid(),false) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  if p_grant_id is not null then
    v_grant := p_grant_id;
    v_source_installation := p_installation_id;
  else
    select a.* into own_installation from public.appointments a
      join public.customers c on c.id=a.customer_id and c.workspace_id=a.workspace_id
      where a.id=p_installation_id and a.workspace_id=p_workspace_id and a.appointment_type='installation';
    if not found then raise exception 'A telepítés nem érhető el.' using errcode='42501'; end if;
    -- Look up provenance by ID before checking its workspace, so corrupt or
    -- relabelled mirrors fail closed instead of gaining source-owner powers.
    select * into handoff from public.shared_maintenance_handoffs where target_installation_id=p_installation_id;
    if found then
      if handoff.target_workspace_id is distinct from p_workspace_id
        or handoff.target_customer_id is distinct from own_installation.customer_id
        or own_installation.maintenance_origin is distinct from 'external' then
        raise exception 'Az átvett telepítés hivatkozása megváltozott. Ellenőrzés szükséges.' using errcode='23514';
      end if;
      v_source_workspace := handoff.source_workspace_id;
      v_source_installation := handoff.source_installation_id;
      select id into v_grant from public.shared_maintenance_grants
        where source_workspace_id=v_source_workspace and target_workspace_id=p_workspace_id
          and target_user_id=auth.uid() and revoked_at is null;
      if v_grant is null then raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501'; end if;
    else
      v_is_source := true;
      v_source_workspace := p_workspace_id;
      v_source_installation := p_installation_id;
      v_view_installation := p_installation_id;
    end if;
  end if;

  -- Match acceptance/revocation's grant -> source -> handoff/mirror lock order.
  if not v_is_source then
    select * into g from public.shared_maintenance_grants where id=v_grant for update;
    if not found or g.revoked_at is not null or g.target_user_id is distinct from auth.uid()
      or g.target_workspace_id is distinct from p_workspace_id
      or (v_source_workspace is not null and g.source_workspace_id is distinct from v_source_workspace) then
      raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501';
    end if;
    v_source_workspace := g.source_workspace_id;
  end if;
  select a.* into source_installation from public.appointments a
    join public.customers c on c.id=a.customer_id and c.workspace_id=a.workspace_id
    where a.id=v_source_installation and a.workspace_id=v_source_workspace and a.appointment_type='installation' for update of a;
  if not found then raise exception 'A telepítés nem érhető el.' using errcode='42501'; end if;
  if exists(select 1 from public.shared_maintenance_handoffs where target_installation_id=source_installation.id) then
    raise exception 'Az átvett telepítés hivatkozása megváltozott. Ellenőrzés szükséges.' using errcode='23514';
  end if;
  if not v_is_source then
    perform 1 from public.shared_maintenance_installation_rows(p_workspace_id)
      where grant_id=g.id and installation_id=v_source_installation and source_workspace_id=v_source_workspace;
    if not found then raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501'; end if;
    select * into handoff from public.shared_maintenance_handoffs
      where source_workspace_id=v_source_workspace and source_installation_id=v_source_installation
        and target_workspace_id=p_workspace_id for update;
    v_view_installation := v_source_installation;
    if handoff.target_installation_id is not null then
      select a.* into own_installation from public.appointments a
        join public.customers c on c.id=a.customer_id and c.workspace_id=a.workspace_id
        where a.id=handoff.target_installation_id and a.workspace_id=p_workspace_id
          and a.customer_id=handoff.target_customer_id and a.appointment_type='installation'
          and a.maintenance_origin='external' for update of a;
      if not found then
        raise exception 'Az átvett telepítés hivatkozása megváltozott. Ellenőrzés szükséges.' using errcode='23514';
      end if;
      v_view_installation := own_installation.id;
    end if;
    if p_grant_id is null and v_view_installation is distinct from p_installation_id then
      raise exception 'Az átvett telepítés hivatkozása megváltozott. Ellenőrzés szükséges.' using errcode='23514';
    end if;
  end if;
  if p_choice='original_installer' and source_installation.maintenance_origin is distinct from 'own' then
    raise exception 'Ennél a telepítésnél nincs ismert eredeti szerelő.' using errcode='22023';
  end if;

  -- The locked source also serializes two first writes when no preference exists.
  select * into previous from public.maintenance_contact_preferences
    where source_workspace_id=v_source_workspace and source_installation_id=v_source_installation for update;
  if previous.updated_at is distinct from p_expected_updated_at then
    raise exception 'A karbantartási jelölés közben megváltozott. Frissítsd az adatokat, majd próbáld újra.' using errcode='40001';
  end if;
  v_saved_at := greatest(clock_timestamp(),coalesce(previous.updated_at + interval '1 microsecond','-infinity'::timestamptz));
  insert into public.maintenance_contact_preferences(source_workspace_id,source_installation_id,choice,updated_at,updated_by,updated_workspace_id)
    values(v_source_workspace,v_source_installation,p_choice,v_saved_at,auth.uid(),p_workspace_id)
    on conflict(source_workspace_id,source_installation_id) do update set choice=excluded.choice,updated_at=excluded.updated_at,
      updated_by=excluded.updated_by,updated_workspace_id=excluded.updated_workspace_id;
  -- A source user's explicit reactivation is the existing ordinary un-opt-out.
  -- A partner can never reopen a source row excluded by the eligibility helper.
  if v_is_source and p_choice in ('open','original_installer') and coalesce(source_installation.maintenance_opt_out,false) then
    update public.appointments set maintenance_opt_out=false,maintenance_opt_out_at=null
      where id=v_source_installation and workspace_id=v_source_workspace;
  end if;
  select name into v_source_name from public.workspaces where id=v_source_workspace;
  return jsonb_build_object('installationId',v_view_installation,'sourceInstallationId',v_source_installation,
    'sourceWorkspaceId',v_source_workspace,'sourceWorkspaceName',v_source_name,'choice',p_choice,'updatedAt',v_saved_at,'isSource',v_is_source);
end;
$$;

revoke all on function public.list_maintenance_contact_preferences(uuid),
  public.set_maintenance_contact_preference(uuid,uuid,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_maintenance_contact_preferences(uuid),
  public.set_maintenance_contact_preference(uuid,uuid,text,timestamptz,uuid) to authenticated;

commit;
