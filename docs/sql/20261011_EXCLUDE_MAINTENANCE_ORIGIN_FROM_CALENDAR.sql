-- Maintenance-list labels do not change calendar events. Apply after the origin
-- migration; rerunnable and a no-op when Google Calendar is not installed.
-- Preserve the installed trigger function, ownership, settings and permissions.
begin;
do $migration$
declare
  function_id oid := to_regprocedure('public.queue_google_calendar_appointment_change()');
  old_comparison text := '(to_jsonb(new)-''updated_at'') is not distinct from (to_jsonb(old)-''updated_at'')';
  new_comparison text := '(to_jsonb(new)-array[''updated_at'',''maintenance_origin'',''maintenance_source_name'']) is not distinct from (to_jsonb(old)-array[''updated_at'',''maintenance_origin'',''maintenance_source_name''])';
  definition text;
  original_metadata jsonb;
begin
  if function_id is null then
    raise notice 'Google Calendar appointment trigger is not installed; nothing to change.';
    return;
  end if;
  select pg_get_functiondef(p.oid), to_jsonb(p)-'prosrc'
    into definition, original_metadata from pg_proc p where p.oid=function_id;
  if strpos(definition,new_comparison)>0 and strpos(definition,old_comparison)=0 then
    return;
  end if;
  if strpos(definition,new_comparison)>0
      or (length(definition)-length(replace(definition,old_comparison,''))) <> length(old_comparison) then
    raise exception 'Unexpected Google Calendar trigger comparison; review installed definition before changing it.';
  end if;
  definition := replace(definition,old_comparison,new_comparison);
  execute definition;
  if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=function_id) is distinct from original_metadata
      or pg_get_functiondef(function_id) is distinct from definition then
    raise exception 'Google Calendar trigger metadata changed unexpectedly; rolling back.';
  end if;
end
$migration$;
commit;
