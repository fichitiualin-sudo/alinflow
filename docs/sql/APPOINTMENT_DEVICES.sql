-- AlinFlow: készülékenkénti sorozatszámok, privát adattábla-fotók és H tarifa.
-- Előfeltétel: WORK_PHOTOS.sql, WORK_PHOTO_DELETION.sql; friss mentés és sémaaudit.
-- Additív, tranzakciós, ismételhető. Meglévő dokumentumot/időpontot/fájlt nem módosít.
-- Új telepítésnél is a fenti sorrendet használd; az alap fotómigrációt a bővítés
-- után ne futtasd újra, mert az szándékosan ellenőrzi a saját korábbi sémáját.
begin;

create or replace function pg_temp.alinflow_device_fingerprint(p_table regclass)
returns text language sql as $$
  select md5(coalesce(string_agg(entry, E'\n' order by entry), '')) from (
    select concat_ws('|', a.attnum, a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,
      pg_get_expr(d.adbin,d.adrelid)) as entry
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=p_table and a.attnum>0 and not a.attisdropped
    union all select concat_ws('|',c.conname,pg_get_constraintdef(c.oid),c.convalidated)
    from pg_constraint c where c.conrelid=p_table
  ) fields
$$;

do $tables$
declare
  spec record;
  rel regclass;
  existed boolean;
  marker text;
begin
  if to_regclass('public.work_photos') is null
    or to_regprocedure('public.finish_work_photo_delete(uuid,uuid,uuid,uuid)') is null then
    raise exception 'Előbb a munkafotók és a fotótörlés migrációja szükséges.';
  end if;
  for spec in select * from (values
    ('appointment_devices', $ddl$
      create table public.appointment_devices (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null references public.workspaces(id) on delete restrict,
        customer_id uuid not null references public.customers(id) on delete cascade,
        appointment_id uuid not null references public.appointments(id) on delete cascade,
        product_key text not null check (length(product_key) between 1 and 250),
        product_name text not null check (length(trim(product_name)) between 1 and 500),
        unit_number integer not null check (unit_number between 1 and 1000),
        data jsonb not null default '{}'::jsonb check (jsonb_typeof(data)='object' and octet_length(data::text)<=32768),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (appointment_id,product_key,unit_number),
        unique (id,workspace_id,customer_id,appointment_id)
      )
    $ddl$),
    ('h_tariff_requests', $ddl$
      create table public.h_tariff_requests (
        appointment_id uuid primary key references public.appointments(id) on delete cascade,
        workspace_id uuid not null references public.workspaces(id) on delete restrict,
        customer_id uuid not null references public.customers(id) on delete cascade,
        data jsonb not null default '{}'::jsonb check (jsonb_typeof(data)='object' and octet_length(data::text)<=32768),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    $ddl$)
  ) as specs(name,ddl) loop
    rel := to_regclass('public.' || spec.name);
    existed := rel is not null;
    if not existed then execute spec.ddl; rel := to_regclass('public.' || spec.name); end if;
    marker := 'AlinFlow installation devices v1|' || md5(regexp_replace(spec.ddl,'\s+',' ','g'))
      || '|' || pg_temp.alinflow_device_fingerprint(rel);
    if existed and obj_description(rel,'pg_class') is distinct from marker then
      raise exception 'Eltérő vagy ismeretlen % tábla. Audit szükséges; nem írtunk felül adatot.',spec.name;
    end if;
    if not existed then execute format('comment on table public.%I is %L',spec.name,marker); end if;
  end loop;
end;
$tables$;

do $scope_function_guard$
declare rel oid := to_regprocedure('public.enforce_installation_device_scope()');
begin
  if rel is not null and obj_description(rel,'pg_proc') is distinct from
    'AlinFlow installation device scope v1|' || md5(pg_get_functiondef(rel)) then
    raise exception 'Ismeretlen készülék-hatókörfüggvény. Audit szükséges.';
  end if;
end;
$scope_function_guard$;

create or replace function public.enforce_installation_device_scope()
returns trigger language plpgsql set search_path = '' as $scope$
begin
  if tg_op='UPDATE' then
    if (new.workspace_id,new.customer_id,new.appointment_id,new.created_at)
      is distinct from (old.workspace_id,old.customer_id,old.appointment_id,old.created_at) then
      raise exception 'A mentett készülék vagy H tarifa nem helyezhető át másik munkára.' using errcode='42501';
    end if;
    if tg_table_name='appointment_devices' then
      if (new.id,new.product_key,new.unit_number) is distinct from (old.id,old.product_key,old.unit_number) then
        raise exception 'A készülék azonosítója nem módosítható.' using errcode='42501';
      end if;
    end if;
  end if;
  if auth.uid() is null or not exists (
    select 1 from public.appointments a join public.customers c on c.id=a.customer_id
    join public.workspace_members wm on wm.workspace_id=a.workspace_id
    where a.id=new.appointment_id and a.customer_id=new.customer_id
      and a.workspace_id=new.workspace_id and c.workspace_id=new.workspace_id
      and a.appointment_type='installation' and wm.user_id=auth.uid() and wm.active
  ) then
    raise exception 'A készülék és a H tarifa csak a saját munkaterület pontos telepítéséhez menthető.' using errcode='42501';
  end if;
  if tg_op='INSERT' then new.created_at := clock_timestamp(); end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$scope$;
revoke all on function public.enforce_installation_device_scope() from public,anon,authenticated;
do $scope_comment$ begin
  execute format('comment on function public.enforce_installation_device_scope() is %L',
    'AlinFlow installation device scope v1|' || md5(pg_get_functiondef('public.enforce_installation_device_scope()'::regprocedure)));
end; $scope_comment$;

do $policies$
declare tbl text; spec record; rel regclass; pol oid; fingerprint text; marker text; trig oid; existed boolean;
begin
  foreach tbl in array array['appointment_devices','h_tariff_requests'] loop
    rel := to_regclass('public.'||tbl);
    execute format('alter table public.%I enable row level security',tbl);
    execute format('revoke all on public.%I from public,anon,authenticated',tbl);
    execute format('grant select,insert,update on public.%I to authenticated',tbl);
    if exists(select 1 from pg_policy where polrelid=rel and polname not in ('device_read','device_insert','device_update')) then
      raise exception 'Ismeretlen % policy. Audit szükséges.',tbl;
    end if;
    for spec in select * from (values
      ('device_read','for select to authenticated using (exists(select 1 from public.workspace_members wm where wm.workspace_id=%1$I.workspace_id and wm.user_id=(select auth.uid()) and wm.active))'),
      ('device_insert','for insert to authenticated with check (exists(select 1 from public.workspace_members wm where wm.workspace_id=%1$I.workspace_id and wm.user_id=(select auth.uid()) and wm.active))'),
      ('device_update','for update to authenticated using (exists(select 1 from public.workspace_members wm where wm.workspace_id=%1$I.workspace_id and wm.user_id=(select auth.uid()) and wm.active)) with check (exists(select 1 from public.workspace_members wm where wm.workspace_id=%1$I.workspace_id and wm.user_id=(select auth.uid()) and wm.active))')
    ) as specs(name,definition) loop
      select oid into pol from pg_policy where polrelid=rel and polname=spec.name;
      existed := pol is not null;
      if pol is null then execute format('create policy %I on public.%I %s',spec.name,tbl,format(spec.definition,tbl)); end if;
      select oid, md5(concat_ws('|',polcmd,polpermissive,polroles::text,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)))
        into pol,fingerprint from pg_policy where polrelid=rel and polname=spec.name;
      marker := 'AlinFlow installation devices policy v1|' || md5(spec.definition) || '|' || fingerprint;
      if existed and obj_description(pol,'pg_policy') is distinct from marker then
        raise exception 'Eltérő % policy. Audit szükséges.',tbl;
      end if;
      execute format('comment on policy %I on public.%I is %L',spec.name,tbl,marker);
    end loop;
    select oid into trig from pg_trigger where tgrelid=rel and tgname='installation_device_scope';
    if trig is not null and (obj_description(trig,'pg_trigger') is distinct from
      'AlinFlow installation devices trigger v1|' || md5(pg_get_triggerdef(trig))
      or (select tgenabled from pg_trigger where oid=trig) <> 'O') then
      raise exception 'Eltérő készülék-trigger. Audit szükséges.';
    end if;
    if trig is null then
      execute format('create trigger installation_device_scope before insert or update on public.%I for each row execute function public.enforce_installation_device_scope()',tbl);
      select oid into trig from pg_trigger where tgrelid=rel and tgname='installation_device_scope';
      execute format('comment on trigger installation_device_scope on public.%I is %L',tbl,'AlinFlow installation devices trigger v1|'||md5(pg_get_triggerdef(trig)));
    end if;
  end loop;
