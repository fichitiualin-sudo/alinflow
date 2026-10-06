-- AlinFlow: Facebook Lead Ads beérkezések, megőrzött pillanatképpel.
-- Éles futtatás előtt friss adatmentés és csak olvasási sémaaudit szükséges.
-- Additív, tranzakciós és ismételhető. Nem küld üzenetet és nem módosít
-- meglévő ügyfelet, ajánlatot, dokumentumot, munkalapot vagy időpontot.
-- A customer_id törléskor NULL lesz: a leadazonosító megmarad, így az
-- ismételt kézbesítés nem hozza újra létre a szándékosan törölt ügyfelet.
begin;

create or replace function pg_temp.facebook_import_fingerprint(p_table regclass)
returns text language sql as $$
  select md5(coalesce(string_agg(entry,E'\n' order by entry),'')) from (
    select concat_ws('|',a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
      pg_get_expr(d.adbin,d.adrelid)) entry from pg_attribute a
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=p_table and a.attnum>0 and not a.attisdropped
    union all select concat_ws('|',c.conname,pg_get_constraintdef(c.oid),c.convalidated)
      from pg_constraint c where c.conrelid=p_table
  ) fields
$$;

do $table_setup$
declare
  rel regclass := to_regclass('public.facebook_lead_imports');
  existed boolean := rel is not null;
  marker text;
  ddl constant text := $ddl$
    create table public.facebook_lead_imports (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references public.workspaces(id) on delete restrict,
      page_id text not null check (page_id ~ '^[0-9]{1,64}$'),
      lead_id text not null check (lead_id ~ '^[0-9]{1,64}$'),
      customer_id uuid references public.customers(id) on delete set null,
      name text not null default '' check (length(name)<=300),
      phone text not null default '' check (length(phone)<=100),
      email text not null default '' check (length(email)<=320),
      city text not null default '' check (length(city)<=200),
      postal_code text not null default '' check (length(postal_code)<=20),
      climate_name text not null default '' check (length(climate_name)<=300),
      submitted_at timestamptz not null check (isfinite(submitted_at)),
      form_id text not null default '' check (form_id='' or form_id ~ '^[0-9]{1,64}$'),
      ad_id text not null default '' check (ad_id='' or ad_id ~ '^[0-9]{1,64}$'),
      ad_name text not null default '' check (length(ad_name)<=500),
      campaign_id text not null default '' check (campaign_id='' or campaign_id ~ '^[0-9]{1,64}$'),
      campaign_name text not null default '' check (length(campaign_name)<=500),
      received_at timestamptz not null default clock_timestamp(),
      status text not null check (status in ('created','matched','review')),
      review_reason text check (review_reason in ('no_contact','ambiguous_contact','missing_name')),
      acknowledged_at timestamptz,
      acknowledged_by uuid references auth.users(id) on delete set null,
      constraint facebook_lead_imports_identity_key unique(workspace_id,page_id,lead_id),
      constraint facebook_lead_imports_review_check check (
        (status='review' and review_reason is not null) or
        (status<>'review' and review_reason is null))
    )
  $ddl$;
begin
  if to_regclass('public.workspaces') is null or to_regclass('public.workspace_members') is null
    or to_regclass('public.customers') is null or to_regclass('auth.users') is null
    or to_regprocedure('auth.uid()') is null
    or not exists(select 1 from pg_roles where rolname='service_role') then
    raise exception 'Facebook-import: hiányzó Supabase/munkaterület séma. Audit szükséges.';
  end if;
  if not existed then execute ddl; rel := 'public.facebook_lead_imports'::regclass; end if;
  marker := 'AlinFlow Facebook lead imports v1|' || md5(regexp_replace(ddl,'\s+',' ','g'))
    || '|' || pg_temp.facebook_import_fingerprint(rel);
  if existed and obj_description(rel,'pg_class') is distinct from marker then
    raise exception 'Facebook-import: eltérő vagy ismeretlen naplótábla. Nem írtunk felül adatot; audit szükséges.';
  end if;
  if not existed then execute format('comment on table public.facebook_lead_imports is %L',marker); end if;
