-- AlinFlow: private Google Calendar connection and durable, versioned outbox.
-- Additive and repeatable. No existing appointments are enrolled by this migration.
-- Apply after workspace isolation. OAuth credentials remain encrypted by the server.
begin;

create table if not exists public.google_calendar_connections (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  connected_by uuid references auth.users(id) on delete set null,
  google_subject text not null check (length(google_subject) between 1 and 255),
  google_email text not null check (length(google_email) between 1 and 320),
  calendar_id text not null check (length(calendar_id) between 1 and 1024),
  refresh_token_encrypted text not null check (length(refresh_token_encrypted) between 1 and 16384),
  scope text not null,
  status text not null default 'connected' check (status in ('connected','paused','reauth_required')),
  sync_from timestamptz not null default now(),
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_calendar_oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expected_email text not null check (length(expected_email) between 1 and 320),
  code_verifier text not null check (length(code_verifier) between 1 and 16384),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on column public.google_calendar_oauth_states.code_verifier is 'Server-encrypted OAuth PKCE verifier; never plaintext.';
create index if not exists google_calendar_oauth_states_expiry_idx
  on public.google_calendar_oauth_states(expires_at);

create table if not exists public.google_calendar_sync_queue (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Deliberately no appointment foreign key: deletion still needs a remote cleanup.
  appointment_id uuid not null,
  desired_version bigint not null default 1 check (desired_version > 0),
  synced_version bigint not null default 0 check (synced_version >= 0 and synced_version <= desired_version),
  appointment_deleted boolean not null default false,
  event_id text check (length(event_id) between 5 and 1024),
  event_generation integer not null default 0 check (event_generation >= 0),
  remote_deleted boolean not null default false,
  lease_token uuid,
  lease_version bigint,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,appointment_id),
  check ((lease_token is null and lease_version is null and lease_expires_at is null)
    or (lease_token is not null and lease_version > 0 and lease_expires_at is not null))
);
create index if not exists google_calendar_sync_queue_pending_idx
  on public.google_calendar_sync_queue(next_attempt_at,workspace_id)
  where desired_version > synced_version;

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth_states enable row level security;
alter table public.google_calendar_sync_queue enable row level security;
-- These tables intentionally have NO browser policies, including for owners.
do $private_tables$
begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename in
    ('google_calendar_connections','google_calendar_oauth_states','google_calendar_sync_queue')) then
    raise exception 'Unexpected Google Calendar table policy; review access before applying this migration.';
  end if;
end;
$private_tables$;
revoke all on public.google_calendar_connections, public.google_calendar_oauth_states,
  public.google_calendar_sync_queue from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.google_calendar_connections,
  public.google_calendar_oauth_states to service_role;
grant select on public.google_calendar_sync_queue to service_role;

create or replace function public.complete_google_calendar_connection(
  p_workspace_id uuid,p_user_id uuid,p_google_subject text,p_google_email text,p_calendar_id text,
  p_refresh_token_encrypted text,p_scope text
) returns boolean language plpgsql security definer set search_path='' set row_security=off as $connect$
declare
  v_active boolean;
  v_existing public.google_calendar_connections;
  v_email text := lower(trim(p_google_email));
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'Google Calendar connections are server-only.' using errcode='42501';
  end if;
  -- Serialize first connection as well as reconnects, before any external identity
  -- can be attached to the workspace. Two OAuth callbacks cannot retarget a queue.
  select w.active into v_active from public.workspaces w where w.id=p_workspace_id for update;
  if v_active is distinct from true or not exists (select 1 from public.workspace_members wm
    where wm.workspace_id=p_workspace_id and wm.user_id=p_user_id and wm.active and wm.role in ('owner','admin')) then
    raise exception 'An active workspace owner or administrator is required.' using errcode='42501';
  end if;
  select * into v_existing from public.google_calendar_connections c where c.workspace_id=p_workspace_id;
  if found and (v_existing.google_subject is distinct from p_google_subject
    or lower(v_existing.google_email) is distinct from v_email or v_existing.calendar_id is distinct from p_calendar_id) then
    raise exception 'The connected Google account or calendar cannot be replaced.' using errcode='22023';
  end if;
  if coalesce(nullif(p_refresh_token_encrypted,''),v_existing.refresh_token_encrypted) is null then
    raise exception 'Google Calendar offline authorization is required.' using errcode='22023';
  end if;
  insert into public.google_calendar_connections(workspace_id,connected_by,google_subject,google_email,calendar_id,
    refresh_token_encrypted,scope,status,sync_from,connected_at,updated_at)
  values(p_workspace_id,p_user_id,p_google_subject,v_email,p_calendar_id,
    coalesce(nullif(p_refresh_token_encrypted,''),v_existing.refresh_token_encrypted),p_scope,'connected',
    coalesce(v_existing.sync_from,clock_timestamp()),clock_timestamp(),clock_timestamp())
  on conflict(workspace_id) do update set connected_by=excluded.connected_by,
    refresh_token_encrypted=excluded.refresh_token_encrypted,scope=excluded.scope,status='connected',
    last_error=null,connected_at=excluded.connected_at,updated_at=excluded.updated_at;
  return true;
