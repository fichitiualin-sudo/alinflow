-- Limited, revocable maintenance coordination on the source business' behalf.
-- Run only after a fresh schema audit and protected backup. No grant is seeded.
-- A real written processor agreement must exist before the owner activates a
-- grant; the reference below records its location, not customer consent.
begin;

create table if not exists public.shared_maintenance_grants (
  id uuid primary key default gen_random_uuid(),
  source_workspace_id uuid not null references public.workspaces(id) on delete restrict,
  target_workspace_id uuid not null references public.workspaces(id) on delete restrict,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  agreement_reference text not null check (char_length(agreement_reference) between 3 and 1000 and agreement_reference = btrim(agreement_reference) and agreement_reference !~ '[[:cntrl:]]'),
  scope text not null default 'historical_installations' check (scope = 'historical_installations'),
  cutoff_date date not null default current_date,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete restrict,
  check (source_workspace_id <> target_workspace_id),
  check ((revoked_at is null) = (revoked_by is null)),
  unique(source_workspace_id,target_workspace_id,target_user_id)
);
create table if not exists public.shared_maintenance_contacts (
  id uuid primary key default gen_random_uuid(),
  source_workspace_id uuid not null references public.workspaces(id) on delete restrict,
  source_customer_id uuid not null,
  target_workspace_id uuid not null references public.workspaces(id) on delete restrict,
  target_customer_id uuid references public.customers(id) on delete set null,
  unique(source_workspace_id,source_customer_id,target_workspace_id)
);
create table if not exists public.shared_maintenance_handoffs (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.shared_maintenance_grants(id) on delete restrict,
  source_workspace_id uuid not null references public.workspaces(id) on delete restrict,
  source_installation_id uuid not null,
  target_workspace_id uuid not null references public.workspaces(id) on delete restrict,
  target_customer_id uuid references public.customers(id) on delete set null,
  target_installation_id uuid references public.appointments(id) on delete set null deferrable initially deferred,
  accepted_order_at timestamptz not null default now(),
  accepted_order_by uuid not null references auth.users(id) on delete restrict,
  unique(source_workspace_id,source_installation_id,target_workspace_id),
  unique(target_installation_id)
);
create table if not exists public.shared_maintenance_events (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.shared_maintenance_grants(id) on delete restrict,
  action text not null check(action in ('granted','renewed','revoked','order_accepted')),
  actor_id uuid not null,
  recorded_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);
