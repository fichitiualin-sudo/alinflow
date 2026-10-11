-- Correct future address edits and reject in-flight stale geocoder responses.
-- Apply after map coordinates and workspace audit migrations. No historic row
-- is rewritten during installation. Repeatable; rollback drops these triggers
-- and RPC, leaving the existing map columns and values untouched.
begin;
create or replace function public.invalidate_appointment_geocode()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
  if new.address is distinct from old.address then
    new.latitude:=null; new.longitude:=null; new.geocoded_at:=null;
    new.geocode_status:=null; new.geocode_error:=null;
    new.updated_at:=clock_timestamp();
  end if;
  return new;
end;
$$;
drop trigger if exists appointment_geocode_address_guard on public.appointments;
create trigger appointment_geocode_address_guard before update of address on public.appointments
  for each row execute function public.invalidate_appointment_geocode();

create or replace function public.invalidate_customer_installation_geocodes()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
  update public.appointments a set latitude=null,longitude=null,geocoded_at=null,
    geocode_status=null,geocode_error=null,updated_at=clock_timestamp()
  where a.workspace_id=new.workspace_id and a.customer_id=new.id and a.appointment_type='installation'
    and ((new.postal_code,new.city) is distinct from (old.postal_code,old.city)
      or (new.address is distinct from old.address and nullif(btrim(a.address),'') is null));
  return new;
end;
$$;
drop trigger if exists customer_geocode_address_guard on public.customers;
create trigger customer_geocode_address_guard after update of postal_code,city,address on public.customers
  for each row execute function public.invalidate_customer_installation_geocodes();

create or replace function public.save_maintenance_geocode(
  p_workspace_id uuid,p_appointment_id uuid,p_expected_appointment_updated_at timestamptz,
  p_expected_address text,p_latitude double precision,p_longitude double precision,
  p_status text,p_error text default null
)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare a public.appointments%rowtype; c public.customers%rowtype; saved_at timestamptz;
begin
  perform public.require_workspace_member(p_workspace_id);
  if p_status is null or p_status not in ('ok','failed') or
    (p_status='ok' and (p_latitude is null or p_longitude is null or
      not(p_latitude between -90 and 90) or not(p_longitude between -180 and 180))) then
    raise exception 'Érvénytelen térképes koordináta.' using errcode='22023';
  end if;
  -- Lock the customer first, matching the customer-address invalidation order.
  select customer.* into c from public.customers customer
    join public.appointments work on work.customer_id=customer.id and work.workspace_id=customer.workspace_id
    where work.id=p_appointment_id and work.workspace_id=p_workspace_id
      and work.appointment_type='installation' for update of customer;
  if not found then raise exception 'A telepítés nem érhető el.' using errcode='42501'; end if;
  select * into a from public.appointments where id=p_appointment_id and workspace_id=p_workspace_id
    and customer_id=c.id and appointment_type='installation' for update;
  if not found then raise exception 'A telepítés nem érhető el.' using errcode='42501'; end if;
  if p_expected_appointment_updated_at is null or a.updated_at is distinct from p_expected_appointment_updated_at
    or coalesce(nullif(btrim(a.address),''),btrim(c.address),'') is distinct from btrim(coalesce(p_expected_address,'')) then
    raise exception 'A telepítés címe vagy adatai közben megváltoztak. Frissítsd a térképet.' using errcode='40001';
  end if;
  saved_at:=clock_timestamp();
  update public.appointments set latitude=case when p_status='ok' then p_latitude end,
    longitude=case when p_status='ok' then p_longitude end,geocoded_at=saved_at,
    geocode_status=p_status,geocode_error=case when p_status='failed' then left(coalesce(p_error,'Nincs találat a címre.'),500) end,
    updated_at=saved_at
    where id=a.id and workspace_id=p_workspace_id;
  return jsonb_build_object('latitude',case when p_status='ok' then p_latitude end,
    'longitude',case when p_status='ok' then p_longitude end,'geocodedAt',saved_at,'updatedAt',saved_at,
    'geocodeStatus',p_status,'geocodeError',case when p_status='failed' then left(coalesce(p_error,'Nincs találat a címre.'),500) end);
end;
$$;
revoke all on function public.invalidate_appointment_geocode(),public.invalidate_customer_installation_geocodes() from public,anon,authenticated;
revoke all on function public.save_maintenance_geocode(uuid,uuid,timestamptz,text,double precision,double precision,text,text) from public,anon;
grant execute on function public.save_maintenance_geocode(uuid,uuid,timestamptz,text,double precision,double precision,text,text) to authenticated;
commit;
