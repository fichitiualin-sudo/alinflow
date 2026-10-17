-- Manual "Elküldtem" acknowledgements; this is NOT a delivery receipt or SMS queue.
-- Apply after 20261012_ACTIVE_WORKSPACE_ACCESS.sql. No existing business rows,
-- policies, grants, profiles or appointment/document triggers are changed.
-- Rollback the UI independently; retain this additive history table.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';

do $receipt_table$
declare
  ddl constant text := $ddl$
    create table public.appointment_sms_receipts (
      workspace_id uuid not null references public.workspaces(id) on delete cascade,
      customer_id uuid not null references public.customers(id) on delete cascade,
      appointment_id uuid not null references public.appointments(id) on delete cascade,
      content_key text not null check (content_key ~ '^[0-9a-f]{64}$'),
      appointment_updated_at timestamptz not null,
      customer_updated_at timestamptz not null,
      acknowledged_at timestamptz not null,
      acknowledged_by uuid not null,
      primary key (workspace_id, appointment_id, content_key)
    )
  $ddl$;
  existed boolean := to_regclass('public.appointment_sms_receipts') is not null;
  fingerprint text;
  expected_comment text;
begin
  if to_regclass('public.customers') is null or to_regclass('public.appointments') is null
    or to_regclass('public.documents') is null
    or to_regprocedure('public.active_workspace_member(uuid)') is null then
    raise exception 'SMS-visszajelzés: hiányzó időpont/munkaterület séma. Audit szükséges.';
  end if;
  if not existed then execute ddl; end if;
  select md5(string_agg(entry,E'\n' order by entry)) into fingerprint from (
    select concat_ws('|',a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
      pg_get_expr(d.adbin,d.adrelid)) entry from pg_attribute a
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.appointment_sms_receipts'::regclass and a.attnum>0 and not a.attisdropped
    union all select concat_ws('|',c.conname,pg_get_constraintdef(c.oid),c.convalidated)
    from pg_constraint c where c.conrelid='public.appointment_sms_receipts'::regclass
  ) fields;
  expected_comment := 'AlinFlow manual SMS acknowledgement v1|' || md5(regexp_replace(ddl,'\s+',' ','g')) || '|' || fingerprint;
  if existed and obj_description('public.appointment_sms_receipts'::regclass,'pg_class') is distinct from expected_comment then
    raise exception 'SMS-visszajelzés: eltérő vagy ismeretlen napló. Nem írtuk felül; audit szükséges.';
  end if;
  if not existed then execute format('comment on table public.appointment_sms_receipts is %L',expected_comment); end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='appointment_sms_receipts'
    and policyname not in ('sms_receipt_read','sms_receipt_insert')) then
    raise exception 'SMS-visszajelzés: ismeretlen naplójogosultság. Audit szükséges.';
  end if;
end;
$receipt_table$;

do $receipt_functions$
declare signature text; function_oid oid;
begin
  foreach signature in array array[
    'public.guard_appointment_sms_receipt()',
    'public.acknowledge_appointment_sms(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)'
  ] loop
    function_oid := to_regprocedure(signature);
    if function_oid is not null and obj_description(function_oid,'pg_proc')
      is distinct from 'AlinFlow manual SMS function v1|' || md5(pg_get_functiondef(function_oid)) then
      raise exception 'SMS-visszajelzés: ismeretlen vagy módosított függvény: %. Audit szükséges.',signature;
    end if;
  end loop;
end;
$receipt_functions$;

alter table public.appointment_sms_receipts enable row level security;
revoke all on public.appointment_sms_receipts from public,anon,authenticated,service_role;
revoke all (workspace_id,customer_id,appointment_id,content_key,appointment_updated_at,
  customer_updated_at,acknowledged_at,acknowledged_by)
  on public.appointment_sms_receipts from public,anon,authenticated,service_role;
grant select on public.appointment_sms_receipts to authenticated;
grant insert (workspace_id,customer_id,appointment_id,content_key,appointment_updated_at,customer_updated_at)
  on public.appointment_sms_receipts to authenticated;

drop policy if exists sms_receipt_read on public.appointment_sms_receipts;
create policy sms_receipt_read on public.appointment_sms_receipts for select to authenticated using (
  public.active_workspace_member(workspace_id)
  and exists(select 1 from public.appointments a join public.customers c
    on c.id=a.customer_id and c.workspace_id=a.workspace_id
    where a.id=appointment_sms_receipts.appointment_id
      and a.customer_id=appointment_sms_receipts.customer_id
      and a.workspace_id=appointment_sms_receipts.workspace_id)
);
drop policy if exists sms_receipt_insert on public.appointment_sms_receipts;
create policy sms_receipt_insert on public.appointment_sms_receipts for insert to authenticated with check (
  public.active_workspace_member(workspace_id) and acknowledged_by=(select auth.uid())
  and exists(select 1 from public.appointments a join public.customers c
    on c.id=a.customer_id and c.workspace_id=a.workspace_id
    where a.id=appointment_sms_receipts.appointment_id
      and a.customer_id=appointment_sms_receipts.customer_id
      and a.workspace_id=appointment_sms_receipts.workspace_id)
);