end;
$policies$;

do $photo_extension$
declare marker text := obj_description('public.work_photos'::regclass,'pg_class');
  fingerprint text := pg_temp.alinflow_device_fingerprint('public.work_photos'::regclass);
begin
  if marker like 'AlinFlow scoped work photos v1|%' and split_part(marker,'|',3)=fingerprint then
    alter table public.work_photos add column device_id uuid, add column device_side text;
    alter table public.work_photos add constraint work_photos_device_side_check check (
      (device_id is null and device_side is null)
      or (device_id is not null and device_side is not null and device_side in ('indoor','outdoor') and appointment_type='installation')
    );
    alter table public.work_photos add constraint work_photos_device_scope_fk
      foreign key (device_id,workspace_id,customer_id,appointment_id)
      references public.appointment_devices(id,workspace_id,customer_id,appointment_id) on delete restrict;
    execute format('comment on table public.work_photos is %L',
      'AlinFlow scoped device photos v2|' || pg_temp.alinflow_device_fingerprint('public.work_photos'::regclass));
  elsif marker is distinct from 'AlinFlow scoped device photos v2|' || fingerprint then
    raise exception 'Ismeretlen munkafotó-séma. Nem módosítottuk; audit szükséges.';
  end if;
end;
$photo_extension$;

create index if not exists appointment_devices_work_idx on public.appointment_devices(workspace_id,customer_id,appointment_id);
create index if not exists h_tariff_requests_work_idx on public.h_tariff_requests(workspace_id,customer_id,appointment_id);
create index if not exists work_photos_device_idx on public.work_photos(device_id,device_side) where device_id is not null;
commit;
