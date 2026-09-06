-- Apply after the workspace and multi-work scoping migrations.
-- Take a database backup first. No historical quantities are changed.
begin;

alter table public.appointments
  add column if not exists material_usage jsonb,
  add column if not exists stock_deducted_at timestamptz;

-- Replace only obsolete customer-wide uniqueness, never delete documents.
alter table public.work_checklists add column if not exists id uuid default gen_random_uuid();
alter table public.work_checklists add column if not exists completed_at jsonb not null default '{}'::jsonb;
update public.work_checklists set id = gen_random_uuid() where id is null;
alter table public.work_checklists alter column id set not null;
do $$
declare v_constraint record;
begin
  for v_constraint in
    select c.conname, c.conrelid::regclass as relation from pg_constraint c
    where c.contype in ('p','u') and (
      (c.conrelid = 'public.work_checklists'::regclass and c.conkey = array[
        (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'customer_id')
      ]::smallint[])
      or (c.conrelid = 'public.documents'::regclass and c.conkey @> array[
        (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'customer_id'),
        (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'document_type')
      ]::smallint[] and cardinality(c.conkey) = 2)
    )
  loop execute format('alter table %s drop constraint %I', v_constraint.relation, v_constraint.conname); end loop;
  if not exists(select 1 from pg_constraint where conrelid = 'public.work_checklists'::regclass and contype = 'p') then
    alter table public.work_checklists add constraint work_checklists_id_pkey primary key(id);
  end if;
end;
$$;
create unique index if not exists documents_scope_nulls_uidx
  on public.documents(workspace_id,customer_id,document_type,appointment_id) nulls not distinct;
create unique index if not exists work_checklists_scope_nulls_uidx
  on public.work_checklists(workspace_id,customer_id,appointment_id) nulls not distinct;

-- Preserve the existing interpretation of completed installations.
update public.appointments
set stock_deducted_at = coalesce(updated_at, created_at, now())
where appointment_type = 'installation'
  and status in ('Szerelés kész – admin folyamatban', 'Lezárva')
  and stock_deducted_at is null;

create or replace function public.require_workspace_member(p_workspace_id uuid)
returns void language plpgsql security invoker set search_path = public
as $$
begin
  if auth.uid() is null or p_workspace_id is null or not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid() and wm.active
  ) then
    raise exception 'Nincs jogosultsag ehhez a munkaterulethez.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.require_workspace_member(uuid) from public, anon;
grant execute on function public.require_workspace_member(uuid) to authenticated;

create or replace function public.guard_work_scope()
returns trigger language plpgsql security invoker set search_path = public
as $$
declare
  v_appointment public.appointments%rowtype;
begin
  if tg_table_name = 'appointments' then
    if new.customer_id is distinct from old.customer_id
      or new.workspace_id is distinct from old.workspace_id
      or new.appointment_type is distinct from old.appointment_type then
      raise exception 'Meglevo idopont ugyfele es tipusa nem irhato at. Hozz letre uj idopontot.';
    end if;
    if old.stock_deducted_at is not null and new.stock_deducted_at is distinct from old.stock_deducted_at then
      raise exception 'A keszletlevonas jelolese nem torolheto es nem irhato at.';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.customer_id is distinct from old.customer_id or new.workspace_id is distinct from old.workspace_id
      or (old.appointment_id is not null and new.appointment_id is distinct from old.appointment_id) then
      raise exception 'Meglevo dokumentum nem helyezheto at masik ugyfelhez vagy munkahoz.';
    end if;
    if tg_table_name = 'work_reports' then
      if new.appointment_type is distinct from old.appointment_type then
        raise exception 'Meglevo munkalap tipusa nem irhato at.';
      end if;
    end if;
  end if;
  if new.appointment_id is not null then
    select a.* into v_appointment from public.appointments a
    where a.id = new.appointment_id and a.customer_id = new.customer_id
      and a.workspace_id = new.workspace_id;
    if not found then raise exception 'Az idopont nem ehhez az ugyfelhez tartozik.'; end if;
    if tg_table_name = 'work_reports' then
      if new.appointment_type is distinct from v_appointment.appointment_type then
        raise exception 'A munkalap es az idopont tipusa elter.';
      end if;
      if tg_op = 'UPDATE' and old.appointment_id is null
        and (new.work_date is distinct from v_appointment.scheduled_date
          or new.work_time is distinct from v_appointment.scheduled_time) then
        raise exception 'A regi munkalap datuma nem egyezik az idoponttal.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_guard_work_scope on public.appointments;
