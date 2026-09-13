-- AlinFlow: opcionális munkafotók a meglévő munkaterülethez és időponthoz.
-- Ezt a fájlt az alkalmazás NEM futtatja automatikusan.
--
-- Futtatás előtt:
--   1. Készíts teljes kód- és adatbázismentést.
--   2. Futtasd újra a SUPABASE_SCHEMA_AUDIT_READONLY.sql auditot.
--   3. Ellenőrizd a storage.objects RLS policy-kat, a Storage owner_id
--      oszlopot és az esetleg már létező work-photos bucket beállításait.
--   4. A Supabase SQL Editorban, migrációs jogosultsággal futtasd.
--
-- Nem módosít ügyfelet, időpontot, munkalapot, dokumentumot vagy aláírást.
-- A dátum és típus a feltöltéskori munka pillanatképe; átütemezéskor marad.
-- Az appointment_id állandó; azonos ügyfél külön munkái nem keverednek.
-- A customer_id FK szándékosan RESTRICT: fotóval rendelkező ügyfél törlése
-- nem hagyhat észrevétlenül elárvult fájlt. Nincs kliensoldali metaadattörlés.
--
-- Feltöltési sorrend: új UUID -> tömörített JPEG Storage upload, upsert:false
-- -> ugyanahhoz az UUID-hoz metaadat INSERT. Bizonytalan INSERT-hiba után
-- előbb ugyanazon id SELECT-je szükséges. Csak biztosan hiányzó metaadatnál
-- szabad a feltöltő saját objektumát Storage API-val eltávolítani.
-- Bizonytalan eredménynél ugyanaz az id/útvonal használható újrapróbálásra.
-- A saját, még metaadat nélküli objektum olvasható az ellenőrzéshez.
-- storage.objects sorait soha ne töröld közvetlen SQL-lel.
-- Útvonal: <workspace UUID>/<customer UUID>/<appointment UUID>/<photo UUID>.jpg
--
-- A verziózott ellenőrző megjegyzések miatt az ismételt futtatás biztonságos.
-- Eltérő meglévő táblát/policy-t/beállítást nem írunk felül: a teljes
-- tranzakció hibával visszagördül, majd célzott audit szükséges.

begin;

do $prerequisites$
begin
  if to_regclass('public.customers') is null
     or to_regclass('public.workspaces') is null
     or to_regclass('public.workspace_members') is null
     or to_regclass('public.appointments') is null
     or to_regclass('public.purchase_declarations') is null
     or to_regclass('public.maintenance_appointment_items') is null
     or to_regclass('public.documents') is null
     or to_regclass('public.work_checklists') is null
     or to_regclass('public.work_reports') is null
     or to_regclass('public.jobs') is null
     or to_regclass('public.quotes') is null
     or to_regclass('public.quote_items') is null
     or to_regclass('auth.users') is null
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('auth.uid()') is null
     or to_regprocedure('gen_random_uuid()') is null then
    raise exception 'Munkafotók: hiányzó Supabase/ügyfél-séma. Előbb futtasd az olvasási auditot.';
  end if;

  if not exists (
    select 1 from pg_roles where rolname = 'authenticated'
  ) or not exists (
    select 1 from pg_roles where rolname = 'anon'
  ) then
    raise exception 'Munkafotók: hiányzó Supabase authenticated/anon szerepkör.';
  end if;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.customers'::regclass
      and attname = 'id' and atttypid = 'uuid'::regtype and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'storage.objects'::regclass
      and attname = 'owner_id' and atttypid = 'text'::regtype and not attisdropped
  ) then
    raise exception 'Munkafotók: customers.id uuid és storage.objects.owner_id text szükséges.';
  end if;

  if exists (
    select 1 from pg_class
    where oid in ('public.customers'::regclass, 'public.appointments'::regclass,
      'public.workspace_members'::regclass, 'storage.objects'::regclass)
      and not relrowsecurity
  ) then
    raise exception 'Munkafotók: az ügyfelek, időpontok, tagságok és Storage RLS védelme legyen bekapcsolva.';
  end if;
end;
$prerequisites$;

