-- Telepítésenként egyszeri, teljes lezárás utáni köszönő email.
-- Előtte adatmentés és olvasási sémaaudit szükséges. A migráció nem küld
-- emailt, és nem állít sorba régi munkákat. Ismételten futtatható.
-- A szolgáltatói Idempotency-Key 24 óráig él; ismeretlen eredménynél a
-- biztonságos automatikus újrapróbálási ablak ezért legfeljebb 23 óra.
-- https://resend.com/docs/dashboard/emails/idempotency-keys
begin;

do $table_setup$
declare
  ddl constant text := $ddl$
    create table public.installation_thank_you_deliveries (
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      customer_id uuid not null references public.customers(id) on delete cascade,
      appointment_id uuid not null references public.appointments(id) on delete cascade,
      state text not null check (state in ('sending','sent','failed','uncertain')),
      payload_text text not null check (octet_length(payload_text) between 2 and 500000),
      payload_signature text not null check (payload_signature ~ '^[0-9a-f]{64}$'),
      idempotency_key text not null unique,
      claim_token uuid not null,
      claimed_by uuid not null,
      first_attempt_at timestamptz not null,
      lease_expires_at timestamptz not null,
      sent_at timestamptz,
      provider_id text,
      last_error text,
      updated_at timestamptz not null default now(),
      primary key (workspace_id, appointment_id)
    )
  $ddl$;
  existed boolean := to_regclass('public.installation_thank_you_deliveries') is not null;
  fingerprint text;
  expected_comment text;
begin
  if to_regclass('public.documents') is null or to_regclass('public.appointments') is null
    or to_regclass('public.workspace_members') is null then
    raise exception 'Köszönő email: hiányzó munkaterület/időpont séma. Audit szükséges.';
  end if;
  if not existed then execute ddl; end if;
  select md5(string_agg(entry,E'\n' order by entry)) into fingerprint from (
    select concat_ws('|',a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
      pg_get_expr(d.adbin,d.adrelid)) entry from pg_attribute a
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.installation_thank_you_deliveries'::regclass and a.attnum>0 and not a.attisdropped
    union all select concat_ws('|',c.conname,pg_get_constraintdef(c.oid),c.convalidated)
    from pg_constraint c where c.conrelid='public.installation_thank_you_deliveries'::regclass
  ) fields;
  expected_comment := 'AlinFlow installation thank you v1|' || md5(regexp_replace(ddl,'\s+',' ','g')) || '|' || fingerprint;
  if existed and obj_description('public.installation_thank_you_deliveries'::regclass,'pg_class') is distinct from expected_comment then
    raise exception 'Köszönő email: eltérő vagy ismeretlen küldési napló. Nem írtuk felül; audit szükséges.';
  end if;
  if not existed then execute format('comment on table public.installation_thank_you_deliveries is %L',expected_comment); end if;
end;
$table_setup$;

alter table public.installation_thank_you_deliveries enable row level security;
revoke all on public.installation_thank_you_deliveries from public,anon,authenticated;

do $rpc_collision$
declare function_name text; function_oid oid;
begin
  foreach function_name in array array[
    'public.claim_installation_thank_you(uuid,uuid,uuid,text,text)',
    'public.finish_installation_thank_you(uuid,uuid,uuid,uuid,text,text,text)'
  ] loop
    function_oid := to_regprocedure(function_name);
    if function_oid is not null and obj_description(function_oid,'pg_proc')
      is distinct from 'AlinFlow installation thank you RPC v1|' || md5(pg_get_functiondef(function_oid)) then
      raise exception 'Köszönő email: eltérő vagy ismeretlen függvény: %. Audit szükséges.',function_name;
    end if;
  end loop;
end;
$rpc_collision$;

create or replace function public.claim_installation_thank_you(
  p_workspace_id uuid,p_customer_id uuid,p_appointment_id uuid,p_payload_text text,p_payload_signature text
)
returns jsonb language plpgsql security definer set search_path='' set row_security=off
as $claim$
declare
  work public.appointments%rowtype;
  delivery public.installation_thank_you_deliveries%rowtype;
  previous_sent timestamptz;
  customer_email text;
  token uuid := gen_random_uuid();
  resuming boolean := false;
