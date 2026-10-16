-- Add customer-bound repair/removal jobs without changing existing work identities.
-- Apply before deploying the application. Idempotent; no customer, job, document,
-- inventory or calendar queue row is rewritten. Existing RLS/triggers/ACL stay.
-- The legacy 11-argument RPC remains unchanged; the UI uses the scoped resource
-- RPC which delegates to the 12-argument workspace-aware mirror RPC below.
begin;

create or replace function pg_temp.alinflow_other_photo_fingerprint(p_table regclass)
returns text language sql as $$
  select md5(coalesce(string_agg(entry, E'\n' order by entry), '')) from (
    select concat_ws('|', a.attnum, a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,
      pg_get_expr(d.adbin,d.adrelid)) as entry
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=p_table and a.attnum>0 and not a.attisdropped
    union all select concat_ws('|',c.conname,pg_get_constraintdef(c.oid),c.convalidated)
    from pg_constraint c where c.conrelid=p_table
  ) fields
$$;

do $other_checks$
declare
  v_table text;
  v_constraint text;
  v_definition text;
  v_old text;
  v_new text;
  v_photos regclass := to_regclass('public.work_photos');
  v_marker text;
  v_fingerprint text;
begin
  if to_regclass('public.appointments') is null or v_photos is null
    or to_regprocedure('public.save_appointment_with_resources(uuid,uuid,uuid,text,date,text,text,text,text,text,uuid,uuid,jsonb)') is null then
    raise exception 'Apply the existing work-safety and device-photo migrations first.';
  end if;
  v_marker := obj_description(v_photos,'pg_class');
  v_fingerprint := pg_temp.alinflow_other_photo_fingerprint(v_photos);
  if v_marker is distinct from 'AlinFlow scoped device photos v2|' || v_fingerprint
    and v_marker is distinct from 'AlinFlow scoped service photos v3|' || v_fingerprint then
    raise exception 'Unexpected work photo schema. Review it before adding other work.';
  end if;
  foreach v_table in array array['appointments','work_photos'] loop
    v_constraint := v_table || '_appointment_type_check';
    select pg_get_constraintdef(c.oid) into v_definition
      from pg_constraint c where c.conrelid=('public.'||v_table)::regclass
        and c.conname=v_constraint and c.contype='c' and c.convalidated;
    v_old := case when v_table='appointments'
      then 'CHECK ((appointment_type = ANY (ARRAY[''installation''::text, ''survey''::text, ''maintenance''::text])))'
      else 'CHECK ((appointment_type = ANY (ARRAY[''installation''::text, ''maintenance''::text, ''survey''::text])))' end;
    v_new := 'CHECK ((appointment_type = ANY (ARRAY[''installation''::text, ''survey''::text, ''maintenance''::text, ''other''::text])))';
    if v_definition is distinct from v_old and v_definition is distinct from v_new then
      raise exception 'Unexpected % type constraint. Review it before adding other work.',v_table;
    end if;
    if v_definition=v_old then
      execute format('alter table public.%I drop constraint %I',v_table,v_constraint);
      execute format('alter table public.%I add constraint %I %s',v_table,v_constraint,v_new);
    end if;
  end loop;
  -- Device label photos remain installation-only: the separate device-side
  -- constraint, composite FK and device-scope trigger are deliberately unchanged.
  execute format('comment on table public.work_photos is %L',
    'AlinFlow scoped service photos v3|' || pg_temp.alinflow_other_photo_fingerprint(v_photos));
end;
$other_checks$;

do $other_save$
declare
  v_function oid := to_regprocedure('public.save_appointment_with_job_mirror(uuid,uuid,uuid,text,date,text,text,text,text,text,uuid,uuid)');
  v_old constant text := 'coalesce(p_appointment_type, '''') not in (''installation'', ''survey'', ''maintenance'')';
  v_new constant text := 'coalesce(p_appointment_type, '''') not in (''installation'', ''survey'', ''maintenance'', ''other'')';
  v_definition text;
  v_metadata jsonb;
begin
  if v_function is null then raise exception 'The workspace-scoped appointment writer is missing.'; end if;
  select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into v_definition,v_metadata
    from pg_proc p where p.oid=v_function;
  if strpos(v_definition,v_new)>0 and strpos(v_definition,v_old)=0 then return; end if;
  if strpos(v_definition,v_new)>0
    or (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) then
    raise exception 'Unexpected appointment writer validation. No function was overwritten.';
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  execute v_definition;
  if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=v_function) is distinct from v_metadata
    or pg_get_functiondef(v_function) is distinct from v_definition then
    raise exception 'Appointment writer metadata changed unexpectedly; rolling back.';
  end if;
end;
$other_save$;

do $other_privacy$
declare
  v_function oid := to_regprocedure('public.guard_work_report_privacy_notice()');
  v_definition text;
  v_metadata jsonb;
  v_old_versions constant text := $old$(v_notice ->> 'version') not in ('2026-10-11.1', '2026-10-11.2')$old$;
  v_new_versions constant text := $new$(v_notice ->> 'version') not in ('2026-10-11.1', '2026-10-11.2', '2026-10-16.1')
        or (new.appointment_type='other' and v_notice ->> 'version' is distinct from '2026-10-16.1')$new$;
  v_old_branch constant text := $old$      elsif jsonb_array_length(v_notice -> 'controllers') <> 2 then$old$;
  v_new_branch constant text := $new$      elsif v_notice ->> 'version' = '2026-10-16.1' then
        if new.appointment_type is distinct from 'other'
          or jsonb_array_length(v_notice -> 'controllers') <> 1
          or (v_notice -> 'controllers' -> 0 ->> 'role') is distinct from 'service_provider' then
          raise exception 'Az egyéb munka tájékoztatójához az adott munka szolgáltatója szükséges.' using errcode = '23514';
        end if;
      elsif jsonb_array_length(v_notice -> 'controllers') <> 2 then$new$;
begin
  if v_function is null then raise exception 'The work-report privacy guard is missing.'; end if;
  select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into v_definition,v_metadata
    from pg_proc p where p.oid=v_function;
  if strpos(v_definition,v_new_versions)>0 and strpos(v_definition,v_new_branch)>0
    and strpos(v_definition,v_old_versions)=0 then return; end if;
  if strpos(v_definition,'2026-10-16.1')>0
    or (length(v_definition)-length(replace(v_definition,v_old_versions,'')))<>length(v_old_versions)
    or (length(v_definition)-length(replace(v_definition,v_old_branch,'')))<>length(v_old_branch) then
    raise exception 'Unexpected privacy snapshot guard. No function was overwritten.';
  end if;
  v_definition := replace(replace(v_definition,v_old_versions,v_new_versions),v_old_branch,v_new_branch);
  execute v_definition;
  if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=v_function) is distinct from v_metadata
    or pg_get_functiondef(v_function) is distinct from v_definition then
    raise exception 'Privacy guard metadata changed unexpectedly; rolling back.';
  end if;
end;
$other_privacy$;

-- Google Calendar is already keyed by immutable appointment IDs. Its existing
-- insert/update/delete trigger and durable worker also cover the new type.
-- No enrolment/backfill, cron change, token change or Google request is needed.
commit;