end;
$connect$;

create or replace function public.consume_google_calendar_oauth_state(p_state_hash text)
returns setof public.google_calendar_oauth_states
language plpgsql security definer set search_path='' set row_security=off as $consume$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'Google Calendar OAuth states are server-only.' using errcode='42501';
  end if;
  -- Expired states are consumed too, but never returned to the caller.
  return query with consumed as (
    delete from public.google_calendar_oauth_states s where s.state_hash=p_state_hash returning s.*
  ) select * from consumed where expires_at > clock_timestamp();
end;
$consume$;

-- Internal trigger helper. Not exposed even to service_role; the worker can only
-- claim rows produced by real scoped appointment/customer/quote writes.
create or replace function public.enqueue_google_calendar_appointment(
  p_workspace_id uuid,p_appointment_id uuid,p_created_at timestamptz,p_deleted boolean
) returns void language plpgsql security definer set search_path='' set row_security=off as $enqueue$
begin
  if pg_trigger_depth()=0 then
    raise exception 'Google Calendar work must originate from a saved appointment.' using errcode='42501';
  end if;
  if not exists (select 1 from public.google_calendar_connections c
    where c.workspace_id=p_workspace_id and (p_created_at >= c.sync_from or exists (
      select 1 from public.google_calendar_sync_queue q
      where q.workspace_id=p_workspace_id and q.appointment_id=p_appointment_id))) then
    return;
  end if;
  insert into public.google_calendar_sync_queue(workspace_id,appointment_id,appointment_deleted)
  values(p_workspace_id,p_appointment_id,p_deleted)
  on conflict(workspace_id,appointment_id) do update set
    desired_version=public.google_calendar_sync_queue.desired_version+1,
    appointment_deleted=excluded.appointment_deleted,
    next_attempt_at=clock_timestamp(),last_error=null,updated_at=clock_timestamp();
  -- Do not clear a lease here. The in-flight write records its outcome and leaves
  -- a newer desired version pending; a second worker must not overtake it.
end;
$enqueue$;

create or replace function public.queue_google_calendar_appointment_change()
returns trigger language plpgsql security definer set search_path='' set row_security=off as $appointment$
begin
  if tg_op='DELETE' then
    perform public.enqueue_google_calendar_appointment(old.workspace_id,old.id,old.created_at,true);
    return old;
  end if;
  if tg_op='UPDATE' and (to_jsonb(new)-'updated_at') is not distinct from (to_jsonb(old)-'updated_at') then
    return new;
  end if;
  if tg_op='UPDATE' and (new.workspace_id,new.id) is distinct from (old.workspace_id,old.id) then
    perform public.enqueue_google_calendar_appointment(old.workspace_id,old.id,old.created_at,true);
  end if;
  perform public.enqueue_google_calendar_appointment(new.workspace_id,new.id,new.created_at,false);
  return new;
end;
$appointment$;

