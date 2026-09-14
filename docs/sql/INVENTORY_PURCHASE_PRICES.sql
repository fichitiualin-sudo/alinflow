-- AlinFlow: kizárólag belső használatú beszerzési egységárak.
-- Előfeltétel: munkaterület-izoláció, friss adatmentés és sémaaudit.
-- Additív, tranzakciós, ismételhető. A katalógust, készletet és dokumentumokat nem módosítja.
-- A hiányzó/kiürített ár NULL, a nulla ismert 0 Ft-os ár. Nettó/bruttó jelölés kötelező.
begin;

create or replace function pg_temp.alinflow_purchase_price_fingerprint(p_table regclass)
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

do $table$
declare
  rel regclass := to_regclass('public.inventory_purchase_prices');
  existed boolean := rel is not null;
  marker text;
  ddl text := $ddl$
    create table public.inventory_purchase_prices (
      workspace_id uuid not null references public.workspaces(id) on delete restrict,
      item_type text not null check (item_type in ('climate','material')),
      item_key text not null check (length(trim(item_key))>0),
      purchase_price numeric(12,2) check (purchase_price>=0 and purchase_price<=999999999.99),
      tax_basis text not null check (tax_basis in ('gross','net')),
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      primary key (workspace_id,item_type,item_key)
    )
  $ddl$;
begin
  if to_regclass('public.workspaces') is null or to_regclass('public.workspace_members') is null
    or to_regclass('public.climate_products') is null or to_regclass('public.material_inventory') is null
    or to_regprocedure('auth.uid()') is null then
    raise exception 'Előbb a munkaterület és a raktár alapmigrációi szükségesek.';
  end if;
  if not existed then execute ddl; rel := 'public.inventory_purchase_prices'::regclass; end if;
  marker := 'AlinFlow inventory purchase prices v1|' || md5(regexp_replace(ddl,'\s+',' ','g'))
    || '|' || pg_temp.alinflow_purchase_price_fingerprint(rel);
  if existed and obj_description(rel,'pg_class') is distinct from marker then
    raise exception 'Eltérő vagy ismeretlen inventory_purchase_prices tábla. Audit szükséges; nem írtunk felül adatot.';
  end if;
  if not existed then execute format('comment on table public.inventory_purchase_prices is %L',marker); end if;
end;
$table$;

do $function_guard$
declare rel oid := to_regprocedure('public.enforce_inventory_purchase_price_scope()');
begin
  if rel is not null and obj_description(rel,'pg_proc') is distinct from
    'AlinFlow inventory purchase price scope v1|' || md5(pg_get_functiondef(rel)) then
    raise exception 'Ismeretlen beszerzésiár-hatókörfüggvény. Audit szükséges.';
  end if;
end;
$function_guard$;

create or replace function public.enforce_inventory_purchase_price_scope()
returns trigger language plpgsql security invoker set search_path = '' as $scope$
begin
  if tg_op='UPDATE' and (new.workspace_id,new.item_type,new.item_key,new.created_at)
    is distinct from (old.workspace_id,old.item_type,old.item_key,old.created_at) then
    raise exception 'A beszerzési ár azonosítója és létrehozási ideje nem módosítható.' using errcode='42501';
  end if;
  if auth.uid() is null or not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id=new.workspace_id and wm.user_id=auth.uid() and wm.active
  ) then
    raise exception 'Beszerzési ár csak aktív munkaterület-tagként menthető.' using errcode='42501';
  end if;
  if new.item_type not in ('climate','material') or new.item_type is null then
    raise exception 'Ismeretlen raktári tételtípus.' using errcode='23514';
  end if;
  if (new.item_type='climate' and not exists (
    select 1 from public.climate_products p where p.workspace_id=new.workspace_id and p.id=new.item_key
  )) or (new.item_type='material' and not exists (
    select 1 from public.material_inventory m where m.workspace_id=new.workspace_id and m.name=new.item_key
  )) then
    raise exception 'A beszerzési ár csak a saját munkaterületen létező pontos raktári tételhez menthető.' using errcode='42501';
  end if;
  if tg_op='INSERT' then new.created_at := clock_timestamp(); end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$scope$;
