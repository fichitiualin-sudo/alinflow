-- Recipient-workspace maintenance preference for contact-only shared rows.
-- Run after the shared-maintenance access and history migrations. Re-runnable;
-- no grants, source business rows or existing accepted mirrors are changed.
begin;

create table if not exists public.shared_maintenance_preferences (
  source_workspace_id uuid not null references public.workspaces(id) on delete restrict,
  source_installation_id uuid not null references public.appointments(id) on delete cascade,
  target_workspace_id uuid not null references public.workspaces(id) on delete restrict,
  grant_id uuid not null references public.shared_maintenance_grants(id) on delete restrict,
  maintenance_opt_out boolean not null default false,
  maintenance_opt_out_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  primary key(source_workspace_id,source_installation_id,target_workspace_id),
  check(source_workspace_id <> target_workspace_id),
  check(maintenance_opt_out = (maintenance_opt_out_at is not null))
);

alter table public.shared_maintenance_preferences enable row level security;
revoke all on public.shared_maintenance_preferences from public,anon,authenticated,service_role;

-- Keep all existing eligibility checks in the shared read helper. A recipient's
-- own preference does not remove the row, so it remains visible and reversible.
create or replace function public.list_received_maintenance_installations(p_target_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  if not public.shared_maintenance_member(p_target_workspace_id,auth.uid(),false) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(r.payload || jsonb_build_object(
      'maintenanceOptOut',case when mirror.id is not null then coalesce(mirror.maintenance_opt_out,false)
        else coalesce(preference.maintenance_opt_out,false) end,
      'maintenanceOptOutAt',case when mirror.id is not null then mirror.maintenance_opt_out_at
        else preference.maintenance_opt_out_at end)
      order by r.payload#>>'{customer,name}',r.installation_id)
    from public.shared_maintenance_installation_rows(p_target_workspace_id) r
    left join public.shared_maintenance_preferences preference on preference.source_workspace_id=r.source_workspace_id
      and preference.source_installation_id=r.installation_id and preference.target_workspace_id=p_target_workspace_id
    left join public.appointments mirror on mirror.id=(r.payload->>'targetInstallationId')::uuid
      and mirror.workspace_id=p_target_workspace_id and mirror.customer_id=(r.payload->>'targetCustomerId')::uuid
      and mirror.appointment_type='installation'), '[]'::jsonb);
end;
$$;