end;
$table_setup$;

do $rpc_guard$
declare signature text; function_oid oid;
begin
  foreach signature in array array[
    'public.facebook_lead_phone_key(text)',
    'public.import_facebook_lead(uuid,text,text,jsonb)',
    'public.acknowledge_facebook_lead(uuid,uuid)'
  ] loop
    function_oid := to_regprocedure(signature);
    if function_oid is not null and obj_description(function_oid,'pg_proc') is distinct from
      'AlinFlow Facebook lead RPC v1|' || md5(pg_get_functiondef(function_oid)) then
      raise exception 'Facebook-import: eltérő vagy ismeretlen függvény: %. Audit szükséges.',signature;
    end if;
  end loop;
end;
$rpc_guard$;

-- Azonos kulcs a meglévő CSV-import magyar telefonszám-normalizálásával.
create or replace function public.facebook_lead_phone_key(p_phone text)
returns text language sql immutable strict set search_path='' as $phone$
  select case
    when digits='' then ''
    when digits like '0036%' then '06'||substring(digits from 5)
    when digits like '36%' then '06'||substring(digits from 3)
    when digits like '0%' then digits
    else '06'||digits end
  from (select regexp_replace(p_phone,'[^0-9]','','g') digits) clean
$phone$;

create or replace function public.import_facebook_lead(
  p_workspace_id uuid,p_page_id text,p_lead_id text,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path='' set row_security=off
as $import$
declare
  incoming public.facebook_lead_imports%rowtype;
  saved public.facebook_lead_imports%rowtype;
  field record;
  phone_key text;
  email_key text;
  customer_ids uuid[];
begin
  -- Az adatbázis tényleges, PostgREST által beállított szerepe számít,
  -- nem a beküldött tartalom vagy egy szerkeszthető claim mező.
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'Facebook-import csak a szerver számára engedélyezett.' using errcode='42501';
  end if;
  if p_workspace_id is null or p_page_id is null or p_page_id !~ '^[0-9]{1,64}$'
    or p_lead_id is null or p_lead_id !~ '^[0-9]{1,64}$' then
    raise exception 'Hiányzó vagy hibás Facebook-import azonosító.' using errcode='22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>20000 then
    raise exception 'Hibás Facebook-import adatok.' using errcode='22023';
  end if;

  -- Két párhuzamos, külön leadazonosítójú import is ugyanazt az ügyfél-
  -- egyezést látja. Az egyszerre futó importok munkaterületenként sorosak.
  perform 1 from public.workspaces w where w.id=p_workspace_id and w.active for update;
  if not found then
    raise exception 'A Facebook-import munkaterülete nem található vagy inaktív.' using errcode='42501';
  end if;
  select f.* into saved from public.facebook_lead_imports f
    where f.workspace_id=p_workspace_id and f.page_id=p_page_id and f.lead_id=p_lead_id;
  if found then return to_jsonb(saved)||jsonb_build_object('duplicate',true); end if;

  for field in select * from (values
    ('name',300),('phone',100),('email',320),('city',200),('postal_code',20),
    ('climate_name',300),('submitted_at',64),('form_id',64),('ad_id',64),
    ('ad_name',500),('campaign_id',64),('campaign_name',500)
  ) fields(key,maximum) loop
    if p_payload ? field.key and jsonb_typeof(p_payload->field.key) not in ('string','null') then
      raise exception 'Hibás Facebook-import mezőtípus: %.',field.key using errcode='22023';
    end if;
    if length(coalesce(p_payload->>field.key,''))>field.maximum then
      raise exception 'Túl hosszú Facebook-import mező: %.',field.key using errcode='22023';
    end if;
  end loop;
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in (
    'name','phone','email','city','postal_code','climate_name','submitted_at',
    'form_id','ad_id','ad_name','campaign_id','campaign_name')) then
    raise exception 'Ismeretlen Facebook-import mező.' using errcode='22023';
  end if;
  incoming.name := btrim(coalesce(p_payload->>'name',''));
  incoming.phone := btrim(coalesce(p_payload->>'phone',''));
  incoming.email := btrim(coalesce(p_payload->>'email',''));
  incoming.city := btrim(coalesce(p_payload->>'city',''));
  incoming.postal_code := btrim(coalesce(p_payload->>'postal_code',''));
  incoming.climate_name := btrim(coalesce(p_payload->>'climate_name',''));
  incoming.form_id := btrim(coalesce(p_payload->>'form_id',''));
  incoming.ad_id := btrim(coalesce(p_payload->>'ad_id',''));
  incoming.ad_name := btrim(coalesce(p_payload->>'ad_name',''));
  incoming.campaign_id := btrim(coalesce(p_payload->>'campaign_id',''));
  incoming.campaign_name := btrim(coalesce(p_payload->>'campaign_name',''));
  if (incoming.form_id<>'' and incoming.form_id !~ '^[0-9]{1,64}$')
    or (incoming.ad_id<>'' and incoming.ad_id !~ '^[0-9]{1,64}$')
    or (incoming.campaign_id<>'' and incoming.campaign_id !~ '^[0-9]{1,64}$') then
    raise exception 'Hibás Facebook-hirdetés vagy űrlap azonosító.' using errcode='22023';
  end if;
  if coalesce(p_payload->>'submitted_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$' then
    raise exception 'Hiányzó vagy hibás jelentkezési idő.' using errcode='22023';
  end if;
  incoming.submitted_at := (p_payload->>'submitted_at')::timestamptz;
  if not isfinite(incoming.submitted_at) then
    raise exception 'Hibás jelentkezési idő.' using errcode='22023';
  end if;

  phone_key := public.facebook_lead_phone_key(incoming.phone);
  email_key := lower(incoming.email);
  -- Hibás kontakt nem vonhat össze két ügyfelet és nem válhat új ügyfél
  -- egyetlen elérhetőségévé. Az eredeti válasz a naplóban megmarad.
  if length(phone_key) not between 7 and 20 then phone_key := ''; end if;
  if email_key<>'' and email_key !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then email_key := ''; end if;
  if incoming.name='' then
    incoming.status := 'review'; incoming.review_reason := 'missing_name';
  elsif phone_key='' and email_key='' then
    incoming.status := 'review'; incoming.review_reason := 'no_contact';
  else
    select array_agg(c.id order by c.id) into customer_ids from public.customers c
      where c.workspace_id=p_workspace_id and (
        (phone_key<>'' and public.facebook_lead_phone_key(coalesce(c.phone,''))=phone_key)
        or (email_key<>'' and lower(btrim(coalesce(c.email,'')))=email_key));
    if coalesce(cardinality(customer_ids),0)>1 then
      incoming.status := 'review'; incoming.review_reason := 'ambiguous_contact';
    elsif cardinality(customer_ids)=1 then
      incoming.status := 'matched'; incoming.customer_id := customer_ids[1];
    else
      incoming.status := 'created'; incoming.customer_id := gen_random_uuid();
      insert into public.customers(id,workspace_id,name,phone,email,city,postal_code,source,status,need,
        created_by,created_at,updated_at)
      values(incoming.customer_id,p_workspace_id,incoming.name,nullif(phone_key,''),nullif(email_key,''),
        nullif(incoming.city,''),nullif(incoming.postal_code,''),'Facebook','Visszahívandó',
        nullif(incoming.climate_name,''),null,incoming.submitted_at,clock_timestamp());
    end if;
  end if;

  insert into public.facebook_lead_imports(workspace_id,page_id,lead_id,customer_id,name,phone,email,city,
    postal_code,climate_name,submitted_at,form_id,ad_id,ad_name,campaign_id,campaign_name,status,review_reason)
  values(p_workspace_id,p_page_id,p_lead_id,incoming.customer_id,incoming.name,incoming.phone,incoming.email,
    incoming.city,incoming.postal_code,incoming.climate_name,incoming.submitted_at,incoming.form_id,
    incoming.ad_id,incoming.ad_name,incoming.campaign_id,incoming.campaign_name,incoming.status,incoming.review_reason)
  returning * into saved;
  return to_jsonb(saved)||jsonb_build_object('duplicate',false);
end;
$import$;

create or replace function public.acknowledge_facebook_lead(p_workspace_id uuid,p_import_id uuid)
returns jsonb language plpgsql security definer set search_path='' set row_security=off
as $acknowledge$
declare saved public.facebook_lead_imports%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.workspace_members wm
    join public.workspaces w on w.id=wm.workspace_id and w.active
    where wm.workspace_id=p_workspace_id and wm.user_id=auth.uid() and wm.active) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  select f.* into saved from public.facebook_lead_imports f
    where f.workspace_id=p_workspace_id and f.id=p_import_id for update;
  if not found then raise exception 'A Facebook-beérkezés nem található.' using errcode='42501'; end if;
  if saved.acknowledged_at is null then
    update public.facebook_lead_imports f set acknowledged_at=clock_timestamp(),acknowledged_by=auth.uid()
      where f.workspace_id=p_workspace_id and f.id=p_import_id returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$acknowledge$;

