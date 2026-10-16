-- Explicit, immutable member groups for Google Contacts. No CRM merge or export.
-- Apply after GOOGLE_CONTACTS_SYNC.sql. Safe to re-run; existing links are untouched.
begin;
create table if not exists public.google_contacts_link_members (
  workspace_id uuid not null,
  customer_id uuid not null,
  anchor_customer_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(workspace_id,customer_id),
  foreign key(workspace_id,anchor_customer_id) references public.google_contacts_links(workspace_id,customer_id) on delete cascade
);
-- No customer FK: retain the complete approved identity if a CRM source disappears.
create index if not exists google_contacts_link_members_anchor_idx on public.google_contacts_link_members(workspace_id,anchor_customer_id);
alter table public.google_contacts_link_members enable row level security;
do $private$
begin
  if exists(select 1 from pg_policies where schemaname='public' and tablename='google_contacts_link_members') then
    raise exception 'Unexpected Google Contacts membership browser policy; review before migration.';
  end if;
end;
$private$;
revoke all on public.google_contacts_link_members from public,anon,authenticated,service_role;
grant select on public.google_contacts_link_members to service_role;
comment on table public.google_contacts_link_members is 'Explicit owner-approved same-person export groups. Immutable membership; original CRM records remain separate.';
comment on column public.google_contacts_previews.proofs is 'Expiring source hashes, permitted remote IDs and explicitly selected group member IDs; no contact names or phone numbers.';