create or replace function public.queue_google_calendar_related_change()
returns trigger language plpgsql security definer set search_path='' set row_security=off as $related$
declare
  v_old jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
  a record;
begin
  if tg_op='UPDATE' and (v_new-'updated_at') is not distinct from (v_old-'updated_at') then
    return new;
  end if;
  if tg_table_name='customers' then
    -- Names/contact/address and descriptive fields appear in the calendar.
    -- JSON field selection also tolerates older schemas without work_* columns.
    if (select jsonb_object_agg(key,value) from jsonb_each(v_new) where key in
      ('name','phone','email','city','postal_code','address','work_address','work_city','work_postal_code','need','notes'))
      is not distinct from
      (select jsonb_object_agg(key,value) from jsonb_each(v_old) where key in
      ('name','phone','email','city','postal_code','address','work_address','work_city','work_postal_code','need','notes')) then
      return new;
    end if;
    for a in select x.workspace_id,x.id,x.created_at from public.appointments x
      where (x.workspace_id=(v_new->>'workspace_id')::uuid and x.customer_id=(v_new->>'id')::uuid)
        or (x.workspace_id=(v_old->>'workspace_id')::uuid and x.customer_id=(v_old->>'id')::uuid)
    loop perform public.enqueue_google_calendar_appointment(a.workspace_id,a.id,a.created_at,false); end loop;
  elsif tg_table_name='quotes' then
    for a in select x.workspace_id,x.id,x.created_at from public.appointments x
      where (x.workspace_id=(v_new->>'workspace_id')::uuid and
        (x.quote_id=(v_new->>'id')::uuid or x.id=(v_new->>'appointment_id')::uuid))
        or (x.workspace_id=(v_old->>'workspace_id')::uuid and
        (x.quote_id=(v_old->>'id')::uuid or x.id=(v_old->>'appointment_id')::uuid))
    loop perform public.enqueue_google_calendar_appointment(a.workspace_id,a.id,a.created_at,false); end loop;
  elsif tg_table_name='quote_items' then
    for a in select distinct x.workspace_id,x.id,x.created_at from public.appointments x
      join public.quotes q on q.workspace_id=x.workspace_id and (q.id=x.quote_id or q.appointment_id=x.id)
      where (q.workspace_id=(v_new->>'workspace_id')::uuid and q.id=(v_new->>'quote_id')::uuid)
        or (q.workspace_id=(v_old->>'workspace_id')::uuid and q.id=(v_old->>'quote_id')::uuid)
    loop perform public.enqueue_google_calendar_appointment(a.workspace_id,a.id,a.created_at,false); end loop;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$related$;

drop trigger if exists google_calendar_appointment_change on public.appointments;
create trigger google_calendar_appointment_change after insert or update or delete on public.appointments
  for each row execute function public.queue_google_calendar_appointment_change();
drop trigger if exists google_calendar_customer_change on public.customers;
create trigger google_calendar_customer_change after update on public.customers
  for each row execute function public.queue_google_calendar_related_change();
drop trigger if exists google_calendar_quote_change on public.quotes;
create trigger google_calendar_quote_change after insert or update or delete on public.quotes
  for each row execute function public.queue_google_calendar_related_change();
drop trigger if exists google_calendar_quote_item_change on public.quote_items;
create trigger google_calendar_quote_item_change after insert or update or delete on public.quote_items
  for each row execute function public.queue_google_calendar_related_change();

create or replace function public.claim_google_calendar_sync(
  p_workspace_id uuid default null,p_limit integer default 10,p_lease_seconds integer default 120
) returns setof public.google_calendar_sync_queue
language plpgsql security definer set search_path='' set row_security=off as $claim$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'Google Calendar synchronization is server-only.' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 25 or p_lease_seconds is null or p_lease_seconds not between 30 and 300 then
    raise exception 'Invalid Google Calendar claim limits.' using errcode='22023';
  end if;
  return query with candidates as (
    select q.workspace_id,q.appointment_id from public.google_calendar_sync_queue q
    join public.google_calendar_connections c on c.workspace_id=q.workspace_id
    join public.workspaces w on w.id=q.workspace_id
    where (p_workspace_id is null or q.workspace_id=p_workspace_id)
      and c.status='connected' and w.active
      and q.desired_version>q.synced_version and q.next_attempt_at<=clock_timestamp()
      and (q.lease_expires_at is null or q.lease_expires_at<=clock_timestamp())
    order by q.next_attempt_at,q.created_at,q.appointment_id
    limit p_limit for update of q skip locked
  ) update public.google_calendar_sync_queue q set
    lease_token=gen_random_uuid(),lease_version=q.desired_version,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    attempts=q.attempts+1,updated_at=clock_timestamp()
  from candidates c where q.workspace_id=c.workspace_id and q.appointment_id=c.appointment_id
  returning q.*;