create or replace function public.set_shared_maintenance_opt_out(p_grant_id uuid,p_installation_id uuid,p_opt_out boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  g public.shared_maintenance_grants%rowtype;
  handoff public.shared_maintenance_handoffs%rowtype;
  saved_opt_out boolean;
  saved_at timestamptz;
begin
  if p_opt_out is null then
    raise exception 'A karbantartási jelölés értéke hiányzik.' using errcode='22023';
  end if;
  -- Same grant/source lock order as acceptance: serialize revocation, source
  -- opt-out and the transition from a contact-only row to an owned mirror.
  select * into g from public.shared_maintenance_grants where id=p_grant_id for update;
  if not found or g.revoked_at is not null or g.target_user_id is distinct from auth.uid()
    or not public.shared_maintenance_member(g.target_workspace_id,auth.uid(),false) then
    raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501';
  end if;
  perform 1 from public.appointments where id=p_installation_id and workspace_id=g.source_workspace_id for update;
  perform 1 from public.shared_maintenance_installation_rows(g.target_workspace_id)
    where grant_id=g.id and installation_id=p_installation_id;
  if not found then
    raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501';
  end if;

  select * into handoff from public.shared_maintenance_handoffs
    where source_workspace_id=g.source_workspace_id and source_installation_id=p_installation_id
      and target_workspace_id=g.target_workspace_id for update;
  if handoff.target_installation_id is not null then
    -- An acceptance may have completed after the client loaded the shared row.
    -- Its owned mirror is authoritative, including any later ordinary edits.
    select coalesce(a.maintenance_opt_out,false),a.maintenance_opt_out_at into saved_opt_out,saved_at
      from public.appointments a join public.customers c on c.id=a.customer_id and c.workspace_id=a.workspace_id
      where a.id=handoff.target_installation_id and a.workspace_id=g.target_workspace_id
        and a.customer_id=handoff.target_customer_id and a.appointment_type='installation' for update of a;
    if not found then
      raise exception 'Az átvett telepítés hivatkozása megváltozott. Ellenőrzés szükséges.' using errcode='23514';
    end if;
    saved_at := case when p_opt_out then case when saved_opt_out then coalesce(saved_at,now()) else now() end else null end;
    update public.appointments set maintenance_opt_out=p_opt_out,maintenance_opt_out_at=saved_at
      where id=handoff.target_installation_id and workspace_id=g.target_workspace_id;
  else
    select preference.maintenance_opt_out,preference.maintenance_opt_out_at into saved_opt_out,saved_at
      from public.shared_maintenance_preferences preference
      where preference.source_workspace_id=g.source_workspace_id and preference.source_installation_id=p_installation_id
        and preference.target_workspace_id=g.target_workspace_id;
    saved_at := case when p_opt_out then case when saved_opt_out then coalesce(saved_at,now()) else now() end else null end;
  end if;

  insert into public.shared_maintenance_preferences(source_workspace_id,source_installation_id,target_workspace_id,
    grant_id,maintenance_opt_out,maintenance_opt_out_at,updated_at,updated_by)
    values(g.source_workspace_id,p_installation_id,g.target_workspace_id,g.id,p_opt_out,saved_at,now(),auth.uid())
    on conflict(source_workspace_id,source_installation_id,target_workspace_id) do update set
      grant_id=excluded.grant_id,maintenance_opt_out=excluded.maintenance_opt_out,
      maintenance_opt_out_at=excluded.maintenance_opt_out_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  return jsonb_build_object('maintenanceOptOut',p_opt_out,'maintenanceOptOutAt',saved_at,
    'targetInstallationId',handoff.target_installation_id);
end;
$$;

-- Acceptance registers provenance before inserting its reference installation.
-- Copy only that new mirror's prior preference, without rewriting the existing
-- acceptance function or changing any already accepted installation on install.
create or replace function public.copy_shared_maintenance_opt_out()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare preference record;
begin
  if tg_table_schema<>'public' or tg_table_name<>'appointments' or tg_op<>'INSERT' then
    raise exception 'Érvénytelen karbantartási művelet.' using errcode='42501';
  end if;
  if new.appointment_type<>'installation' or new.maintenance_origin<>'external' then return new; end if;
  select p.maintenance_opt_out,p.maintenance_opt_out_at into preference
    from public.shared_maintenance_handoffs h
    join public.shared_maintenance_preferences p on p.source_workspace_id=h.source_workspace_id
      and p.source_installation_id=h.source_installation_id and p.target_workspace_id=h.target_workspace_id
    where h.target_installation_id=new.id and h.target_workspace_id=new.workspace_id and h.target_customer_id=new.customer_id;
  if found then
    new.maintenance_opt_out := preference.maintenance_opt_out;
    new.maintenance_opt_out_at := preference.maintenance_opt_out_at;
  end if;
  return new;
end;
$$;

drop trigger if exists shared_maintenance_opt_out_copy on public.appointments;
create trigger shared_maintenance_opt_out_copy before insert on public.appointments
  for each row execute function public.copy_shared_maintenance_opt_out();

revoke all on function public.copy_shared_maintenance_opt_out() from public,anon,authenticated,service_role;
revoke all on function public.set_shared_maintenance_opt_out(uuid,uuid,boolean),
  public.list_received_maintenance_installations(uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_shared_maintenance_opt_out(uuid,uuid,boolean),
  public.list_received_maintenance_installations(uuid) to authenticated;
commit;
