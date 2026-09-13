-- AlinFlow: egy mentett munkafotó ellenőrzött törlése.
-- Új telepítés sorrendje: WORK_PHOTOS.sql, majd WORK_PHOTO_DELETION.sql.
-- Meglévő fotótárnál csak ezt az utólagos migrációt futtasd, előzetes mentés
-- és olvasási sémaaudit után. Az előző migráció szándékosan nem írja felül
-- az itt bevezetett új törlési szabályt. Ez a migráció ismételten futtatható.
--
-- A kliens először Storage API remove hívással törli az egyetlen fájlt,
-- majd finish_work_photo_delete segítségével távolítja el a metaadatot.
-- A függvény a fizikai storage.objects sort az RLS-től függetlenül ellenőrzi:
-- egy jogosultság miatt láthatatlan fájl nem minősül töröltnek.
-- Hiba esetén a megmaradt metaadat alapján ugyanaz a törlés újrapróbálható.
-- A migráció nem töröl fájlt vagy alkalmazásadatot.
-- storage.objects sorait éles rendszerben SOHA ne töröld közvetlen SQL-lel.

begin;

do $deletion_prerequisites$
begin
  if to_regclass('public.work_photos') is null
     or to_regclass('public.workspace_members') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception 'Munkafotó-törlés: előbb a WORK_PHOTOS.sql migráció és olvasási audit szükséges.';
  end if;
  if not exists (select 1 from pg_class
    where oid = 'public.work_photos'::regclass and relrowsecurity)
    or not exists (select 1 from pg_class
      where oid = 'storage.objects'::regclass and relrowsecurity) then
    raise exception 'Munkafotó-törlés: a metaadatok és a Storage RLS védelme legyen bekapcsolva.';
  end if;
  if not exists (select 1 from storage.buckets
    where id = 'work-photos' and public is false) then
    raise exception 'Munkafotó-törlés: a privát work-photos bucket nem található.';
  end if;
end;
$deletion_prerequisites$;

do $upgrade_cleanup_guard$
declare
  old_definition constant text := $policy$
        as restrictive for delete to authenticated using (
          bucket_id <> 'work-photos' or (
            owner_id = (select auth.uid()::text)
            and exists (
              select 1 from public.workspace_members wm
              where wm.workspace_id::text = split_part(objects.name, '/', 1)
                and wm.user_id = (select auth.uid()) and wm.active
            )
            and not exists (
              select 1 from public.work_photos p where p.storage_path = objects.name
            )
          )
        )
      $policy$;
  new_definition constant text := $policy$
        as restrictive for delete to authenticated using (
          bucket_id <> 'work-photos' or (
            (select auth.uid()) is not null
            and exists (
              select 1 from public.workspace_members wm
              where wm.workspace_id::text = split_part(objects.name, '/', 1)
                and wm.user_id = (select auth.uid()) and wm.active
            )
            and (
              exists (
                select 1 from public.work_photos p
                where p.storage_path = objects.name
                  and p.workspace_id::text = split_part(objects.name, '/', 1)
                  and p.customer_id::text = split_part(objects.name, '/', 2)
                  and p.appointment_id::text = split_part(objects.name, '/', 3)
                  and p.id::text || '.jpg' = split_part(objects.name, '/', 4)
              )
              or (
                owner_id = (select auth.uid()::text)
                and not exists (
                  select 1 from public.work_photos p where p.storage_path = objects.name
                )
              )
            )
          )
        )
      $policy$;
  policy_oid oid;
  policy_fingerprint text;
  existing_comment text;
  expected_old text;
  expected_new text;
begin
  select p.oid, md5(concat_ws('|', p.polcmd, p.polpermissive, p.polroles::text,
    pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)))
  into policy_oid, policy_fingerprint
  from pg_policy p
  where p.polrelid = 'storage.objects'::regclass
    and p.polname = 'AlinFlow work photos storage cleanup guard';
  if policy_oid is null then
    raise exception 'Munkafotó-törlés: hiányzik az ismert Storage törlési védelem. Audit szükséges.';
  end if;
  existing_comment := obj_description(policy_oid, 'pg_policy');
  expected_old := 'AlinFlow scoped work photos v1|'
    || md5(regexp_replace(old_definition, '\s+', ' ', 'g')) || '|' || policy_fingerprint;
  expected_new := 'AlinFlow scoped work photo deletion v1|'
    || md5(regexp_replace(new_definition, '\s+', ' ', 'g')) || '|' || policy_fingerprint;
  if existing_comment is distinct from expected_old and existing_comment is distinct from expected_new then
    raise exception 'Munkafotó-törlés: eltérő vagy ismeretlen Storage törlési policy. Nem írtuk felül; audit szükséges.';
  end if;

  if existing_comment = expected_old then
    drop policy "AlinFlow work photos storage cleanup guard" on storage.objects;
    execute 'create policy "AlinFlow work photos storage cleanup guard" on storage.objects ' || new_definition;
    select p.oid, md5(concat_ws('|', p.polcmd, p.polpermissive, p.polroles::text,
      pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)))
    into policy_oid, policy_fingerprint
    from pg_policy p
    where p.polrelid = 'storage.objects'::regclass
      and p.polname = 'AlinFlow work photos storage cleanup guard';
    expected_new := 'AlinFlow scoped work photo deletion v1|'
      || md5(regexp_replace(new_definition, '\s+', ' ', 'g')) || '|' || policy_fingerprint;
    execute format('comment on policy "AlinFlow work photos storage cleanup guard" on storage.objects is %L', expected_new);
  end if;
end;
$upgrade_cleanup_guard$;

do $finish_rpc_collision$
declare
  existing_oid oid := to_regprocedure('public.finish_work_photo_delete(uuid,uuid,uuid,uuid)');
begin
  if existing_oid is not null and obj_description(existing_oid, 'pg_proc')
    is distinct from 'AlinFlow scoped work photo deletion finish v1|' || md5(pg_get_functiondef(existing_oid)) then
    raise exception 'Munkafotó-törlés: eltérő vagy ismeretlen befejező függvény. Nem írtuk felül; audit szükséges.';
  end if;
end;
$finish_rpc_collision$;

-- Nincs általános kliensoldali DELETE grant. A szűk definer-függvény csak
-- aktív tagsággal, pontos munkahatókörben, már hiányzó fájl metaadatát törli.
-- row_security=off: ha a függvény tulajdonosa nem képes a teljes Storage-sort
-- olvasni, a művelet hibázik ahelyett, hogy láthatatlan fájlt hiányzónak vélne.
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
    or not exists (select 1 from public.workspace_members wm
      where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid() and wm.active) then
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

revoke all on function public.finish_work_photo_delete(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.finish_work_photo_delete(uuid,uuid,uuid,uuid) to authenticated;
revoke delete on public.work_photos from public, anon, authenticated;

do $finish_rpc_comment$
begin
  execute format('comment on function public.finish_work_photo_delete(uuid,uuid,uuid,uuid) is %L',
    'AlinFlow scoped work photo deletion finish v1|'
      || md5(pg_get_functiondef('public.finish_work_photo_delete(uuid,uuid,uuid,uuid)'::regprocedure)));
end;
$finish_rpc_comment$;

commit;

-- Ellenőrzés: a fájl másodszor is sikeres; anon/inaktív tag/más munka tiltott;
-- létező storage.objects sorral a finish RPC tiltott; csak Storage API remove
-- után törlődik az egyetlen metaadat. Elveszett válasz után ismételhető.