end;
$claim$;

create or replace function public.finish_google_calendar_sync(
  p_workspace_id uuid,p_appointment_id uuid,p_lease_token uuid,p_version bigint,
  p_success boolean,p_event_id text,p_event_generation integer,p_remote_deleted boolean,
  p_error text default null,p_retry_after_seconds integer default 60
) returns boolean language plpgsql security definer set search_path='' set row_security=off as $finish$
declare v_count integer;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'Google Calendar synchronization is server-only.' using errcode='42501';
  end if;
  if p_success is null or p_remote_deleted is null or p_event_generation is null or p_event_generation<0
    or p_retry_after_seconds is null or p_retry_after_seconds not between 0 and 86400 then
    raise exception 'Invalid Google Calendar completion.' using errcode='22023';
  end if;
  update public.google_calendar_sync_queue q set
    synced_version=case when p_success then p_version else q.synced_version end,
    event_id=p_event_id,event_generation=p_event_generation,remote_deleted=p_remote_deleted,
    lease_token=null,lease_version=null,lease_expires_at=null,
    attempts=case when p_success then 0 else q.attempts end,
    next_attempt_at=case when p_success or q.desired_version>p_version then clock_timestamp()
      else clock_timestamp()+make_interval(secs=>p_retry_after_seconds) end,
    last_error=case when p_success then null else left(coalesce(p_error,'Google Calendar sync failed.'),1000) end,
    last_synced_at=case when p_success then clock_timestamp() else q.last_synced_at end,
    updated_at=clock_timestamp()
  where q.workspace_id=p_workspace_id and q.appointment_id=p_appointment_id
    and q.lease_token=p_lease_token and q.lease_version=p_version
    and p_event_generation>=q.event_generation;
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$finish$;

create or replace function public.google_calendar_sync_status(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $status$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'Google Calendar synchronization status is server-only.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'pending_count',(select count(*) from public.google_calendar_sync_queue q
      where q.workspace_id=p_workspace_id and q.desired_version>q.synced_version),
    'last_error',(select q.last_error from public.google_calendar_sync_queue q
      where q.workspace_id=p_workspace_id and q.last_error is not null order by q.updated_at desc limit 1),
    'managed_appointment_ids',coalesce((select jsonb_agg(q.appointment_id order by q.appointment_id)
      from public.google_calendar_sync_queue q where q.workspace_id=p_workspace_id),'[]'::jsonb)
  );
end;
$status$;

revoke all on function public.consume_google_calendar_oauth_state(text),
  public.complete_google_calendar_connection(uuid,uuid,text,text,text,text,text),
  public.enqueue_google_calendar_appointment(uuid,uuid,timestamptz,boolean),
  public.queue_google_calendar_appointment_change(),public.queue_google_calendar_related_change(),
  public.claim_google_calendar_sync(uuid,integer,integer),public.google_calendar_sync_status(uuid),
  public.finish_google_calendar_sync(uuid,uuid,uuid,bigint,boolean,text,integer,boolean,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.consume_google_calendar_oauth_state(text),
  public.complete_google_calendar_connection(uuid,uuid,text,text,text,text,text),
  public.claim_google_calendar_sync(uuid,integer,integer),public.google_calendar_sync_status(uuid),
  public.finish_google_calendar_sync(uuid,uuid,uuid,bigint,boolean,text,integer,boolean,text,integer)
  to service_role;

commit;