revoke all on function public.facebook_lead_phone_key(text) from public,anon,authenticated,service_role;
revoke all on function public.import_facebook_lead(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.acknowledge_facebook_lead(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.import_facebook_lead(uuid,text,text,jsonb) to service_role;
grant execute on function public.acknowledge_facebook_lead(uuid,uuid) to authenticated;
do $rpc_comments$
declare signature text;
begin
  foreach signature in array array['public.facebook_lead_phone_key(text)',
    'public.import_facebook_lead(uuid,text,text,jsonb)','public.acknowledge_facebook_lead(uuid,uuid)'] loop
    execute format('comment on function %s is %L',signature,
      'AlinFlow Facebook lead RPC v1|'||md5(pg_get_functiondef(to_regprocedure(signature))));
  end loop;
end;
$rpc_comments$;

do $access$
declare
  rel regclass := 'public.facebook_lead_imports';
  policy_oid oid;
  existed boolean;
  fingerprint text;
  marker text;
  definition constant text := 'for select to authenticated using (exists(select 1 from public.workspace_members wm join public.workspaces w on w.id=wm.workspace_id and w.active where wm.workspace_id=facebook_lead_imports.workspace_id and wm.user_id=(select auth.uid()) and wm.active))';
begin
  alter table public.facebook_lead_imports enable row level security;
  revoke all on public.facebook_lead_imports from public,anon,authenticated,service_role;
  grant select on public.facebook_lead_imports to authenticated;
  -- A webhook újrapróbáláskor csak a már tartósan átvett azonosítókat
  -- ellenőrzi. A szerver nem kap közvetlen kontaktolvasási vagy írási jogot.
  grant select (lead_id,workspace_id,page_id) on public.facebook_lead_imports to service_role;
  if exists(select 1 from pg_policy where polrelid=rel and polname<>'facebook_lead_member_read')
    or exists(select 1 from pg_trigger where tgrelid=rel and not tgisinternal) then
    raise exception 'Facebook-import: ismeretlen napló-policy vagy trigger. Audit szükséges.';
  end if;
  select oid into policy_oid from pg_policy where polrelid=rel and polname='facebook_lead_member_read';
  existed := policy_oid is not null;
  if not existed then execute 'create policy facebook_lead_member_read on public.facebook_lead_imports '||definition; end if;
  select oid,md5(concat_ws('|',polcmd,polpermissive,polroles::text,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)))
    into policy_oid,fingerprint from pg_policy where polrelid=rel and polname='facebook_lead_member_read';
  marker := 'AlinFlow Facebook lead policy v1|'||md5(definition)||'|'||fingerprint;
  if existed and obj_description(policy_oid,'pg_policy') is distinct from marker then
    raise exception 'Facebook-import: eltérő napló-policy. Audit szükséges.';
  end if;
  execute format('comment on policy facebook_lead_member_read on public.facebook_lead_imports is %L',marker);
end;
$access$;
commit;