create trigger appointments_guard_work_scope before update on public.appointments
for each row execute function public.guard_work_scope();
drop trigger if exists work_reports_guard_work_scope on public.work_reports;
create trigger work_reports_guard_work_scope before insert or update on public.work_reports
for each row execute function public.guard_work_scope();
drop trigger if exists quotes_guard_work_scope on public.quotes;
create trigger quotes_guard_work_scope before insert or update on public.quotes
for each row execute function public.guard_work_scope();
drop trigger if exists work_checklists_guard_work_scope on public.work_checklists;
create trigger work_checklists_guard_work_scope before insert or update on public.work_checklists
for each row execute function public.guard_work_scope();

create or replace function public.save_quote_with_items(
  p_workspace_id uuid, p_quote_id uuid, p_customer_id uuid, p_appointment_id uuid,
  p_status text, p_notes text, p_items jsonb
)
returns uuid language plpgsql security invoker set search_path = public
as $$
declare
  v_quote public.quotes%rowtype;
  v_id uuid;
  v_item jsonb;
  v_total numeric := 0;
begin
  perform public.require_workspace_member(p_workspace_id);
  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.workspace_id = p_workspace_id) then
    raise exception 'Az ugyfel nem erheto el.';
  end if;
  -- Always acquire appointment before quote locks, like completion.
  if p_appointment_id is not null then
    perform 1 from public.appointments a where a.id = p_appointment_id
      and a.customer_id = p_customer_id and a.workspace_id = p_workspace_id for update;
    if not found then raise exception 'Az idopont nem erheto el.'; end if;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Hibas ajanlati tetellista.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(trim(v_item->>'product_name'), '') = ''
      or coalesce((v_item->>'quantity')::numeric, 0) <= 0
      or coalesce((v_item->>'unit_price')::numeric, -1) < 0
      or (v_item->>'quantity') in ('NaN','Infinity','-Infinity')
      or (v_item->>'unit_price') in ('NaN','Infinity','-Infinity') then
      raise exception 'Hibas nev, darabszam vagy ar az ajanlatban.';
    end if;
    v_total := v_total + (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric;
  end loop;

  if p_quote_id is not null then
    select q.* into v_quote from public.quotes q where q.id = p_quote_id
      and q.workspace_id = p_workspace_id and q.customer_id = p_customer_id for update;
    if not found then raise exception 'Az ajanlat nem erheto el.'; end if;
    if v_quote.appointment_id is not null and v_quote.appointment_id is distinct from p_appointment_id then
      raise exception 'Masik munka ajanlata nem irhato felul.';
    end if;
    v_id := v_quote.id;
    update public.quotes q set status = p_status, notes = p_notes,
      total_amount = v_total, appointment_id = p_appointment_id, updated_at = now()
      where q.id = v_id and q.workspace_id = p_workspace_id;
  else
    insert into public.quotes(workspace_id, customer_id, appointment_id, status, notes, total_amount, created_by)
    values(p_workspace_id, p_customer_id, p_appointment_id, p_status, p_notes, v_total, auth.uid())
    returning id into v_id;
  end if;

  delete from public.quote_items qi where qi.quote_id = v_id and qi.workspace_id = p_workspace_id;
  insert into public.quote_items(workspace_id, quote_id, product_name, description, quantity, unit_price, total_price)
  select p_workspace_id, v_id, item->>'product_name', item->>'description',
    (item->>'quantity')::numeric, (item->>'unit_price')::numeric,
    (item->>'quantity')::numeric * (item->>'unit_price')::numeric
  from jsonb_array_elements(p_items) item;
  return v_id;
end;
$$;
revoke all on function public.save_quote_with_items(uuid,uuid,uuid,uuid,text,text,jsonb) from public, anon;
grant execute on function public.save_quote_with_items(uuid,uuid,uuid,uuid,text,text,jsonb) to authenticated;

create or replace function public.save_appointment_with_resources(
  p_appointment_id uuid, p_customer_id uuid, p_quote_id uuid, p_title text,
  p_scheduled_date date, p_scheduled_time text, p_appointment_type text, p_status text,
  p_address text, p_notes text, p_created_by uuid, p_workspace_id uuid, p_material_usage jsonb
)
returns table(appointment_id uuid, job_id uuid)
language plpgsql security invoker set search_path = public
as $$
declare
  v_result record;
  v_quote public.quotes%rowtype;
  v_status text := p_status;
begin
  perform public.require_workspace_member(p_workspace_id);
  if p_appointment_id is not null then
    -- Existing work identity is immutable; the old RPC must never fall back to an insert here.
    perform 1 from public.appointments a where a.id = p_appointment_id
      and a.customer_id = p_customer_id and a.workspace_id = p_workspace_id for update;
    if not found then raise exception 'Az idopont nem erheto el. Frissitsd az adatokat.'; end if;
    select case when a.stock_deducted_at is not null and p_status = 'Időpont foglalva' then a.status else p_status end
    into v_status from public.appointments a where a.id = p_appointment_id and a.workspace_id = p_workspace_id;
  end if;
  if p_quote_id is not null then
    select q.* into v_quote from public.quotes q where q.id = p_quote_id
      and q.customer_id = p_customer_id and q.workspace_id = p_workspace_id for update;
    if not found then raise exception 'Az ajanlat nem erheto el.'; end if;
    if v_quote.appointment_id is not null and v_quote.appointment_id is distinct from p_appointment_id then
      raise exception 'Ez az ajanlat mar masik idoponthoz tartozik.';
    end if;
  end if;
  if not exists(select 1 from public.customers c where c.id = p_customer_id and c.workspace_id = p_workspace_id) then
    raise exception 'Az ugyfel nem erheto el ezen a munkateruleten.';
  end if;
  if p_material_usage is not null and (jsonb_typeof(p_material_usage) <> 'object'
      or jsonb_typeof(p_material_usage->'materials') is distinct from 'array'
      or jsonb_typeof(p_material_usage->'overrides') is distinct from 'object') then
    raise exception 'Hibas anyagfelhasznalas.';
  end if;
  select * into v_result from public.save_appointment_with_job_mirror(
    p_appointment_id, p_customer_id, p_quote_id, p_title, p_scheduled_date, p_scheduled_time,
    p_appointment_type, v_status, p_address, p_notes, auth.uid(), p_workspace_id
  );
  if v_result.appointment_id is null then raise exception 'Az idopont nem mentodott.'; end if;
  if p_material_usage is not null then
    update public.appointments a set material_usage = p_material_usage
    where a.id = v_result.appointment_id and a.workspace_id = p_workspace_id;
  end if;
  if p_quote_id is not null then
    update public.quotes q set appointment_id = v_result.appointment_id
    where q.id = p_quote_id and q.workspace_id = p_workspace_id;
  end if;
  return query select v_result.appointment_id::uuid, v_result.job_id::uuid;
end;
$$;
revoke all on function public.save_appointment_with_resources(uuid,uuid,uuid,text,date,text,text,text,text,text,uuid,uuid,jsonb) from public, anon;
grant execute on function public.save_appointment_with_resources(uuid,uuid,uuid,text,date,text,text,text,text,text,uuid,uuid,jsonb) to authenticated;

create or replace function public.complete_installation(
  p_appointment_id uuid, p_workspace_id uuid, p_status text,
  p_material_usage jsonb, p_material_quantities jsonb
)
returns table(stock_deducted_at timestamptz, status text)
language plpgsql security invoker set search_path = public
as $$
declare
  v_appointment public.appointments%rowtype;
  v_item record;
  v_available numeric;
  v_stamp timestamptz;
  v_status text;
  v_document_type text;
begin
  perform public.require_workspace_member(p_workspace_id);
  if p_status is null or p_status not in ('Szerelés kész – admin folyamatban', 'Lezárva') then
    raise exception 'Hibas lezarasi allapot.';
  end if;
  select a.* into v_appointment from public.appointments a
  where a.id = p_appointment_id and a.workspace_id = p_workspace_id for update;
  if not found or v_appointment.appointment_type <> 'installation' or v_appointment.status = 'Lemondva' then
    raise exception 'Csak aktiv szereles zarhato le.';
  end if;
  v_stamp := v_appointment.stock_deducted_at;
  v_status := case when v_appointment.status = 'Lezárva' then 'Lezárva' else p_status end;
  if v_stamp is null then
    if v_appointment.quote_id is null then raise exception 'A szereles ajanlata hianyzik.'; end if;
    perform 1 from public.quotes q where q.id = v_appointment.quote_id
      and q.customer_id = v_appointment.customer_id and q.workspace_id = p_workspace_id for update;
    if not found then raise exception 'A szereles ajanlata nem erheto el.'; end if;
    if not exists (select 1 from public.quote_items qi where qi.quote_id = v_appointment.quote_id
      and qi.workspace_id = p_workspace_id) then raise exception 'A szereles tetelei hianyoznak.'; end if;

    -- Stable lock order serializes concurrent jobs using the same stock rows.
    for v_item in
      select split_part(coalesce(qi.description, ''), '|', 1) as product_id, sum(qi.quantity) as quantity
      from public.quote_items qi
      where qi.quote_id = v_appointment.quote_id and qi.workspace_id = p_workspace_id
        and split_part(coalesce(qi.description, ''), '|', 1) <> ''
      group by 1 order by 1
    loop
      if v_item.quantity is null or v_item.quantity <= 0 then raise exception 'Hibas darabszam.'; end if;
      select s.stock into v_available from public.inventory_stock s
        where s.product_id = v_item.product_id and s.workspace_id = p_workspace_id for update;
      if not found or v_available < v_item.quantity then
        raise exception 'Keszlethiany: %, raktaron: %, szukseges: %', v_item.product_id, coalesce(v_available,0), v_item.quantity;
      end if;
      update public.inventory_stock s set stock = s.stock - v_item.quantity
        where s.product_id = v_item.product_id and s.workspace_id = p_workspace_id;
    end loop;

    if p_material_quantities is null or jsonb_typeof(p_material_quantities) <> 'array'
      or p_material_usage is null or jsonb_typeof(p_material_usage) <> 'object'
      or jsonb_typeof(p_material_usage->'materials') is distinct from 'array'
      or jsonb_typeof(p_material_usage->'overrides') is distinct from 'object' then
      raise exception 'Hibas anyagfelhasznalas.';
    end if;
    if exists (select 1 from jsonb_array_elements(p_material_quantities) item
      where coalesce(trim(item->>'name'), '') = '' or coalesce((item->>'quantity')::numeric, -1) < 0
        or (item->>'quantity') in ('NaN','Infinity','-Infinity')) then
      raise exception 'Hibas anyagmennyiseg.';
    end if;
    for v_item in select item->>'name' as name, sum((item->>'quantity')::numeric) as quantity
      from jsonb_array_elements(p_material_quantities) item group by 1 order by 1
    loop
      if v_item.quantity = 0 then continue; end if;
      select m.stock into v_available from public.material_inventory m
        where m.name = v_item.name and m.workspace_id = p_workspace_id for update;
      if not found or v_available < v_item.quantity then
        raise exception 'Anyagkeszlethiany: %, raktaron: %, szukseges: %', v_item.name, coalesce(v_available,0), v_item.quantity;
      end if;
      update public.material_inventory m set stock = m.stock - v_item.quantity
        where m.name = v_item.name and m.workspace_id = p_workspace_id;
    end loop;
    v_stamp := now();
  end if;

  update public.appointments a set status = v_status, stock_deducted_at = v_stamp,
    material_usage = coalesce(p_material_usage, a.material_usage), updated_at = now()
    where a.id = p_appointment_id and a.workspace_id = p_workspace_id;
  update public.jobs j set status = v_status, updated_at = now()
    where j.workspace_id = p_workspace_id and j.customer_id = v_appointment.customer_id
      and ('jobs:' || j.id::text = v_appointment.legacy_source_key
        or j.legacy_source_key = 'appointments:' || p_appointment_id::text);
  update public.customers c set stock_deducted = true
    where c.id = v_appointment.customer_id and c.workspace_id = p_workspace_id;
  v_document_type := case when v_status = 'Lezárva' then 'work_closed' else 'installation_done' end;
  insert into public.documents(workspace_id,customer_id,appointment_id,document_type,title,status,sent_at,created_by)
  values(p_workspace_id,v_appointment.customer_id,p_appointment_id,v_document_type,
    case when v_status = 'Lezárva' then 'Teljes lezárás' else 'Szerelés kész – admin folyamatban' end,
    'Kész',now(),auth.uid())
  on conflict(workspace_id,customer_id,document_type,appointment_id) do nothing;
  return query select v_stamp, v_status;
end;
$$;
revoke all on function public.complete_installation(uuid,uuid,text,jsonb,jsonb) from public, anon;
grant execute on function public.complete_installation(uuid,uuid,text,jsonb,jsonb) to authenticated;

create or replace function public.adjust_climate_stock(p_workspace_id uuid, p_product_id text, p_delta numeric)
returns numeric language plpgsql security invoker set search_path = public
as $$
declare v_stock numeric;
begin
  perform public.require_workspace_member(p_workspace_id);
  if p_delta is null or p_delta::text in ('NaN','Infinity','-Infinity') then raise exception 'Hibas keszletvaltozas.'; end if;
  if not exists(select 1 from public.climate_products p where p.id=p_product_id and p.workspace_id=p_workspace_id) then
    raise exception 'A klima nem erheto el ezen a munkateruleten.';
  end if;
  insert into public.inventory_stock(workspace_id,product_id,stock) values(p_workspace_id,p_product_id,0)
    on conflict(workspace_id,product_id) do nothing;
  update public.inventory_stock s set stock=s.stock+p_delta
    where s.workspace_id=p_workspace_id and s.product_id=p_product_id and s.stock+p_delta>=0
    returning s.stock into v_stock;
  if not found then raise exception 'Nincs eleg klima a keszletcsokkenteshez.'; end if;
  return v_stock;
end;
$$;
revoke all on function public.adjust_climate_stock(uuid,text,numeric) from public, anon;
grant execute on function public.adjust_climate_stock(uuid,text,numeric) to authenticated;

create or replace function public.adjust_material_stock(p_workspace_id uuid, p_name text, p_delta numeric)
returns numeric language plpgsql security invoker set search_path = public
as $$
declare v_stock numeric;
begin
  perform public.require_workspace_member(p_workspace_id);
  if p_delta is null or p_delta::text in ('NaN','Infinity','-Infinity') then raise exception 'Hibas keszletvaltozas.'; end if;
  update public.material_inventory m set stock=round(m.stock+p_delta,1)
    where m.workspace_id=p_workspace_id and m.name=p_name and round(m.stock+p_delta,1)>=0
    returning m.stock into v_stock;
  if not found then raise exception 'Az anyag hianyzik vagy nincs eleg keszleten.'; end if;
  return v_stock;
end;
$$;
revoke all on function public.adjust_material_stock(uuid,text,numeric) from public, anon;
grant execute on function public.adjust_material_stock(uuid,text,numeric) to authenticated;

notify pgrst, 'reload schema';
commit;
