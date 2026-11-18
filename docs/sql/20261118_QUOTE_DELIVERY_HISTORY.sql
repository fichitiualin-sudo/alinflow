-- Durable snapshots of the offers actually submitted to the email provider.
-- Existing quotes and installation links remain the editable work records.
begin;

create table if not exists public.quote_delivery_history (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  created_at timestamptz not null default now(),
  issued_at timestamptz not null,
  sent_at timestamptz,
  recipient text not null,
  pricing_mode text not null check (pricing_mode in ('bundle','alternatives')),
  items jsonb not null check (jsonb_typeof(items)='array'),
  total_amount numeric not null,
  provider_key text not null unique,
  provider_id text,
  email_payload text not null,
  check ((provider_id is null) = (sent_at is null))
);
create index if not exists quote_delivery_history_customer_idx
  on public.quote_delivery_history(workspace_id, customer_id, sent_at desc, id) where sent_at is not null;
alter table public.quote_delivery_history enable row level security;
revoke all on public.quote_delivery_history from public, anon, authenticated, service_role;
grant select(id,workspace_id,customer_id,appointment_id,quote_id,created_at,issued_at,sent_at,recipient,pricing_mode,items,total_amount)
  on public.quote_delivery_history to authenticated;
grant select, insert, update(sent_at,provider_id) on public.quote_delivery_history to service_role;
drop policy if exists read_sent_quotes on public.quote_delivery_history;
create policy read_sent_quotes on public.quote_delivery_history for select to authenticated
  using(sent_at is not null and public.active_workspace_member(workspace_id)
    and exists(select 1 from public.customers c where c.id=customer_id and c.workspace_id=quote_delivery_history.workspace_id));

-- Only the authenticated API route can use the service role to freeze or confirm
-- a delivery. Never accept a browser's assertion that a provider sent an email.
create or replace function public.prepare_quote_delivery(
  p_id uuid,p_workspace_id uuid,p_customer_id uuid,p_appointment_id uuid,p_quote_id uuid,p_user_id uuid,
  p_issued_at timestamptz,p_recipient text,p_pricing_mode text,p_items jsonb,p_total_amount numeric,
  p_provider_key text,p_email_payload text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare row_data public.quote_delivery_history%rowtype;
begin
  if not exists(select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id
    join public.customers c on c.workspace_id=w.id where m.workspace_id=p_workspace_id and m.user_id=p_user_id
    and m.active and w.active and c.id=p_customer_id and lower(trim(c.email))=lower(trim(p_recipient))) then
    raise exception 'Invalid quote delivery scope' using errcode='42501';
  end if;
  if p_appointment_id is not null and not exists(select 1 from public.appointments a where a.id=p_appointment_id
    and a.workspace_id=p_workspace_id and a.customer_id=p_customer_id) then
    raise exception 'Invalid quote appointment' using errcode='42501';
  end if;
  if p_quote_id is not null and not exists(select 1 from public.quotes q where q.id=p_quote_id
    and q.workspace_id=p_workspace_id and q.customer_id=p_customer_id
    and (q.appointment_id is null or q.appointment_id=p_appointment_id)) then
    raise exception 'Invalid quote identity' using errcode='42501';
  end if;
  insert into public.quote_delivery_history(id,workspace_id,customer_id,appointment_id,quote_id,issued_at,recipient,
    pricing_mode,items,total_amount,provider_key,email_payload)
  values(p_id,p_workspace_id,p_customer_id,p_appointment_id,p_quote_id,p_issued_at,p_recipient,
    p_pricing_mode,p_items,p_total_amount,p_provider_key,p_email_payload)
  on conflict(id) do nothing;
  select * into strict row_data from public.quote_delivery_history where id=p_id;
  if row_data.workspace_id<>p_workspace_id or row_data.customer_id<>p_customer_id
    or row_data.appointment_id is distinct from p_appointment_id or row_data.quote_id is distinct from p_quote_id
    or row_data.provider_key<>p_provider_key or row_data.recipient<>p_recipient or row_data.issued_at<>p_issued_at
    or row_data.pricing_mode<>p_pricing_mode or row_data.items<>p_items or row_data.total_amount<>p_total_amount
    or row_data.email_payload<>p_email_payload then
    raise exception 'Delivery identity is already bound to different content' using errcode='23505';
  end if;
  if row_data.sent_at is not null then
    return jsonb_build_object('state','sent','provider_id',row_data.provider_id,'sent_at',row_data.sent_at);
  end if;
  -- Resend guarantees a key for 24h. An old unresolved operation must never
  -- replay outside that window, including after a failed confirmation write.
  if row_data.created_at<now()-interval '23 hours' then return jsonb_build_object('state','expired'); end if;
  return jsonb_build_object('state','ready');
end;
$$;

create or replace function public.confirm_quote_delivery(p_id uuid,p_workspace_id uuid,p_customer_id uuid,p_provider_id text)
returns timestamptz language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare
  recorded timestamptz;
  standalone boolean;
begin
  if nullif(trim(p_provider_id),'') is null then raise exception 'Invalid provider confirmation'; end if;
  update public.quote_delivery_history set sent_at=now(),provider_id=p_provider_id
  where id=p_id and workspace_id=p_workspace_id and customer_id=p_customer_id and sent_at is null
  returning sent_at, (quote_id is null and appointment_id is null) into recorded,standalone;
  if not found then
    select h.sent_at into strict recorded from public.quote_delivery_history h
    where h.id=p_id and h.workspace_id=p_workspace_id and h.customer_id=p_customer_id and h.provider_id=p_provider_id;
  elsif standalone then
    update public.customers c set status='Ajánlat elküldve', updated_at=recorded
    where c.id=p_customer_id and c.workspace_id=p_workspace_id and c.status='Visszahívandó'
      and not exists(select 1 from public.appointments a where a.customer_id=c.id and a.workspace_id=c.workspace_id
        and a.cancelled_at is null and a.status is distinct from 'Lezárva' and a.status is distinct from 'Lemondva');
  end if;
  return recorded;
end;
$$;
revoke all on function public.prepare_quote_delivery(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,numeric,text,text),
  public.confirm_quote_delivery(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_quote_delivery(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,numeric,text,text),
  public.confirm_quote_delivery(uuid,uuid,uuid,text) to service_role;
commit;