revoke all on function public.enforce_inventory_purchase_price_scope() from public,anon,authenticated;
do $function_comment$ begin
  execute format('comment on function public.enforce_inventory_purchase_price_scope() is %L',
    'AlinFlow inventory purchase price scope v1|' || md5(pg_get_functiondef('public.enforce_inventory_purchase_price_scope()'::regprocedure)));
end; $function_comment$;

do $access$
declare
  rel regclass := 'public.inventory_purchase_prices'::regclass;
  spec record;
  pol oid;
  fingerprint text;
  marker text;
  trig oid;
  existed boolean;
begin
  alter table public.inventory_purchase_prices enable row level security;
  revoke all on public.inventory_purchase_prices from public,anon,authenticated;
  grant select,insert,update on public.inventory_purchase_prices to authenticated;
  if exists(select 1 from pg_policy where polrelid=rel and polname not in ('purchase_price_read','purchase_price_insert','purchase_price_update')) then
    raise exception 'Ismeretlen beszerzésiár-policy. Audit szükséges.';
  end if;
  for spec in select * from (values
    ('purchase_price_read','for select to authenticated using (exists(select 1 from public.workspace_members wm where wm.workspace_id=inventory_purchase_prices.workspace_id and wm.user_id=(select auth.uid()) and wm.active))'),
    ('purchase_price_insert','for insert to authenticated with check (exists(select 1 from public.workspace_members wm where wm.workspace_id=inventory_purchase_prices.workspace_id and wm.user_id=(select auth.uid()) and wm.active))'),
    ('purchase_price_update','for update to authenticated using (exists(select 1 from public.workspace_members wm where wm.workspace_id=inventory_purchase_prices.workspace_id and wm.user_id=(select auth.uid()) and wm.active)) with check (exists(select 1 from public.workspace_members wm where wm.workspace_id=inventory_purchase_prices.workspace_id and wm.user_id=(select auth.uid()) and wm.active))')
  ) as specs(name,definition) loop
    select oid into pol from pg_policy where polrelid=rel and polname=spec.name;
    existed := pol is not null;
    if pol is null then execute format('create policy %I on public.inventory_purchase_prices %s',spec.name,spec.definition); end if;
    select oid, md5(concat_ws('|',polcmd,polpermissive,polroles::text,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)))
      into pol,fingerprint from pg_policy where polrelid=rel and polname=spec.name;
    marker := 'AlinFlow inventory purchase price policy v1|' || md5(spec.definition) || '|' || fingerprint;
    if existed and obj_description(pol,'pg_policy') is distinct from marker then
      raise exception 'Eltérő beszerzésiár-policy. Audit szükséges.';
    end if;
    execute format('comment on policy %I on public.inventory_purchase_prices is %L',spec.name,marker);
  end loop;
  if exists(select 1 from pg_trigger where tgrelid=rel and not tgisinternal and tgname<>'inventory_purchase_price_scope') then
    raise exception 'Ismeretlen beszerzésiár-trigger. Audit szükséges.';
  end if;
  select oid into trig from pg_trigger where tgrelid=rel and tgname='inventory_purchase_price_scope';
  if trig is not null and (obj_description(trig,'pg_trigger') is distinct from
    'AlinFlow inventory purchase price trigger v1|' || md5(pg_get_triggerdef(trig))
    or (select tgenabled from pg_trigger where oid=trig)<>'O') then
    raise exception 'Eltérő beszerzésiár-trigger. Audit szükséges.';
  end if;
  if trig is null then
    create trigger inventory_purchase_price_scope before insert or update on public.inventory_purchase_prices
      for each row execute function public.enforce_inventory_purchase_price_scope();
    select oid into trig from pg_trigger where tgrelid=rel and tgname='inventory_purchase_price_scope';
    execute format('comment on trigger inventory_purchase_price_scope on public.inventory_purchase_prices is %L',
      'AlinFlow inventory purchase price trigger v1|'||md5(pg_get_triggerdef(trig)));
  end if;
end;
$access$;

commit;
