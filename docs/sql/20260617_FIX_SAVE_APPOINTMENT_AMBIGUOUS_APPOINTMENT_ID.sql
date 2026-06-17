begin;

-- Diagnostic: confirm the target function exists before replacing it.
select
  'save_appointment_with_job_mirror exists' as check_name,
  to_regprocedure('public.save_appointment_with_job_mirror(uuid, uuid, uuid, text, date, text, text, text, text, text, uuid)') is not null as passed;

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
    update public.appointments a
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
      where a.id = p_appointment_id
        and a.customer_id = p_customer_id
      returning a.id, a.legacy_source_key
      into v_appointment_id, v_legacy_source_key;
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

  update public.quotes q
    set appointment_id = v_appointment_id
    where q.id = p_quote_id
      and q.appointment_id is distinct from v_appointment_id;

  if v_legacy_source_key ~ '^jobs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_existing_job_id := substring(v_legacy_source_key from 6)::uuid;

    update public.jobs j
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
      where j.id = v_existing_job_id
      returning j.id
      into v_job_id;
  end if;

  if v_job_id is null then
    v_job_key := 'appointments:' || v_appointment_id::text;

    select j.id
      into v_job_id
      from public.jobs j
      where j.legacy_source_key = v_job_key
      limit 1;

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
        created_by,
        legacy_source_key
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
        p_created_by,
        v_job_key
      )
      returning id
      into v_job_id;
    else
      update public.jobs j
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
        where j.id = v_job_id;
    end if;

    update public.appointments a
      set legacy_source_key = 'jobs:' || v_job_id::text
      where a.id = v_appointment_id
        and a.legacy_source_key is null;
  end if;

  return query select v_appointment_id, v_job_id;
end;
$$;

grant execute on function public.save_appointment_with_job_mirror(uuid, uuid, uuid, text, date, text, text, text, text, text, uuid) to authenticated;

-- Verification: the function definition must contain the qualified quote update.
select
  'save_appointment_with_job_mirror uses qualified quotes.appointment_id' as check_name,
  pg_get_functiondef('public.save_appointment_with_job_mirror(uuid, uuid, uuid, text, date, text, text, text, text, text, uuid)'::regprocedure) like '%update public.quotes q%' as passed;

commit;