create or replace function public.approve_google_contacts_links(p_workspace_id uuid,p_user_id uuid,p_preview_id uuid,p_items jsonb)
returns integer language plpgsql security definer set search_path='' set row_security=off as $approve$
declare
 v_connection public.google_contacts_connections; v_preview public.google_contacts_previews;
 v_item jsonb; v_proof jsonb; v_anchor uuid; v_ids uuid[]; v_existing_ids uuid[];
 v_link public.google_contacts_links; v_count integer:=0; v_written integer; v_group boolean;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'Server-only.' using errcode='42501'; end if;
  if not exists(select 1 from public.workspaces w join public.workspace_members m on m.workspace_id=w.id
    where w.id=p_workspace_id and w.active and m.user_id=p_user_id and m.active and m.role in ('owner','admin')) then
    raise exception 'Active owner or administrator required.' using errcode='42501';
  end if;
  -- Serializes all singleton and grouped approvals for this Google account.
  select * into v_connection from public.google_contacts_connections where workspace_id=p_workspace_id for update;
  if not found or v_connection.status<>'active' then raise exception 'Active connection required.' using errcode='22023'; end if;
  select * into v_preview from public.google_contacts_previews where id=p_preview_id and workspace_id=p_workspace_id and user_id=p_user_id for update;
  if not found or v_preview.expires_at<=clock_timestamp() or v_preview.google_subject<>v_connection.google_subject then raise exception 'Refresh preview.' using errcode='22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 10 then raise exception 'Invalid selection.' using errcode='22023'; end if;
  if (select count(distinct value->>'customerId') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Repeated selection.' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    select value into v_proof from jsonb_array_elements(v_preview.proofs) where value->>'customerId'=v_item->>'customerId';
    if v_proof is null or v_proof->>'sourceHash' is distinct from v_item->>'sourceHash'
      or not exists(select 1 from jsonb_array_elements(v_proof->'options') o where o.value is not distinct from coalesce(v_item->'resourceName','null'::jsonb)) then
      raise exception 'Selection was not reviewed.' using errcode='22023';
    end if;
    v_anchor:=(v_item->>'customerId')::uuid;
    v_group:=v_proof ? 'memberCustomerIds';
    if v_group then
      if jsonb_typeof(v_proof->'memberCustomerIds') is distinct from 'array' or jsonb_array_length(v_proof->'memberCustomerIds') not between 2 and 10 then
        raise exception 'Invalid group size.' using errcode='22023';
      end if;
      select array_agg(value::uuid order by value::uuid) into v_ids from jsonb_array_elements_text(v_proof->'memberCustomerIds');
      if not (v_anchor=any(v_ids)) or (select count(distinct id) from unnest(v_ids) id)<>cardinality(v_ids) then
        raise exception 'Invalid group members.' using errcode='22023';
      end if;
      -- Recheck workspace and own-installation boundary inside the atomic write.
      if (select count(*) from public.customers c where c.workspace_id=p_workspace_id and c.id=any(v_ids)
        and exists(select 1 from public.appointments a where a.workspace_id=p_workspace_id and a.customer_id=c.id
          and a.appointment_type='installation' and (a.maintenance_origin='own' or a.maintenance_origin is null)
          and a.cancelled_at is null and a.status in ('Lezárva','Szerelés kész – admin folyamatban')
          and a.scheduled_date<=(clock_timestamp() at time zone 'Europe/Budapest')::date
          and not exists(select 1 from public.shared_maintenance_handoffs h where h.target_workspace_id=p_workspace_id and h.target_installation_id=a.id)))<>cardinality(v_ids) then
        raise exception 'All group members require an own completed installation.' using errcode='22023';
      end if;
      if exists(select 1 from public.google_contacts_link_members where workspace_id=p_workspace_id and customer_id=any(v_ids) and anchor_customer_id<>v_anchor)
        or exists(select 1 from public.google_contacts_links where workspace_id=p_workspace_id and customer_id=any(v_ids) and customer_id<>v_anchor) then
        raise exception 'A group member is already linked.' using errcode='22023';
      end if;
      select * into v_link from public.google_contacts_links where workspace_id=p_workspace_id and customer_id=v_anchor for update;
      if found then
        select array_agg(customer_id order by customer_id) into v_existing_ids from public.google_contacts_link_members where workspace_id=p_workspace_id and anchor_customer_id=v_anchor;
        if v_existing_ids is distinct from v_ids or v_link.state<>'review' or v_link.managed_snapshot is not null
          or v_link.synced_source_hash is not null or v_link.mutation_snapshot is not null or v_link.mutation_payload is not null then
          raise exception 'Existing groups cannot be changed or re-enrolled.' using errcode='22023';
        end if;
        update public.google_contacts_links set resource_name=v_item->>'resourceName',approved_source_hash=v_item->>'sourceHash',
          approved_by=p_user_id,approved_at=clock_timestamp(),state='pending',last_error=null,next_sync_at=clock_timestamp(),updated_at=clock_timestamp()
          where workspace_id=p_workspace_id and customer_id=v_anchor;
      else
        insert into public.google_contacts_links(workspace_id,customer_id,resource_name,approved_source_hash,approved_by)
          values(p_workspace_id,v_anchor,v_item->>'resourceName',v_item->>'sourceHash',p_user_id);
        insert into public.google_contacts_link_members(workspace_id,customer_id,anchor_customer_id)
          select p_workspace_id,id,v_anchor from unnest(v_ids) id;
      end if;
    else
      if exists(select 1 from public.google_contacts_link_members where workspace_id=p_workspace_id and customer_id=v_anchor) then
        raise exception 'This customer belongs to an approved group.' using errcode='22023';
      end if;
      insert into public.google_contacts_links(workspace_id,customer_id,resource_name,approved_source_hash,approved_by)
        values(p_workspace_id,v_anchor,v_item->>'resourceName',v_item->>'sourceHash',p_user_id)
      on conflict(workspace_id,customer_id) do update set resource_name=excluded.resource_name,
        approved_source_hash=excluded.approved_source_hash,approved_by=excluded.approved_by,approved_at=clock_timestamp(),
        state='pending',last_error=null,next_sync_at=clock_timestamp(),updated_at=clock_timestamp()
        where google_contacts_links.state='review' and google_contacts_links.managed_snapshot is null
          and google_contacts_links.synced_source_hash is null and google_contacts_links.mutation_snapshot is null
          and google_contacts_links.mutation_payload is null;
      get diagnostics v_written=row_count;
      if v_written<>1 then raise exception 'This customer is already linked.' using errcode='22023'; end if;
    end if;
    v_count:=v_count+1;
  end loop;
  delete from public.google_contacts_previews where id=p_preview_id;
  return v_count;
end;
$approve$;
revoke all on function public.approve_google_contacts_links(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.approve_google_contacts_links(uuid,uuid,uuid,jsonb) to service_role;
commit;