-- Sticky work provenance closes the delete-links / close / relink race. It
-- records only that this own work has used a delegated installation; changing
-- the selected units does not turn it into a legacy work without a notice.
create table if not exists public.shared_maintenance_work_origins (
  appointment_id uuid primary key references public.appointments(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  customer_id uuid not null,
  first_linked_at timestamptz not null default now()
);
create index if not exists shared_maintenance_recipient_idx on public.shared_maintenance_grants(target_workspace_id,target_user_id) where revoked_at is null;
create index if not exists shared_maintenance_source_idx on public.shared_maintenance_grants(source_workspace_id);
create index if not exists shared_maintenance_events_grant_idx on public.shared_maintenance_events(grant_id,recorded_at);

-- No business-table policies or memberships are widened. All access is through
-- functions below; even the service role has no direct grant-table privileges.
alter table public.shared_maintenance_grants enable row level security;
alter table public.shared_maintenance_contacts enable row level security;
alter table public.shared_maintenance_handoffs enable row level security;
alter table public.shared_maintenance_events enable row level security;
alter table public.shared_maintenance_work_origins enable row level security;
revoke all on public.shared_maintenance_grants, public.shared_maintenance_contacts,
  public.shared_maintenance_handoffs, public.shared_maintenance_events, public.shared_maintenance_work_origins from public,anon,authenticated,service_role;

create or replace function public.shared_maintenance_member(p_workspace_id uuid,p_user_id uuid,p_admin boolean default false)
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select p_user_id is not null and exists (
    select 1 from public.workspace_members m
    join public.workspaces w on w.id=m.workspace_id and w.active
    join auth.users u on u.id=m.user_id and u.deleted_at is null
      and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
    where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.active
      and (not p_admin or m.role in ('owner','admin'))
  );
$$;
create or replace function public.shared_maintenance_grant_json(p_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('id',g.id,'sourceWorkspaceId',g.source_workspace_id,
    'targetUserId',g.target_user_id,'targetWorkspaceId',g.target_workspace_id,
    'targetWorkspaceName',w.name,'agreementReference',g.agreement_reference,
    'scope',g.scope,'cutoffDate',g.cutoff_date,'createdAt',g.created_at,'revokedAt',g.revoked_at)
  from public.shared_maintenance_grants g join public.workspaces w on w.id=g.target_workspace_id where g.id=p_id;
$$;

create or replace function public.grant_shared_maintenance_access(p_source_workspace_id uuid,p_target_user_id uuid,p_target_workspace_id uuid,p_agreement_reference text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_id uuid; v_existing boolean;
begin
  if not public.shared_maintenance_member(p_source_workspace_id,auth.uid(),true)
    or not public.shared_maintenance_member(p_target_workspace_id,p_target_user_id,false)
    or p_source_workspace_id=p_target_workspace_id then
    raise exception 'A karbantartási hozzáférés nem adható meg.' using errcode='42501';
  end if;
  if not exists (select 1 from public.workspace_settings s where s.workspace_id=p_target_workspace_id
    and s.document_settings #>> '{privacyNotice,enabled}' = 'true'
    and nullif(btrim(s.document_settings #>> '{privacyNotice,serviceProvider,legalName}'),'') is not null
    and nullif(btrim(s.document_settings #>> '{privacyNotice,serviceProvider,address}'),'') is not null
    and s.document_settings #>> '{privacyNotice,serviceProvider,email}' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and nullif(btrim(s.document_settings #>> '{privacyNotice,retentionText}'),'') is not null
    and nullif(btrim(s.document_settings #>> '{privacyNotice,recipientsText}'),'') is not null
    and nullif(btrim(s.document_settings #>> '{privacyNotice,internationalTransfersText}'),'') is not null) then
    raise exception 'Előbb töltsék ki és kapcsolják be a karbantartó adatkezelési tájékoztatóját.' using errcode='22023';
  end if;
  if p_agreement_reference is null or char_length(btrim(p_agreement_reference)) not between 3 and 1000
    or p_agreement_reference ~ '[[:cntrl:]]' then
    raise exception 'Add meg a tényleges írásbeli adatfeldolgozói megállapodás hivatkozását.' using errcode='22023';
  end if;
  -- Serialize grants and revocations for the same source workspace.
  perform 1 from public.workspaces where id=p_source_workspace_id for update;
  select id into v_id from public.shared_maintenance_grants where source_workspace_id=p_source_workspace_id
    and target_workspace_id=p_target_workspace_id and target_user_id=p_target_user_id for update;
  v_existing := found;
  if v_existing then
    update public.shared_maintenance_grants set agreement_reference=btrim(p_agreement_reference),
      cutoff_date=current_date,created_at=now(),created_by=auth.uid(),revoked_at=null,revoked_by=null where id=v_id;
  else
    insert into public.shared_maintenance_grants(source_workspace_id,target_workspace_id,target_user_id,agreement_reference,created_by)
      values(p_source_workspace_id,p_target_workspace_id,p_target_user_id,btrim(p_agreement_reference),auth.uid()) returning id into v_id;
  end if;
  insert into public.shared_maintenance_events(grant_id,action,actor_id,details)
    values(v_id,case when v_existing then 'renewed' else 'granted' end,auth.uid(),
      jsonb_build_object('agreementReference',btrim(p_agreement_reference),'scope','historical_installations','cutoffDate',current_date));
  return public.shared_maintenance_grant_json(v_id);
end;
$$;

create or replace function public.list_shared_maintenance_grants(p_source_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  if not public.shared_maintenance_member(p_source_workspace_id,auth.uid(),true) then
    raise exception 'Nincs jogosultság a megosztások kezeléséhez.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(public.shared_maintenance_grant_json(id) order by created_at desc)
    from public.shared_maintenance_grants where source_workspace_id=p_source_workspace_id),'[]'::jsonb);
end;
$$;

create or replace function public.revoke_shared_maintenance_access(p_grant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare g public.shared_maintenance_grants%rowtype;
begin
  select * into g from public.shared_maintenance_grants where id=p_grant_id for update;
  if not found or not public.shared_maintenance_member(g.source_workspace_id,auth.uid(),true) then
    raise exception 'Nincs jogosultság a megosztás visszavonásához.' using errcode='42501';
  end if;
  if g.revoked_at is null then
    update public.shared_maintenance_grants set revoked_at=now(),revoked_by=auth.uid() where id=g.id;
    insert into public.shared_maintenance_events(grant_id,action,actor_id) values(g.id,'revoked',auth.uid());
  end if;
  return public.shared_maintenance_grant_json(g.id);
end;
$$;

-- Internal allowlist; never returns a whole customer, quote, document or device
-- JSON. Serial labels and work photos are unnecessary for the first call.
create or replace function public.shared_maintenance_installation_rows(p_target_workspace_id uuid)
returns table(grant_id uuid,installation_id uuid,source_workspace_id uuid,source_customer_id uuid,payload jsonb)
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select g.id,a.id,g.source_workspace_id,c.id,
    jsonb_build_object('grantId',g.id,'installationId',a.id,'sourceWorkspaceId',g.source_workspace_id,
      'sourceWorkspaceName',w.name,'customer',jsonb_build_object('name',c.name,'phone',coalesce(c.phone,''),
        'email',coalesce(c.email,''),'postalCode',coalesce(c.postal_code,''),'city',coalesce(c.city,''),
        'address',coalesce(nullif(a.address,''),c.address,'')),
      'installationDate',a.scheduled_date,'installationTime',a.scheduled_time,
      'climates',coalesce((select jsonb_agg(jsonb_build_object('productName',left(qi.product_name,300),'quantity',qi.quantity) order by qi.id)
        from public.quote_items qi join public.quotes q on q.id=qi.quote_id and q.workspace_id=qi.workspace_id
        where q.id=a.quote_id and q.customer_id=c.id and q.workspace_id=g.source_workspace_id
          and qi.quantity>0 and qi.quantity<=1000),'[]'::jsonb),
      'latitude',a.latitude,'longitude',a.longitude,
      'lastMaintenanceDate',(select max(ma.scheduled_date) from public.maintenance_appointment_items mi
        join public.appointments ma on ma.id=mi.maintenance_appointment_id and ma.workspace_id=mi.workspace_id
        where mi.installation_appointment_id=a.id and mi.workspace_id=g.source_workspace_id and mi.customer_id=c.id
          and ma.customer_id=c.id and ma.appointment_type='maintenance' and ma.status='Lezárva' and ma.scheduled_date<=current_date),
      'maintenanceCount',(select count(*) from public.maintenance_appointment_items mi
        join public.appointments ma on ma.id=mi.maintenance_appointment_id and ma.workspace_id=mi.workspace_id
        where mi.installation_appointment_id=a.id and mi.workspace_id=g.source_workspace_id and mi.customer_id=c.id
          and ma.customer_id=c.id and ma.appointment_type='maintenance' and ma.status='Lezárva' and ma.scheduled_date<=current_date),
      'targetCustomerId',h.target_customer_id,'targetInstallationId',h.target_installation_id)
  from public.shared_maintenance_grants g
  join public.workspaces w on w.id=g.source_workspace_id and w.active
  join public.appointments a on a.workspace_id=g.source_workspace_id
  join public.customers c on c.id=a.customer_id and c.workspace_id=g.source_workspace_id
  left join public.shared_maintenance_handoffs h on h.source_workspace_id=g.source_workspace_id
    and h.source_installation_id=a.id and h.target_workspace_id=g.target_workspace_id
  where g.target_workspace_id=p_target_workspace_id and g.target_user_id=auth.uid() and g.revoked_at is null
    and public.shared_maintenance_member(g.target_workspace_id,auth.uid(),false)
    and a.appointment_type='installation' and a.maintenance_origin='own'
    and not exists(select 1 from public.shared_maintenance_handoffs provenance
      where provenance.target_installation_id=a.id and provenance.target_workspace_id=a.workspace_id)
    and a.status in ('Lezárva','Szerelés kész – admin folyamatban') and a.cancelled_at is null
    and a.scheduled_date<=g.cutoff_date and a.scheduled_date<=current_date and a.created_at<=g.created_at
    and not coalesce(a.maintenance_opt_out,false);
$$;

create or replace function public.list_received_maintenance_installations(p_target_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  if not public.shared_maintenance_member(p_target_workspace_id,auth.uid(),false) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(r.payload order by r.payload#>>'{customer,name}',r.installation_id)
    from public.shared_maintenance_installation_rows(p_target_workspace_id) r),'[]'::jsonb);
end;
$$;

create or replace function public.accept_shared_maintenance_order(p_grant_id uuid,p_installation_id uuid,p_customer_order_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare g public.shared_maintenance_grants%rowtype; r record; contact_id uuid; target_customer uuid;
  target_installation uuid; v_quote_id uuid; handoff_id uuid; existing_handoff record;
begin
  if p_customer_order_confirmed is distinct from true then
    raise exception 'Saját karbantartási ügyfél csak tényleges ügyfélmegrendelés után hozható létre.' using errcode='22023';
  end if;
  select * into g from public.shared_maintenance_grants where id=p_grant_id for update;
  if not found or g.revoked_at is not null or g.target_user_id is distinct from auth.uid()
    or not public.shared_maintenance_member(g.target_workspace_id,auth.uid(),false) then
    raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501';
  end if;
  -- Source row lock serializes opt-out/deletion with the explicit acceptance.
  perform 1 from public.appointments where id=p_installation_id and workspace_id=g.source_workspace_id for update;
  select * into r from public.shared_maintenance_installation_rows(g.target_workspace_id)
    where grant_id=g.id and installation_id=p_installation_id;
  if not found then raise exception 'A megosztott telepítés nem érhető el.' using errcode='42501'; end if;
  insert into public.shared_maintenance_contacts(source_workspace_id,source_customer_id,target_workspace_id)
    values(g.source_workspace_id,r.source_customer_id,g.target_workspace_id) on conflict do nothing;
  select id,target_customer_id into contact_id,target_customer from public.shared_maintenance_contacts
    where source_workspace_id=g.source_workspace_id and source_customer_id=r.source_customer_id
      and target_workspace_id=g.target_workspace_id for update;
  -- Different active recipient-user grants in one target workspace may race;
  -- the shared contact lock above serializes their handoff check as well.
  select h.target_customer_id,h.target_installation_id into existing_handoff
    from public.shared_maintenance_handoffs h
    where h.source_workspace_id=g.source_workspace_id and h.source_installation_id=p_installation_id
      and h.target_workspace_id=g.target_workspace_id for update;
  if found and existing_handoff.target_customer_id is not null and existing_handoff.target_installation_id is not null then
    if not exists(select 1 from public.appointments a join public.customers c on c.id=a.customer_id and c.workspace_id=a.workspace_id
      where a.id=existing_handoff.target_installation_id and a.workspace_id=g.target_workspace_id
        and a.customer_id=existing_handoff.target_customer_id and a.appointment_type='installation' and a.maintenance_origin='external') then
      raise exception 'Az átvett telepítés hivatkozása megváltozott. Ellenőrzés szükséges.' using errcode='23514';
    end if;
    return jsonb_build_object('customerId',existing_handoff.target_customer_id,'installationId',existing_handoff.target_installation_id,'created',false);
  end if;
  if target_customer is not null and not exists(select 1 from public.customers c where c.id=target_customer and c.workspace_id=g.target_workspace_id) then
    raise exception 'Az átvett ügyfél hivatkozása megváltozott. Ellenőrzés szükséges.' using errcode='23514';
  end if;
  if target_customer is null then
    target_customer := gen_random_uuid();
    insert into public.customers(id,workspace_id,name,phone,email,postal_code,city,address,source,status,need,notes,stock_deducted,created_by)
      values(target_customer,g.target_workspace_id,r.payload#>>'{customer,name}',r.payload#>>'{customer,phone}',
        r.payload#>>'{customer,email}',r.payload#>>'{customer,postalCode}',r.payload#>>'{customer,city}',r.payload#>>'{customer,address}',
        'Karbantartási átvétel','Lezárva',null,null,false,auth.uid());
    update public.shared_maintenance_contacts set target_customer_id=target_customer where id=contact_id;
  end if;
  target_installation := gen_random_uuid();
  -- Register provenance BEFORE inserting the reference installation so optional
  -- calendar triggers can suppress only this imported reference (not real jobs).
  insert into public.shared_maintenance_handoffs(grant_id,source_workspace_id,source_installation_id,target_workspace_id,
    target_customer_id,target_installation_id,accepted_order_by)
    values(g.id,g.source_workspace_id,p_installation_id,g.target_workspace_id,target_customer,target_installation,auth.uid())
    on conflict(source_workspace_id,source_installation_id,target_workspace_id) do update set
      grant_id=excluded.grant_id,target_customer_id=excluded.target_customer_id,target_installation_id=excluded.target_installation_id,
      accepted_order_at=now(),accepted_order_by=auth.uid() returning id into handoff_id;
  insert into public.appointments(id,workspace_id,customer_id,title,scheduled_date,scheduled_time,appointment_type,status,address,
    notes,created_by,maintenance_origin,maintenance_source_name,latitude,longitude)
    values(target_installation,g.target_workspace_id,target_customer,'Karbantartásra átvett telepítés',
      (r.payload->>'installationDate')::date,r.payload->>'installationTime','installation','Lezárva',r.payload#>>'{customer,address}',
      null,auth.uid(),'external',left(r.payload->>'sourceWorkspaceName',160),
      (r.payload->>'latitude')::double precision,(r.payload->>'longitude')::double precision);
  -- Pure identification snapshot: both equipment and labor prices are zero.
  -- No source product ID is reused in the target tenant's catalog.
  insert into public.quotes(workspace_id,customer_id,appointment_id,status,notes,total_amount,created_by)
    values(g.target_workspace_id,target_customer,target_installation,'Lezárva',null,0,auth.uid()) returning id into v_quote_id;
  insert into public.quote_items(workspace_id,quote_id,product_name,description,quantity,unit_price,total_price)
    select g.target_workspace_id,v_quote_id,item->>'productName','|install_price=0',(item->>'quantity')::numeric,0,0
      from jsonb_array_elements(r.payload->'climates') item;
  update public.appointments set quote_id=v_quote_id where id=target_installation and workspace_id=g.target_workspace_id;
  insert into public.shared_maintenance_events(grant_id,action,actor_id,details)
    values(g.id,'order_accepted',auth.uid(),jsonb_build_object('handoffId',handoff_id,'sourceInstallationId',p_installation_id,
      'targetCustomerId',target_customer,'targetInstallationId',target_installation,'customerOrderConfirmed',true));
  return jsonb_build_object('customerId',target_customer,'installationId',target_installation,'created',true);
end;
$$;

-- The source sees only a completion summary. Its original work records, quote,
-- invoice, photos and signed documents are neither changed nor copied back.
create or replace function public.list_shared_maintenance_results(p_source_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  if not public.shared_maintenance_member(p_source_workspace_id,auth.uid(),false) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('installationId',h.source_installation_id,
      'date',ma.scheduled_date,'providerName',w.name,'status',ma.status) order by ma.scheduled_date desc,ma.id)
    from public.shared_maintenance_handoffs h
    join public.workspaces w on w.id=h.target_workspace_id
    join public.maintenance_appointment_items mi on mi.installation_appointment_id=h.target_installation_id
      and mi.workspace_id=h.target_workspace_id and mi.customer_id=h.target_customer_id
    join public.appointments ma on ma.id=mi.maintenance_appointment_id and ma.workspace_id=h.target_workspace_id
      and ma.customer_id=h.target_customer_id and ma.appointment_type='maintenance' and ma.status='Lezárva'
    where h.source_workspace_id=p_source_workspace_id and ma.scheduled_date<=current_date
      and public.shared_maintenance_has_signed_notice(h.target_workspace_id,h.target_customer_id,ma.id)), '[]'::jsonb);
end;
$$;

-- Closing delegated work is a server invariant, including direct REST writes.
-- The existing privacy trigger validates the entire saved notice. This helper
-- independently verifies its exact association with this maintenance signature.
create or replace function public.shared_maintenance_has_signed_notice(p_workspace_id uuid,p_customer_id uuid,p_appointment_id uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare r record; notice_signed_at timestamptz;
begin
  for r in select wr.signed_at,wr.signature_data_url,wr.signer_name,wr.privacy_notice
    from public.work_reports wr where wr.workspace_id=p_workspace_id and wr.customer_id=p_customer_id
      and wr.appointment_id=p_appointment_id and wr.appointment_type='maintenance'
      and wr.signed_at is not null and nullif(btrim(wr.signer_name),'') is not null
      and wr.signature_data_url ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'
      and wr.privacy_notice->>'version'='2026-10-11.2'
      and wr.privacy_notice->>'signatureDataUrl'=wr.signature_data_url
      and wr.privacy_notice->>'signerName'=wr.signer_name
  loop
    begin notice_signed_at := (r.privacy_notice->>'signedAt')::timestamptz;
    exception when others then continue; end;
    if notice_signed_at is not null and isfinite(notice_signed_at) and notice_signed_at=r.signed_at then return true; end if;
  end loop;
  return false;
end;
$$;

create or replace function public.guard_shared_maintenance_completion()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.appointments%rowtype; delegated boolean; valid_scope boolean;
begin
  if tg_table_schema<>'public' then raise exception 'Érvénytelen karbantartási művelet.' using errcode='42501'; end if;
  if tg_table_name='appointments' then
    a := new;
    if a.appointment_type<>'maintenance' or a.status<>'Lezárva' then return new; end if;
    select exists(select 1 from public.shared_maintenance_work_origins o where o.appointment_id=a.id)
      or exists(select 1 from public.maintenance_appointment_items mi
      join public.shared_maintenance_handoffs h on h.target_installation_id=mi.installation_appointment_id
      where mi.maintenance_appointment_id=a.id) into delegated;
    if not delegated then return new; end if;
    select not exists(select 1 from public.shared_maintenance_work_origins o where o.appointment_id=a.id
        and (o.workspace_id is distinct from a.workspace_id or o.customer_id is distinct from a.customer_id))
      and not exists(select 1 from public.maintenance_appointment_items mi
      join public.shared_maintenance_handoffs h on h.target_installation_id=mi.installation_appointment_id
      where mi.maintenance_appointment_id=a.id and (mi.workspace_id is distinct from a.workspace_id
        or mi.customer_id is distinct from a.customer_id or h.target_workspace_id is distinct from a.workspace_id
        or h.target_customer_id is distinct from a.customer_id)) into valid_scope;
  elsif tg_table_name='maintenance_appointment_items' then
    select exists(select 1 from public.shared_maintenance_handoffs h where h.target_installation_id=new.installation_appointment_id) into delegated;
    if not delegated then return new; end if;
    -- Serialize late-link writes with a concurrent close or appointment edit.
    select * into a from public.appointments where id=new.maintenance_appointment_id for update;
    select exists(select 1 from public.shared_maintenance_handoffs h where h.target_installation_id=new.installation_appointment_id
      and h.target_workspace_id=new.workspace_id and h.target_customer_id=new.customer_id
      and a.workspace_id=new.workspace_id and a.customer_id=new.customer_id and a.appointment_type='maintenance') into valid_scope;
  else raise exception 'Érvénytelen karbantartási művelet.' using errcode='42501';
  end if;
  if not valid_scope then
    raise exception 'Az átvett telepítés és a karbantartás ügyfele vagy munkaterülete nem egyezik.' using errcode='23514';
  end if;
  if a.status='Lezárva' and not public.shared_maintenance_has_signed_notice(a.workspace_id,a.customer_id,a.id) then
    raise exception 'A karbantartás lezárásához az adott munkalaphoz tartozó, újonnan aláírt adatkezelési tájékoztató szükséges.' using errcode='23514';
  end if;
  if tg_table_name='maintenance_appointment_items' then
    insert into public.shared_maintenance_work_origins(appointment_id,workspace_id,customer_id)
      values(a.id,a.workspace_id,a.customer_id) on conflict(appointment_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists shared_maintenance_completion_guard on public.appointments;
create trigger shared_maintenance_completion_guard before insert or update on public.appointments
  for each row execute function public.guard_shared_maintenance_completion();
drop trigger if exists shared_maintenance_link_completion_guard on public.maintenance_appointment_items;
create trigger shared_maintenance_link_completion_guard before insert or update on public.maintenance_appointment_items
  for each row execute function public.guard_shared_maintenance_completion();

-- Suppress only provenance-registered historical installation mirrors from
-- Google Calendar. Preserve existing ownership, security options and grants.
do $calendar$
declare f oid := to_regprocedure('public.enqueue_google_calendar_appointment(uuid,uuid,timestamptz,boolean)'); definition text;
  marker text := '/* shared-maintenance-reference */'; needle text := '  insert into public.google_calendar_sync_queue'; original_metadata jsonb;
begin
  if f is null then return; end if;
  select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,original_metadata from pg_proc p where p.oid=f;
  if strpos(definition,marker)>0 then return; end if;
  if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then
    raise exception 'Unexpected Google Calendar queue implementation; inspect before applying sharing migration.';
  end if;
  definition := replace(definition,needle,'  '||marker||E'\n  if exists (select 1 from public.shared_maintenance_handoffs h where h.target_workspace_id=p_workspace_id and h.target_installation_id=p_appointment_id) then return; end if;\n'||needle);
  execute definition;
  if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=f) is distinct from original_metadata then
    raise exception 'Calendar queue metadata changed unexpectedly.';
  end if;
end;
$calendar$;

revoke all on function public.shared_maintenance_member(uuid,uuid,boolean),public.shared_maintenance_grant_json(uuid),
  public.shared_maintenance_installation_rows(uuid),public.shared_maintenance_has_signed_notice(uuid,uuid,uuid),
  public.guard_shared_maintenance_completion() from public,anon,authenticated,service_role;
revoke all on function public.grant_shared_maintenance_access(uuid,uuid,uuid,text),public.list_shared_maintenance_grants(uuid),
  public.revoke_shared_maintenance_access(uuid),public.list_received_maintenance_installations(uuid),
  public.accept_shared_maintenance_order(uuid,uuid,boolean),public.list_shared_maintenance_results(uuid) from public,anon,authenticated,service_role;
grant execute on function public.grant_shared_maintenance_access(uuid,uuid,uuid,text),public.list_shared_maintenance_grants(uuid),
  public.revoke_shared_maintenance_access(uuid),public.list_received_maintenance_installations(uuid),
  public.accept_shared_maintenance_order(uuid,uuid,boolean),public.list_shared_maintenance_results(uuid) to authenticated;
commit;
