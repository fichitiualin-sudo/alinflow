-- Private Google Contacts connection, reviewed mappings and serialized worker.
-- Additive and idempotent; this migration does not enroll or export customers.
begin;

create table if not exists public.google_contacts_connections (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  connected_by uuid references auth.users(id) on delete set null,
  google_subject text not null unique check(length(google_subject) between 1 and 255),
  google_email text not null check(length(google_email) between 1 and 320),
  refresh_token_encrypted text not null check(length(refresh_token_encrypted) between 1 and 16384),
  scope text not null,
  status text not null default 'active' check(status in ('active','paused','reauth_required')),
  connected_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  last_synced_at timestamptz, last_error text,
  lease_token uuid, lease_expires_at timestamptz,
  check((lease_token is null) = (lease_expires_at is null))
);
create table if not exists public.google_contacts_oauth_states (
  state_hash text primary key check(state_hash ~ '^[0-9a-f]{64}$'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expected_email text not null check(length(expected_email) between 1 and 320),
  code_verifier text not null check(length(code_verifier) between 1 and 16384),
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
comment on column public.google_contacts_oauth_states.code_verifier is 'Encrypted server-only PKCE verifier.';
create index if not exists google_contacts_oauth_states_expiry_idx on public.google_contacts_oauth_states(expires_at);
create table if not exists public.google_contacts_links (
  workspace_id uuid not null references public.google_contacts_connections(workspace_id) on delete cascade,
  -- Retain the mapping if a source customer disappears; never delete its Google contact.
  customer_id uuid not null,
  resource_name text check(resource_name ~ '^people/[a-zA-Z0-9_-]+$'),
  state text not null default 'pending' check(state in ('pending','creating','uncertain','synced','review')),
  approved_source_hash text not null check(approved_source_hash ~ '^[0-9a-f]{64}$'),
  synced_source_hash text, managed_snapshot jsonb, mutation_snapshot jsonb, mutation_source_hash text, mutation_payload jsonb,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  last_synced_at timestamptz, next_sync_at timestamptz not null default now(), last_error text,
  primary key(workspace_id,customer_id), unique(workspace_id,resource_name)
);
create index if not exists google_contacts_links_due_idx on public.google_contacts_links(next_sync_at,workspace_id) where state <> 'review';
create table if not exists public.google_contacts_previews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.google_contacts_connections(workspace_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  google_subject text not null,
  proofs jsonb not null check(jsonb_typeof(proofs)='array'),
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
comment on column public.google_contacts_previews.proofs is 'Expiring source hashes and permitted remote IDs only; no contact names or phone numbers.';
create index if not exists google_contacts_previews_expiry_idx on public.google_contacts_previews(expires_at);

alter table public.google_contacts_connections enable row level security;
alter table public.google_contacts_oauth_states enable row level security;
alter table public.google_contacts_links enable row level security;
alter table public.google_contacts_previews enable row level security;
do $private$
begin
  if exists(select 1 from pg_policies where schemaname='public' and tablename in
    ('google_contacts_connections','google_contacts_oauth_states','google_contacts_links','google_contacts_previews')) then
    raise exception 'Unexpected Google Contacts browser policy; review before migration.';
  end if;
end;
$private$;
revoke all on public.google_contacts_connections,public.google_contacts_oauth_states,public.google_contacts_links,public.google_contacts_previews from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.google_contacts_connections,public.google_contacts_oauth_states,public.google_contacts_previews to service_role;
grant select,update on public.google_contacts_links to service_role;

create or replace function public.complete_google_contacts_connection(
 p_workspace_id uuid,p_user_id uuid,p_google_subject text,p_google_email text,p_refresh_token_encrypted text,p_scope text
) returns boolean language plpgsql security definer set search_path='' set row_security=off as $connect$
declare v_existing public.google_contacts_connections; v_active boolean; v_email text:=lower(trim(p_google_email));
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Server-only.' using errcode='42501'; end if;
  select active into v_active from public.workspaces where id=p_workspace_id for update;
  if v_active is distinct from true or not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id and active and role in ('owner','admin')) then
    raise exception 'Active owner or administrator required.' using errcode='42501';
  end if;
  select * into v_existing from public.google_contacts_connections where workspace_id=p_workspace_id for update;
  if found and (v_existing.google_subject is distinct from p_google_subject or lower(v_existing.google_email) is distinct from v_email) then
    raise exception 'The connected account cannot be replaced.' using errcode='22023';
  end if;
  if coalesce(nullif(p_refresh_token_encrypted,''),v_existing.refresh_token_encrypted) is null then
    raise exception 'Offline authorization required.' using errcode='22023';
  end if;
  if not ('https://www.googleapis.com/auth/contacts'=any(regexp_split_to_array(trim(p_scope),'\s+'))) then raise exception 'Contacts authorization required.' using errcode='22023'; end if;
  insert into public.google_contacts_connections(workspace_id,connected_by,google_subject,google_email,refresh_token_encrypted,scope,status)
  values(p_workspace_id,p_user_id,p_google_subject,v_email,coalesce(nullif(p_refresh_token_encrypted,''),v_existing.refresh_token_encrypted),p_scope,'active')
  on conflict(workspace_id) do update set connected_by=excluded.connected_by,refresh_token_encrypted=excluded.refresh_token_encrypted,
    scope=excluded.scope,status='active',last_error=null,connected_at=clock_timestamp(),updated_at=clock_timestamp();
  return true;
end;
$connect$;
create or replace function public.consume_google_contacts_oauth_state(p_state_hash text)
returns setof public.google_contacts_oauth_states language plpgsql security definer set search_path='' set row_security=off as $consume$
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Server-only.' using errcode='42501'; end if;
  return query with consumed as(delete from public.google_contacts_oauth_states where state_hash=p_state_hash returning *)
    select * from consumed where expires_at>clock_timestamp();
end;
$consume$;
create or replace function public.google_contacts_excluded_installations(p_workspace_id uuid)
returns table(installation_id uuid) language plpgsql security definer set search_path='' set row_security=off as $exclude$
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Server-only.' using errcode='42501'; end if;
  return query select distinct h.target_installation_id from public.shared_maintenance_handoffs h
    where h.target_workspace_id=p_workspace_id and h.target_installation_id is not null;
end;
$exclude$;

create or replace function public.approve_google_contacts_links(p_workspace_id uuid,p_user_id uuid,p_preview_id uuid,p_items jsonb)
returns integer language plpgsql security definer set search_path='' set row_security=off as $approve$
declare v_connection public.google_contacts_connections; v_preview public.google_contacts_previews; v_item jsonb; v_proof jsonb; v_count integer:=0; v_inserted integer;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Server-only.' using errcode='42501'; end if;
  if not exists(select 1 from public.workspaces w join public.workspace_members m on m.workspace_id=w.id where w.id=p_workspace_id and w.active and m.user_id=p_user_id and m.active and m.role in ('owner','admin')) then
    raise exception 'Active owner or administrator required.' using errcode='42501';
  end if;
  select * into v_connection from public.google_contacts_connections where workspace_id=p_workspace_id for update;
  if not found or v_connection.status<>'active' then raise exception 'Active connection required.' using errcode='22023'; end if;
  select * into v_preview from public.google_contacts_previews where id=p_preview_id and workspace_id=p_workspace_id and user_id=p_user_id for update;
  if not found or v_preview.expires_at<=clock_timestamp() or v_preview.google_subject<>v_connection.google_subject then raise exception 'Refresh preview.' using errcode='22023'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 10 then raise exception 'Invalid selection.' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    select value into v_proof from jsonb_array_elements(v_preview.proofs) where value->>'customerId'=v_item->>'customerId';
    if v_proof is null or v_proof->>'sourceHash' is distinct from v_item->>'sourceHash'
      or not exists(select 1 from jsonb_array_elements(v_proof->'options') o where o.value is not distinct from coalesce(v_item->'resourceName','null'::jsonb)) then
      raise exception 'Selection was not reviewed.' using errcode='22023';
    end if;
    insert into public.google_contacts_links(workspace_id,customer_id,resource_name,approved_source_hash,approved_by)
    values(p_workspace_id,(v_item->>'customerId')::uuid,v_item->>'resourceName',v_item->>'sourceHash',p_user_id)
    on conflict(workspace_id,customer_id) do update set resource_name=excluded.resource_name,
      approved_source_hash=excluded.approved_source_hash,approved_by=excluded.approved_by,approved_at=clock_timestamp(),
      state='pending',last_error=null,next_sync_at=clock_timestamp(),updated_at=clock_timestamp()
      where google_contacts_links.state='review' and google_contacts_links.managed_snapshot is null
        and google_contacts_links.synced_source_hash is null and google_contacts_links.mutation_snapshot is null;
    get diagnostics v_inserted=row_count; v_count:=v_count+v_inserted;
  end loop;
  delete from public.google_contacts_previews where id=p_preview_id;
  return v_count;
end;
$approve$;

create or replace function public.claim_google_contacts_sync(p_workspace_id uuid default null)
returns setof public.google_contacts_connections language plpgsql security definer set search_path='' set row_security=off as $claim$
declare v_id uuid;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Server-only.' using errcode='42501'; end if;
  select c.workspace_id into v_id from public.google_contacts_connections c join public.workspaces w on w.id=c.workspace_id
    where c.status='active' and w.active and (p_workspace_id is null or c.workspace_id=p_workspace_id)
      and (c.lease_expires_at is null or c.lease_expires_at<clock_timestamp())
      and exists(select 1 from public.google_contacts_links l where l.workspace_id=c.workspace_id and l.state<>'review' and l.next_sync_at<=clock_timestamp())
    order by c.last_synced_at nulls first,c.workspace_id limit 1 for update of c skip locked;
  if v_id is null then return; end if;
  return query update public.google_contacts_connections set lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '120 seconds'
    where workspace_id=v_id returning *;
end;
$claim$;
create or replace function public.release_google_contacts_sync(p_workspace_id uuid,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path='' set row_security=off as $release$
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Server-only.' using errcode='42501'; end if;
  update public.google_contacts_connections set lease_token=null,lease_expires_at=null where workspace_id=p_workspace_id and lease_token=p_lease_token;
  return found;
end;
$release$;

revoke all on function public.complete_google_contacts_connection(uuid,uuid,text,text,text,text),public.consume_google_contacts_oauth_state(text),public.google_contacts_excluded_installations(uuid),public.approve_google_contacts_links(uuid,uuid,uuid,jsonb),public.claim_google_contacts_sync(uuid),public.release_google_contacts_sync(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_google_contacts_connection(uuid,uuid,text,text,text,text),public.consume_google_contacts_oauth_state(text),public.google_contacts_excluded_installations(uuid),public.approve_google_contacts_links(uuid,uuid,uuid,jsonb),public.claim_google_contacts_sync(uuid),public.release_google_contacts_sync(uuid,uuid) to service_role;
commit;