do $photo_table$
declare
  table_ddl constant text := $ddl$
    create table public.work_photos (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete restrict,
      customer_id uuid not null references public.customers(id) on delete restrict,
      appointment_id uuid not null references public.appointments(id) on delete restrict,
      appointment_type text not null check (appointment_type in ('installation', 'maintenance', 'survey')),
      work_date date not null,
      work_time text not null default '',
      storage_path text not null unique,
      size_bytes integer not null check (size_bytes between 1 and 500000),
      width integer not null check (width between 1 and 1920),
      height integer not null check (height between 1 and 1920),
      created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
      created_at timestamptz not null default now(),
      constraint work_photos_storage_path_check
        check (storage_path = workspace_id::text || '/' || customer_id::text || '/' || appointment_id::text || '/' || id::text || '.jpg')
    )
  $ddl$;
  existed boolean := to_regclass('public.work_photos') is not null;
  schema_fingerprint text;
  expected_comment text;
begin
  if not existed then
    execute table_ddl;
  end if;

  -- A mezők, alapértékek és constraint-ek megváltozását is észleljük.
  select md5(coalesce(string_agg(entry, E'\n' order by entry), ''))
  into schema_fingerprint
  from (
    select concat_ws('|', a.attnum, a.attname,
      format_type(a.atttypid, a.atttypmod), a.attnotnull,
      pg_get_expr(d.adbin, d.adrelid)) as entry
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.work_photos'::regclass
      and a.attnum > 0 and not a.attisdropped
    union all
    select concat_ws('|', c.conname, pg_get_constraintdef(c.oid), c.convalidated)
    from pg_constraint c
    where c.conrelid = 'public.work_photos'::regclass
  ) schema_entries;

  expected_comment := 'AlinFlow scoped work photos v1|' || md5(regexp_replace(table_ddl, '\s+', ' ', 'g')) || '|' || schema_fingerprint;
  if existed and obj_description('public.work_photos'::regclass, 'pg_class')
      is distinct from expected_comment then
    raise exception 'Munkafotók: eltérő vagy ismeretlen public.work_photos tábla. Audit szükséges; nem írtunk felül adatot.';
  end if;

  if not existed then
    execute format('comment on table public.work_photos is %L', expected_comment);
  end if;
end;
$photo_table$;

create index if not exists work_photos_work_created_idx
  on public.work_photos (workspace_id, customer_id, appointment_id, created_at desc, id);

alter table public.work_photos enable row level security;
revoke all on public.work_photos from public, anon, authenticated;
grant select, insert on public.work_photos to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-photos', 'work-photos', false, 500000, array['image/jpeg']::text[])
on conflict (id) do nothing;

do $bucket_check$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'work-photos' and name = 'work-photos'
      and public is false and file_size_limit = 500000
      and allowed_mime_types = array['image/jpeg']::text[]
  ) then
    raise exception 'Munkafotók: a létező work-photos bucket eltérő beállítású. Privát, 500000 bájt, kizárólag image/jpeg szükséges; a migráció nem módosítja automatikusan.';
  end if;
end;
$bucket_check$;

