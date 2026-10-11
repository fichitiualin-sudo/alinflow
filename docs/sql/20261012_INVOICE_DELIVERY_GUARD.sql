-- Additive invoice guard. Run before deploying the guarded invoice endpoint.
-- Never delete/reset uncertain rows without checking the issuer's invoice log.
begin;

do $preflight$
declare signature text; function_oid oid;
begin
  if to_regclass('public.invoice_deliveries') is not null
    and obj_description(to_regclass('public.invoice_deliveries'),'pg_class')
      is distinct from 'AlinFlow invoice delivery guard v1' then
    raise exception 'Ismeretlen invoice_deliveries tábla; ellenőrzés szükséges.';
  end if;
  foreach signature in array array[
    'public.claim_invoice_delivery(uuid,uuid,uuid,text,uuid)',
    'public.finish_invoice_delivery(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean)'
  ] loop
    function_oid := to_regprocedure(signature);
    if function_oid is not null and obj_description(function_oid,'pg_proc')
      is distinct from 'AlinFlow invoice RPC v1|' || md5(pg_get_functiondef(function_oid)) then
      raise exception 'Ismeretlen vagy módosított számlázási függvény: %',signature;
    end if;
  end loop;
end;
$preflight$;

create table if not exists public.invoice_deliveries (
  workspace_id uuid not null references public.workspaces(id),
  customer_id uuid not null,
  appointment_id uuid,
  scope_key text not null,
  invoice_kind text not null check(invoice_kind in ('device','labor','maintenance','combined')),
  state text not null check(state in ('processing','confirmed','uncertain','rejected')),
  claim_token uuid not null,
  requested_by uuid not null,
  lease_expires_at timestamptz not null,
  invoice_number text,
  net_amount text,
  gross_amount text,
  email_sent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(workspace_id,customer_id,scope_key,invoice_kind),
  check(scope_key = case when appointment_id is null then 'customer' else 'appointment:' || appointment_id::text end),
  check(state <> 'confirmed' or coalesce(btrim(invoice_number),'') <> '')
);
comment on table public.invoice_deliveries is 'AlinFlow invoice delivery guard v1';
alter table public.invoice_deliveries enable row level security;
revoke all on public.invoice_deliveries from public,anon,authenticated,service_role;
grant select on public.invoice_deliveries to service_role;

create or replace function public.claim_invoice_delivery(
  p_workspace_id uuid,p_customer_id uuid,p_appointment_id uuid,p_invoice_kind text,p_requested_by uuid
)
returns jsonb language plpgsql security definer set search_path='' set row_security=off
as $claim$
declare
  delivery public.invoice_deliveries%rowtype;
  token uuid := gen_random_uuid();
  work_scope text := case when p_appointment_id is null then 'customer' else 'appointment:' || p_appointment_id::text end;
  recorded boolean;
  overlapping public.invoice_deliveries%rowtype;
begin
  if p_invoice_kind is null or p_invoice_kind not in ('device','labor','maintenance','combined') then
    raise exception 'Érvénytelen számlatípus.' using errcode='22023';
  end if;
  if not exists(select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id
    where m.workspace_id=p_workspace_id and m.user_id=p_requested_by and m.active and w.active) then
    raise exception 'A számlázási munkaterület nem érhető el.' using errcode='42501';
  end if;
  -- Serializes initial claims without requiring an invoice row to exist yet.
  perform 1 from public.customers c where c.workspace_id=p_workspace_id and c.id=p_customer_id for update;
  if not found then raise exception 'Az ügyfél nem érhető el.' using errcode='42501'; end if;
  if p_appointment_id is not null and not exists(select 1 from public.appointments a
    where a.workspace_id=p_workspace_id and a.customer_id=p_customer_id and a.id=p_appointment_id) then
    raise exception 'Az időpont nem ehhez az ügyfélhez tartozik.' using errcode='42501';
  end if;
  select d.* into delivery from public.invoice_deliveries d
    where d.workspace_id=p_workspace_id and d.customer_id=p_customer_id
      and d.scope_key=work_scope and d.invoice_kind=p_invoice_kind for update;
  if found then
    if delivery.state='confirmed' then
      return jsonb_build_object('status','confirmed','invoice_number',delivery.invoice_number,
        'net_amount',delivery.net_amount,'gross_amount',delivery.gross_amount,'email_sent',delivery.email_sent);
    end if;
    if delivery.state='processing' and delivery.lease_expires_at>now() then
      return jsonb_build_object('status','busy');
    end if;
    if delivery.state in ('processing','uncertain') then
      return jsonb_build_object('status','needs_review');
    end if;
  end if;
  -- Combined includes both the device and labor charge. Changing the UI's
  -- billing mode must not create overlapping invoices, even before the client
  -- has saved its checklist. The customer lock also serializes different kinds.
  select d.* into overlapping from public.invoice_deliveries d
    where d.workspace_id=p_workspace_id and d.customer_id=p_customer_id and d.scope_key=work_scope
      and d.state<>'rejected'
      and ((p_invoice_kind='combined' and d.invoice_kind in ('device','labor'))
        or (p_invoice_kind in ('device','labor') and d.invoice_kind='combined'))
    order by case when d.state='confirmed' then 0 when d.state='uncertain' then 1 else 2 end
    limit 1;
  if found then
    if overlapping.state='confirmed' then return jsonb_build_object('status','already_recorded'); end if;
    if overlapping.state='processing' and overlapping.lease_expires_at>now() then
      return jsonb_build_object('status','busy');
    end if;
    return jsonb_build_object('status','needs_review');
  end if;
  -- Protect invoices issued before this ledger was introduced. Do not invent a
  -- receipt or change an existing checklist if its invoice number is unknown.
  select exists(select 1 from public.work_checklists c
    where c.workspace_id=p_workspace_id and c.customer_id=p_customer_id
      and c.appointment_id is not distinct from p_appointment_id
      and case when p_invoice_kind='device' then c.amova_invoice
        when p_invoice_kind='combined' then c.amova_invoice or c.alin_invoice
        else c.alin_invoice end) into recorded;
  if recorded then return jsonb_build_object('status','already_recorded'); end if;

  insert into public.invoice_deliveries(workspace_id,customer_id,appointment_id,scope_key,invoice_kind,
    state,claim_token,requested_by,lease_expires_at)
  values(p_workspace_id,p_customer_id,p_appointment_id,work_scope,p_invoice_kind,
    'processing',token,p_requested_by,now()+interval '2 minutes')
  on conflict(workspace_id,customer_id,scope_key,invoice_kind) do update set
    state='processing',claim_token=token,requested_by=p_requested_by,lease_expires_at=now()+interval '2 minutes',
    updated_at=now();
  return jsonb_build_object('status','send','claim_token',token);