-- Invoker rights preserve the existing customer/appointment RLS. Share locks
-- serialize this acknowledgement with edits between the API read and INSERT.
-- The client cannot supply the actor/time or update/delete old acknowledgements.
create or replace function public.guard_appointment_sms_receipt()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $guard$
declare
  work public.appointments%rowtype;
  customer_version timestamptz;
begin
  if tg_table_schema<>'public' or tg_table_name<>'appointment_sms_receipts' or tg_op<>'INSERT'
    or auth.uid() is null or not public.active_workspace_member(new.workspace_id) then
    raise exception 'Nincs hozzáférés ehhez a munkaterülethez.' using errcode='42501';
  end if;
  select c.updated_at into customer_version from public.customers c
    where c.id=new.customer_id and c.workspace_id=new.workspace_id for share;
  if not found then
    raise exception 'Az ügyfél nem ehhez a munkaterülethez tartozik.' using errcode='42501';
  end if;
  select a.* into work from public.appointments a where a.id=new.appointment_id
    and a.customer_id=new.customer_id and a.workspace_id=new.workspace_id for share;
  if not found then
    raise exception 'Az időpont nem ehhez az ügyfélhez tartozik.' using errcode='42501';
  end if;
  if new.appointment_updated_at is null or new.customer_updated_at is null
    or work.updated_at is distinct from new.appointment_updated_at
    or customer_version is distinct from new.customer_updated_at then
    raise exception 'Az időpont vagy az ügyfél adatai megváltoztak. Frissítsd az SMS-előnézetet.' using errcode='PT409';
  end if;
  if work.appointment_type not in ('installation','maintenance','survey')
    or work.appointment_type is null or work.cancelled_at is not null
    or (work.appointment_type='installation' and work.stock_deducted_at is not null)
    or coalesce(work.status,'') not in ('Időpont foglalva','Szerelés folyamatban')
    or work.scheduled_date is null or not isfinite(work.scheduled_date)
    or work.scheduled_date <= (statement_timestamp() at time zone 'Europe/Budapest')::date
    or coalesce(work.scheduled_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$'
    or exists(select 1 from public.documents d where d.workspace_id=new.workspace_id
      and d.customer_id=new.customer_id and d.appointment_id=new.appointment_id
      and d.document_type in ('survey_done','maintenance_done','installation_done','work_closed')) then
    raise exception 'Ehhez az időponthoz már nem rögzíthető SMS-emlékeztető.' using errcode='PT400';
  end if;
  if not public.active_workspace_member(new.workspace_id) then
    raise exception 'A munkaterületi hozzáférés már nem aktív.' using errcode='42501';
  end if;
  new.acknowledged_at := statement_timestamp();
  new.acknowledged_by := auth.uid();
  return new;
end;
$guard$;
drop trigger if exists appointment_sms_receipt_guard on public.appointment_sms_receipts;
create trigger appointment_sms_receipt_guard before insert on public.appointment_sms_receipts
  for each row execute function public.guard_appointment_sms_receipt();

create or replace function public.acknowledge_appointment_sms(
  p_workspace_id uuid,p_customer_id uuid,p_appointment_id uuid,p_content_key text,
  p_appointment_updated_at timestamptz,p_customer_updated_at timestamptz
)
returns public.appointment_sms_receipts
language plpgsql security invoker set search_path=pg_catalog,pg_temp as $acknowledge$
declare receipt public.appointment_sms_receipts%rowtype;
begin
  -- The INSERT trigger validates the live appointment even on a duplicate key.
  insert into public.appointment_sms_receipts
    (workspace_id,customer_id,appointment_id,content_key,appointment_updated_at,customer_updated_at)
    values(p_workspace_id,p_customer_id,p_appointment_id,p_content_key,p_appointment_updated_at,p_customer_updated_at)
    on conflict(workspace_id,appointment_id,content_key) do nothing returning * into receipt;
  if not found then
    select r.* into receipt from public.appointment_sms_receipts r
      where r.workspace_id=p_workspace_id and r.customer_id=p_customer_id
        and r.appointment_id=p_appointment_id and r.content_key=p_content_key;
    if not found then raise exception 'A visszajelzés nem érhető el.' using errcode='42501'; end if;
  end if;
  return receipt;
end;
$acknowledge$;
revoke all on function public.guard_appointment_sms_receipt(),
  public.acknowledge_appointment_sms(uuid,uuid,uuid,text,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.acknowledge_appointment_sms(uuid,uuid,uuid,text,timestamptz,timestamptz) to authenticated;
do $receipt_comments$
declare signature text;
begin
  foreach signature in array array[
    'public.guard_appointment_sms_receipt()',
    'public.acknowledge_appointment_sms(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)'
  ] loop
    execute format('comment on function %s is %L',signature,
      'AlinFlow manual SMS function v1|' || md5(pg_get_functiondef(to_regprocedure(signature))));
  end loop;
end;
$receipt_comments$;
commit;