do $photo_policies$
declare
  policy_spec record;
  policy_oid oid;
  policy_fingerprint text;
  expected_comment text;
  existed boolean;
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'work_photos'
      and policyname not in ('AlinFlow work photos read', 'AlinFlow work photos insert')
  ) then
    raise exception 'Munkafotók: ismeretlen work_photos RLS policy. Audit szükséges.';
  end if;

  -- A Storage engedélyező policy-k mellett korlátozó policy-k is készülnek.
  -- Így egy korábbi permissive ALL/true policy sem nyitja meg ezt a bucketet.
  -- A többi bucket meglévő hozzáférését a korlátozások nem változtatják meg.
  for policy_spec in
    select * from (values
      ('public', 'work_photos', 'AlinFlow work photos read', $policy$
        for select to authenticated using (
          exists (select 1 from public.workspace_members wm
            where wm.workspace_id = work_photos.workspace_id and wm.user_id = (select auth.uid()) and wm.active)
        )
      $policy$),
      ('public', 'work_photos', 'AlinFlow work photos insert', $policy$
        for insert to authenticated with check (
          created_by = (select auth.uid())
          and exists (select 1 from public.workspace_members wm
            where wm.workspace_id = work_photos.workspace_id and wm.user_id = (select auth.uid()) and wm.active)
          and exists (select 1 from public.appointments a join public.customers c on c.id = a.customer_id
            where a.id = work_photos.appointment_id and a.customer_id = work_photos.customer_id
              and a.workspace_id = work_photos.workspace_id and c.workspace_id = work_photos.workspace_id
              and a.appointment_type = work_photos.appointment_type)
        )
      $policy$),
      ('storage', 'objects', 'AlinFlow work photos storage read', $policy$
        for select to authenticated using (bucket_id = 'work-photos')
      $policy$),
      ('storage', 'objects', 'AlinFlow work photos storage insert', $policy$
        for insert to authenticated with check (bucket_id = 'work-photos')
      $policy$),
      ('storage', 'objects', 'AlinFlow work photos storage cleanup', $policy$
        for delete to authenticated using (bucket_id = 'work-photos')
      $policy$),
      ('storage', 'objects', 'AlinFlow work photos storage read guard', $policy$
        as restrictive for select to authenticated using (
          bucket_id <> 'work-photos' or (
            (select auth.uid()) is not null
            and exists (
              select 1 from public.workspace_members wm
              where wm.workspace_id::text = split_part(objects.name, '/', 1)
                and wm.user_id = (select auth.uid()) and wm.active
            )
            and (
              owner_id = (select auth.uid()::text)
              or exists (
                select 1 from public.work_photos p where p.storage_path = objects.name
              )
            )
          )
        )
      $policy$),
      ('storage', 'objects', 'AlinFlow work photos storage insert guard', $policy$
        as restrictive for insert to authenticated with check (
          bucket_id <> 'work-photos' or (
            owner_id = (select auth.uid()::text)
            and name ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){3}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
            and exists (
              select 1 from public.appointments a
              join public.customers c on c.id = a.customer_id and c.workspace_id = a.workspace_id
              join public.workspace_members wm on wm.workspace_id = a.workspace_id
              where a.workspace_id::text = split_part(objects.name, '/', 1)
                and a.customer_id::text = split_part(objects.name, '/', 2)
                and a.id::text = split_part(objects.name, '/', 3)
                and wm.user_id = (select auth.uid()) and wm.active
            )
          )
        )
      $policy$),
      ('storage', 'objects', 'AlinFlow work photos storage update guard', $policy$
        as restrictive for update to authenticated
          using (bucket_id <> 'work-photos')
          with check (bucket_id <> 'work-photos')
      $policy$),
      ('storage', 'objects', 'AlinFlow work photos storage cleanup guard', $policy$
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
      $policy$),
      ('storage', 'objects', 'AlinFlow work photos anon read guard', $policy$
        as restrictive for select to anon using (bucket_id <> 'work-photos')
      $policy$),
      ('storage', 'objects', 'AlinFlow work photos anon insert guard', $policy$
        as restrictive for insert to anon with check (bucket_id <> 'work-photos')
      $policy$),
      ('storage', 'objects', 'AlinFlow work photos anon update guard', $policy$
        as restrictive for update to anon
          using (bucket_id <> 'work-photos') with check (bucket_id <> 'work-photos')
      $policy$),
      ('storage', 'objects', 'AlinFlow work photos anon cleanup guard', $policy$
        as restrictive for delete to anon using (bucket_id <> 'work-photos')
      $policy$)
    ) as policies(schema_name, table_name, policy_name, definition)
  loop
    select exists (
      select 1 from pg_policies
      where schemaname = policy_spec.schema_name
        and tablename = policy_spec.table_name
        and policyname = policy_spec.policy_name
    ) into existed;

    if not existed then
      execute format('create policy %I on %I.%I %s',
        policy_spec.policy_name, policy_spec.schema_name,
        policy_spec.table_name, policy_spec.definition);
    end if;

    select p.oid, md5(concat_ws('|', p.polcmd, p.polpermissive, p.polroles::text,
      pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)))
    into policy_oid, policy_fingerprint
    from pg_policy p
    where p.polrelid = to_regclass(format('%I.%I', policy_spec.schema_name, policy_spec.table_name))
      and p.polname = policy_spec.policy_name;

    expected_comment := 'AlinFlow scoped work photos v1|' || md5(regexp_replace(policy_spec.definition, '\s+', ' ', 'g')) || '|' || policy_fingerprint;
    if existed and obj_description(policy_oid, 'pg_policy') is distinct from expected_comment then
      raise exception 'Munkafotók: eltérő/ismeretlen policy: %.%. Nem írtuk felül; audit szükséges.',
        policy_spec.schema_name, policy_spec.policy_name;
    end if;

    if not existed then
      execute format('comment on policy %I on %I.%I is %L',
        policy_spec.policy_name, policy_spec.schema_name,
        policy_spec.table_name, expected_comment);
    end if;
  end loop;