end;
$claim$;

create or replace function public.finish_invoice_delivery(
  p_workspace_id uuid,p_customer_id uuid,p_appointment_id uuid,p_invoice_kind text,p_claim_token uuid,
  p_outcome text,p_invoice_number text,p_net_amount text,p_gross_amount text,p_email_sent boolean
)
returns jsonb language plpgsql security definer set search_path='' set row_security=off
as $finish$
declare
  delivery public.invoice_deliveries%rowtype;
  work_scope text := case when p_appointment_id is null then 'customer' else 'appointment:' || p_appointment_id::text end;
begin
  select d.* into delivery from public.invoice_deliveries d
    where d.workspace_id=p_workspace_id and d.customer_id=p_customer_id
      and d.scope_key=work_scope and d.invoice_kind=p_invoice_kind for update;
  if not found or p_claim_token is null or delivery.claim_token<>p_claim_token then
    raise exception 'A számlázási kísérlet már nem aktuális.' using errcode='42501';
  end if;
  if delivery.state='confirmed' then return jsonb_build_object('status','confirmed'); end if;
  if p_outcome is null or p_outcome not in ('confirmed','uncertain','rejected')
    or (p_outcome='confirmed' and coalesce(btrim(p_invoice_number),'')='') then
    raise exception 'Érvénytelen számlázási eredmény.' using errcode='22023';
  end if;
  -- A previously uncertain result cannot later be reopened by a rejection.
  if delivery.state='uncertain' and p_outcome='rejected' then
    return jsonb_build_object('status','uncertain');
  end if;
  update public.invoice_deliveries d set state=p_outcome,updated_at=now(),
    invoice_number=case when p_outcome='confirmed' then left(p_invoice_number,200) else null end,
    net_amount=case when p_outcome='confirmed' then left(p_net_amount,100) else null end,
    gross_amount=case when p_outcome='confirmed' then left(p_gross_amount,100) else null end,
    email_sent=p_outcome='confirmed' and coalesce(p_email_sent,false)
    where d.workspace_id=p_workspace_id and d.customer_id=p_customer_id
      and d.scope_key=work_scope and d.invoice_kind=p_invoice_kind;
  return jsonb_build_object('status',p_outcome);
end;
$finish$;

revoke all on function public.claim_invoice_delivery(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.finish_invoice_delivery(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_invoice_delivery(uuid,uuid,uuid,text,uuid) to service_role;
grant execute on function public.finish_invoice_delivery(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean) to service_role;
do $comments$
declare signature text;
begin
  foreach signature in array array[
    'public.claim_invoice_delivery(uuid,uuid,uuid,text,uuid)',
    'public.finish_invoice_delivery(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean)'
  ] loop
    execute format('comment on function %s is %L',signature,
      'AlinFlow invoice RPC v1|'||md5(pg_get_functiondef(to_regprocedure(signature))));
  end loop;
end;
$comments$;
commit;