begin
  if auth.uid() is null or not exists(select 1 from public.workspace_members wm
    where wm.workspace_id=p_workspace_id and wm.user_id=auth.uid() and wm.active) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  select a.* into work from public.appointments a
    where a.id=p_appointment_id and a.workspace_id=p_workspace_id and a.customer_id=p_customer_id for update;
  if not found or work.appointment_type <> 'installation' or work.status <> 'Lezárva' then
    raise exception 'Köszönő email csak a teljesen lezárt telepítéshez küldhető.' using errcode='22023';
  end if;
  select c.email into customer_email from public.customers c where c.id=p_customer_id and c.workspace_id=p_workspace_id;
  if not found then raise exception 'Az ügyfél nem ehhez a munkaterülethez tartozik.' using errcode='42501'; end if;

  -- A korábban kézzel, ehhez a konkrét időponthoz naplózott email is számít.
  select min(d.sent_at) into previous_sent from public.documents d
    where d.workspace_id=p_workspace_id and d.customer_id=p_customer_id and d.appointment_id=p_appointment_id
      and d.document_type='thank_you_email' and d.status='Elküldve' and d.sent_at is not null;
  if previous_sent is not null then
    return jsonb_build_object('status','already_sent','sent_at',previous_sent);
  end if;

  select d.* into delivery from public.installation_thank_you_deliveries d
    where d.workspace_id=p_workspace_id and d.appointment_id=p_appointment_id for update;
  if found then
    if delivery.customer_id <> p_customer_id then raise exception 'Eltérő küldési hatókör.' using errcode='42501'; end if;
    if delivery.state='sent' then
      return jsonb_build_object('status','already_sent','sent_at',delivery.sent_at,'provider_id',delivery.provider_id);
    end if;
    if delivery.state='sending' and delivery.lease_expires_at>now() then
      return jsonb_build_object('status','busy');
    end if;
    if delivery.state in ('sending','uncertain') and delivery.first_attempt_at <= now()-interval '23 hours' then
      return jsonb_build_object('status','needs_review');
    end if;
  end if;

  if delivery.workspace_id is null or delivery.state='failed' then
    if p_payload_text is null or octet_length(p_payload_text)>500000 or p_payload_signature is null
      or p_payload_signature !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_payload_text::jsonb->'to') <> 'array'
      or jsonb_array_length(p_payload_text::jsonb->'to') <> 1
      or lower(btrim(p_payload_text::jsonb->'to'->>0)) is distinct from lower(btrim(customer_email))
      or coalesce(btrim(customer_email),'')='' then
      raise exception 'Az email címzettje nem egyezik a mentett ügyféllel.' using errcode='22023';
    end if;
    insert into public.installation_thank_you_deliveries as d
      (workspace_id,customer_id,appointment_id,state,payload_text,payload_signature,idempotency_key,claim_token,claimed_by,first_attempt_at,lease_expires_at)
    values(p_workspace_id,p_customer_id,p_appointment_id,'sending',p_payload_text,p_payload_signature,
      'alinflow-thank-you/'||p_workspace_id::text||'/'||p_appointment_id::text||'/'||token::text,token,auth.uid(),now(),now()+interval '2 minutes')
    on conflict(workspace_id,appointment_id) do update set state='sending',payload_text=excluded.payload_text,
      payload_signature=excluded.payload_signature,idempotency_key=excluded.idempotency_key,claim_token=token,claimed_by=auth.uid(),
      first_attempt_at=now(),lease_expires_at=now()+interval '2 minutes',last_error=null,updated_at=now()
    returning d.* into delivery;
  else
    resuming := true;
    update public.installation_thank_you_deliveries d set state='sending',claim_token=token,claimed_by=auth.uid(),
      lease_expires_at=now()+interval '2 minutes',updated_at=now()
      where d.workspace_id=p_workspace_id and d.appointment_id=p_appointment_id returning d.* into delivery;
  end if;
  return jsonb_build_object('status','send','claim_token',delivery.claim_token,'idempotency_key',delivery.idempotency_key,
    'payload_text',delivery.payload_text,'payload_signature',delivery.payload_signature,'resuming',resuming);
end;
$claim$;

create or replace function public.finish_installation_thank_you(
  p_workspace_id uuid,p_customer_id uuid,p_appointment_id uuid,p_claim_token uuid,p_outcome text,p_provider_id text,p_error text
)
returns jsonb language plpgsql security definer set search_path='' set row_security=off
as $finish$
declare delivery public.installation_thank_you_deliveries%rowtype; stamp timestamptz:=now();
begin
  if auth.uid() is null or not exists(select 1 from public.workspace_members wm
    where wm.workspace_id=p_workspace_id and wm.user_id=auth.uid() and wm.active) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  select d.* into delivery from public.installation_thank_you_deliveries d
    where d.workspace_id=p_workspace_id and d.customer_id=p_customer_id and d.appointment_id=p_appointment_id for update;
  if not found or delivery.claim_token<>p_claim_token or delivery.claimed_by<>auth.uid() then
    raise exception 'A küldési kísérlet már nem aktuális.' using errcode='42501';
  end if;
  if delivery.state='sent' then return jsonb_build_object('sent_at',delivery.sent_at); end if;
  if p_outcome not in ('sent','failed','uncertain') or p_outcome is null
    or (p_outcome='sent' and coalesce(btrim(p_provider_id),'')='') then
    raise exception 'Hiányzó vagy hibás küldési eredmény.' using errcode='22023';
  end if;
  update public.installation_thank_you_deliveries d set state=p_outcome,lease_expires_at=now(),
    provider_id=case when p_outcome='sent' then left(p_provider_id,200) else d.provider_id end,
    sent_at=case when p_outcome='sent' then stamp else null end,last_error=left(p_error,1000),updated_at=now()
    where d.workspace_id=p_workspace_id and d.appointment_id=p_appointment_id;
  if p_outcome='sent' then
    insert into public.documents(workspace_id,customer_id,appointment_id,document_type,title,status,sent_at,created_by)
    values(p_workspace_id,p_customer_id,p_appointment_id,'thank_you_email','Köszönő email','Elküldve',stamp,auth.uid())
    on conflict(workspace_id,customer_id,document_type,appointment_id)
    do update set status='Elküldve',sent_at=coalesce(documents.sent_at,excluded.sent_at);
  end if;
  return jsonb_build_object('sent_at',case when p_outcome='sent' then stamp else null end);
end;
$finish$;

revoke all on function public.claim_installation_thank_you(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.finish_installation_thank_you(uuid,uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_installation_thank_you(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.finish_installation_thank_you(uuid,uuid,uuid,uuid,text,text,text) to authenticated;
do $rpc_comments$
declare function_name text;
begin
  foreach function_name in array array[
    'public.claim_installation_thank_you(uuid,uuid,uuid,text,text)',
    'public.finish_installation_thank_you(uuid,uuid,uuid,uuid,text,text,text)'
  ] loop
    execute format('comment on function %s is %L',function_name,
      'AlinFlow installation thank you RPC v1|'||md5(pg_get_functiondef(to_regprocedure(function_name))));
  end loop;
end;
$rpc_comments$;
commit;
