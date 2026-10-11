-- Narrow existing RLS; no memberships or business rows are changed.
-- Apply after workspace, photo, photo-deletion and device migrations.
-- Idempotent. Rollback: drop only the new restrictive policies and restore the
-- two replaced functions from their prior migrations; preserve all data.
begin;

create or replace function public.active_workspace_member(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id
    where m.workspace_id=p_workspace_id and m.user_id=auth.uid() and m.active and w.active
  );
$$;
revoke all on function public.active_workspace_member(uuid) from public,anon;
grant execute on function public.active_workspace_member(uuid) to authenticated;

create or replace function public.require_workspace_member(p_workspace_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
  if not public.active_workspace_member(p_workspace_id) then
    raise exception 'Nincs jogosultság ehhez az aktív munkaterülethez.' using errcode='42501';
  end if;
end;
$$;
revoke all on function public.require_workspace_member(uuid) from public,anon;
grant execute on function public.require_workspace_member(uuid) to authenticated;

-- AND with existing authorization. Provisioning tables stay unchanged so an
-- owner can still inspect or reactivate their workspace.
do $active_policies$
declare tbl text;
begin
  foreach tbl in array array['customers','appointments','jobs','quotes','quote_items',
    'documents','work_reports','work_checklists','purchase_declarations','maintenance_appointment_items',
    'seller_companies','climate_products','inventory_stock','material_inventory','workspace_settings',
    'appointment_devices','h_tariff_requests','work_photos']
  loop
    if to_regclass('public.'||tbl) is null then
      raise exception 'Missing table public.%; active workspace migration needs a schema audit.',tbl;
    end if;
    execute format('alter table public.%I enable row level security',tbl);
    execute format('drop policy if exists active_workspace_guard on public.%I',tbl);
    execute format('create policy active_workspace_guard on public.%I as restrictive for all to authenticated using(public.active_workspace_member(workspace_id)) with check(public.active_workspace_member(workspace_id))',tbl);
  end loop;
end;
$active_policies$;

drop policy if exists "AlinFlow active workspace storage guard" on storage.objects;
create policy "AlinFlow active workspace storage guard" on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'work-photos' or exists (
    select 1 from public.workspace_members m
    where m.workspace_id::text=split_part(objects.name,'/',1)
      and m.user_id=auth.uid() and public.active_workspace_member(m.workspace_id)
  ))
  with check (bucket_id <> 'work-photos' or exists (
    select 1 from public.workspace_members m
    where m.workspace_id::text=split_part(objects.name,'/',1)
      and m.user_id=auth.uid() and public.active_workspace_member(m.workspace_id)
  ));

-- The SECURITY DEFINER cleanup RPC also needs this gate; table RLS alone does
-- not constrain it. Its exact work/path checks are preserved below.
create or replace function public.finish_work_photo_delete(
  p_photo_id uuid,
  p_workspace_id uuid,
  p_customer_id uuid,
  p_appointment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $finish_delete$
declare
  photo public.work_photos%rowtype;
  photo_exists boolean;
  expected_path text;
begin
  if auth.uid() is null or p_photo_id is null or p_workspace_id is null
    or p_customer_id is null or p_appointment_id is null
    or not public.active_workspace_member(p_workspace_id) then
    raise exception 'Nincs jogosultság ehhez a munkaterülethez.' using errcode = '42501';
  end if;

  expected_path := p_workspace_id::text || '/' || p_customer_id::text || '/'
    || p_appointment_id::text || '/' || p_photo_id::text || '.jpg';
  select p.* into photo from public.work_photos p where p.id = p_photo_id for update;
  photo_exists := found;
  if photo_exists and (
    photo.workspace_id <> p_workspace_id or photo.customer_id <> p_customer_id
    or photo.appointment_id <> p_appointment_id or photo.storage_path <> expected_path
  ) then
    raise exception 'A kép nem ehhez a munkához tartozik.' using errcode = '42501';
  end if;

  if exists (select 1 from storage.objects o
    where o.bucket_id = 'work-photos' and o.name = expected_path) then
    raise exception 'A képfájl még a tárhelyen van. Próbáld újra a kép törlését.' using errcode = '55000';
  end if;
  if photo_exists then
    delete from public.work_photos p
      where p.id = p_photo_id and p.workspace_id = p_workspace_id
        and p.customer_id = p_customer_id and p.appointment_id = p_appointment_id;
  end if;
end;
$finish_delete$;

revoke all on function public.finish_work_photo_delete(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_work_photo_delete(uuid,uuid,uuid,uuid) to authenticated;
comment on function public.finish_work_photo_delete(uuid,uuid,uuid,uuid)
  is 'AlinFlow active workspace photo deletion finish v2';
commit;
