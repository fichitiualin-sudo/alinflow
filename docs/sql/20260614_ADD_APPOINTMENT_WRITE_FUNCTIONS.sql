begin;

create or replace function public.save_appointment_with_job_mirror(
  p_appointment_id uuid,
  p_customer_id uuid,
  p_quote_id uuid,
  p_title text,
  p_scheduled_date date,
  p_scheduled_time text,
  p_appointment_type text,
  p_status text,
  p_address text,
  p_notes text,
  p_created_by uuid
)
returns table(appointment_id uuid, job_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_appointment_id uuid;
  v_legacy_source_key text;
  v_job_id uuid;
  v_existing_job_id uuid;
  v_job_key text;
begin
  if p_customer_id is null then
    raise exception 'customer_id is required';
  end if;

  if p_scheduled_date is null then
    raise exception 'scheduled_date is required';
  end if;

  if coalesce(trim(p_scheduled_time), '') = '' then
    raise exception 'scheduled_time is required';
  end if;

  if coalesce(p_appointment_type, '') not in ('installation', 'survey', 'maintenance') then
    raise exception 'unsupported appointment_type: %', p_appointment_type;
  end if;

  if p_appointment_id is not null then
    update public.appointments
      set quote_id = p_quote_id,
          title = p_title,
          scheduled_date = p_scheduled_date,
          scheduled_time = p_scheduled_time,
          appointment_type = p_appointment_type,
          status = p_status,
          address = p_address,
          notes = p_notes,
          cancelled_at = null,
          updated_at = now()
      where id = p_appointment_id
        and customer_id = p_customer_id
      returning id, legacy_source_key
      into v_appointment_id, v_legacy_source_key;
  end if;

  if v_appointment_id is null and p_appointment_type in ('installation', 'survey') then
    select id, legacy_source_key
      into v_appointment_id, v_legacy_source_key
      from public.appointments
      where customer_id = p_customer_id
        and appointment_type = p_appointment_type
        and cancelled_at is null
        and coalesce(status, '') <> 'Lemondva'
      order by created_at desc, id desc
      limit 1;

    if v_appointment_id is not null then
      update public.appointments
        set quote_id = p_quote_id,
            title = p_title,
            scheduled_date = p_scheduled_date,
            scheduled_time = p_scheduled_time,
            appointment_type = p_appointment_type,
            status = p_status,
            address = p_address,
            notes = p_notes,
            cancelled_at = null,
            updated_at = now()
        where id = v_appointment_id
        returning id, legacy_source_key
        into v_appointment_id, v_legacy_source_key;
    end if;
  end if;

  if v_appointment_id is null then
    insert into public.appointments (
      customer_id,
      quote_id,
      title,
      scheduled_date,
      scheduled_time,
      appointment_type,
      status,
      address,
      notes,
      created_by
    )
    values (
      p_customer_id,
      p_quote_id,
      p_title,
      p_scheduled_date,
      p_scheduled_time,
      p_appointment_type,
      p_status,
      p_address,
      p_notes,
      p_created_by
    )
    returning id, legacy_source_key
    into v_appointment_id, v_legacy_source_key;
  end if;

  if v_legacy_source_key ~ '^jobs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_existing_job_id := substring(v_legacy_source_key from 6)::uuid;

    update public.jobs
      set quote_id = p_quote_id,
          title = p_title,
          scheduled_date = p_scheduled_date,
          scheduled_time = p_scheduled_time,
          appointment_type = p_appointment_type,
          status = p_status,
          address = p_address,
          notes = p_notes,
          updated_at = now()
      where id = v_existing_job_id
        and customer_id = p_customer_id
      returning id
      into v_job_id;
  end if;

  if v_job_id is null then
    insert into public.jobs (
      customer_id,
      quote_id,
      title,
      scheduled_date,
      scheduled_time,
      appointment_type,
      status,
      address,
      notes,
      created_by
    )
    values (
      p_customer_id,
      p_quote_id,
      p_title,
      p_scheduled_date,
      p_scheduled_time,
      p_appointment_type,
      p_status,
      p_address,
      p_notes,
      p_created_by
    )
    returning id
    into v_job_id;
  end if;

  v_job_key := 'jobs:' || v_job_id::text;

  update public.appointments
    set legacy_source_key = v_job_key,
        updated_at = now()
    where id = v_appointment_id
      and legacy_source_key is distinct from v_job_key;

  return query select v_appointment_id, v_job_id;
end;
$$;

create or replace function public.cancel_appointment_with_job_mirror(
  p_appointment_id uuid,
  p_customer_id uuid,
  p_cancelled_at timestamptz,
  p_status text default 'Lemondva'
)
returns table(appointment_id uuid, job_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_appointment_id uuid;
  v_legacy_source_key text;
  v_job_id uuid;
begin
  if p_customer_id is null then
    raise exception 'customer_id is required';
  end if;

  if p_appointment_id is not null then
    select id, legacy_source_key
      into v_appointment_id, v_legacy_source_key
      from public.appointments
      where id = p_appointment_id
        and customer_id = p_customer_id
      limit 1;
  end if;

  if v_appointment_id is null then
    select id, legacy_source_key
      into v_appointment_id, v_legacy_source_key
      from public.appointments
      where customer_id = p_customer_id
        and cancelled_at is null
        and coalesce(status, '') <> 'Lemondva'
      order by created_at desc, id desc
      limit 1;
  end if;

  if v_appointment_id is null then
    return query select null::uuid, null::uuid;
    return;
  end if;

  update public.appointments
    set status = coalesce(p_status, 'Lemondva'),
        cancelled_at = coalesce(p_cancelled_at, now()),
        updated_at = now()
    where id = v_appointment_id;

  if v_legacy_source_key ~ '^jobs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    update public.jobs
      set status = coalesce(p_status, 'Lemondva'),
          updated_at = now()
      where id = substring(v_legacy_source_key from 6)::uuid
        and customer_id = p_customer_id
      returning id
      into v_job_id;
  end if;

  return query select v_appointment_id, v_job_id;
end;
$$;

grant execute on function public.save_appointment_with_job_mirror(uuid, uuid, uuid, text, date, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.cancel_appointment_with_job_mirror(uuid, uuid, timestamptz, text) to authenticated;

commit;