end;
$photo_policies$;

-- A teljes ügyféltörlés egyetlen tranzakció, és először az ügyfelet zárolja.
-- A work_photos FK beszúrás KEY SHARE zárolása ütközik ezzel a FOR UPDATE
-- zárolással: egy párhuzamos fotómentés nem csúszhat az ellenőrzés és törlés
-- közé. A már mentett fotó blokkolja az egész törlést; törölt ügyfélhez egy
-- később folytatódó fotómetaadat-INSERT FK-hibát kap, és a feltöltés takarítható.
-- Bármely gyerekrekord törlési hibája minden korábbi törlést visszagördít.
-- SECURITY INVOKER: minden művelet a hívó meglévő grantjeit és RLS-ét használja.
do $delete_rpc_collision$
begin
  if to_regprocedure('public.delete_customer_preserving_photos(uuid)') is not null then
    raise exception 'Munkafotók: régi, munkaterület nélküli ügyféltörlő függvény van jelen. Audit szükséges.';
  end if;
  if to_regprocedure('public.delete_customer_preserving_photos(uuid,uuid)') is not null
    and obj_description(to_regprocedure('public.delete_customer_preserving_photos(uuid,uuid)'), 'pg_proc')
      is distinct from 'AlinFlow scoped work photos: atomic customer deletion v1' then
    raise exception 'Munkafotók: ismeretlen delete_customer_preserving_photos(uuid,uuid) függvény. Audit szükséges; nem írtuk felül.';
  end if;
end;
$delete_rpc_collision$;

create or replace function public.delete_customer_preserving_photos(p_customer_id uuid, p_workspace_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $delete_customer$
begin
  if not exists (select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid() and wm.active) then
    raise exception 'Nincs jogosultság ehhez a munkaterülethez.' using errcode = '42501';
  end if;
  perform 1 from public.customers c
    where c.id = p_customer_id and c.workspace_id = p_workspace_id for update;
  if not found then
    raise exception 'Az ügyfél nem található vagy nincs jogosultság a törléséhez.';
  end if;

  if exists (select 1 from public.work_photos p where p.customer_id = p_customer_id) then
    raise exception 'Ehhez az ügyfélhez mentett munkafotók tartoznak, ezért nem törölhető.';
  end if;

  delete from public.documents where customer_id = p_customer_id and workspace_id = p_workspace_id;
  delete from public.work_checklists where customer_id = p_customer_id and workspace_id = p_workspace_id;
  delete from public.purchase_declarations where customer_id = p_customer_id and workspace_id = p_workspace_id;
  delete from public.work_reports where customer_id = p_customer_id and workspace_id = p_workspace_id;
  delete from public.maintenance_appointment_items where customer_id = p_customer_id and workspace_id = p_workspace_id;
  delete from public.jobs where customer_id = p_customer_id and workspace_id = p_workspace_id;
  delete from public.quote_items where workspace_id = p_workspace_id and quote_id in (
    select q.id from public.quotes q where q.customer_id = p_customer_id and q.workspace_id = p_workspace_id
  );
  -- Előbb az ajánlatok: az időpont törlése különben a quotes.appointment_id
  -- SET NULL frissítését indítaná, amelyet a meglévő scope trigger tilt.
  delete from public.quotes where customer_id = p_customer_id and workspace_id = p_workspace_id;
  delete from public.appointments where customer_id = p_customer_id and workspace_id = p_workspace_id;
  delete from public.customers where id = p_customer_id and workspace_id = p_workspace_id;
  if not found then
    raise exception 'Az ügyfél nem törölhető a jelenlegi jogosultságokkal.';
  end if;
end;
$delete_customer$;

comment on function public.delete_customer_preserving_photos(uuid,uuid)
  is 'AlinFlow scoped work photos: atomic customer deletion v1';
revoke all on function public.delete_customer_preserving_photos(uuid,uuid) from public, anon, authenticated;
grant execute on function public.delete_customer_preserving_photos(uuid,uuid) to authenticated;

commit;

-- Ellenőrzés futtatás után: ugyanaz a migráció másodszor is hiba nélkül fusson.
-- Tesztelj bejelentkezett és kijelentkezett munkamenettel: privát megtekintés,
-- JPEG/méretkorlát, új fotó, azonos útvonal felülírásának tiltása, más feltöltő
-- objektumának törlési tiltása, és fotós ügyfél törlésének blokkolása.
