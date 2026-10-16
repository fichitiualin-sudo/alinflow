-- Exclude explicitly typed extra quote lines from shared maintenance device snapshots.
-- Apply after 20261012_SHARED_MAINTENANCE_HISTORY.sql and before extra-item UI release.
-- Updates one read-model function only; no customer, quote, handoff, grant or document
-- data is rewritten, and existing ACL/ownership/security settings remain unchanged.
-- Legacy manual quote lines without the item_type token remain climates.
-- Rollback: replace only this function with its prior history-migration definition.
begin;
do $extra_items$
declare
  v_function oid := to_regprocedure('public.shared_maintenance_installation_rows(uuid)');
  v_definition text;
  v_source text;
  v_metadata jsonb;
  v_old_items constant text := $olditems$and qi.quantity>0 and qi.quantity<=1000$olditems$;
  v_new_items constant text := $newitems$and qi.quantity>0 and qi.quantity<=1000 and coalesce(qi.description,'') !~ '(^|[|])item_type=extra([|]|$)'$newitems$;
  v_old_tail constant text := $oldtail$and not coalesce(a.maintenance_opt_out,false);$oldtail$;
  v_new_tail constant text := $newtail$and not coalesce(a.maintenance_opt_out,false)
    -- Retain historical unknown-device installs, but never share an explicit extra-only job.
    and not exists (
      select 1 from public.quotes extra_quote
      where extra_quote.id=a.quote_id and extra_quote.customer_id=c.id and extra_quote.workspace_id=g.source_workspace_id
        and exists (select 1 from public.quote_items extra_item
          where extra_item.quote_id=extra_quote.id and extra_item.workspace_id=extra_quote.workspace_id
            and coalesce(extra_item.description,'') ~ '(^|[|])item_type=extra([|]|$)')
        and not exists (select 1 from public.quote_items climate_item
          where climate_item.quote_id=extra_quote.id and climate_item.workspace_id=extra_quote.workspace_id
            and coalesce(climate_item.description,'') !~ '(^|[|])item_type=extra([|]|$)')
    );$newtail$;
  v_old_fingerprint constant text := '5f6a8f7610a76afa44b8fce7a49c28bc';
  v_new_fingerprint constant text := '5c85d8bd7f81b9e26d49bbb956b11416';
begin
  if v_function is null then raise exception 'Shared maintenance history read model is missing.'; end if;
  select pg_get_functiondef(p.oid),p.prosrc,to_jsonb(p)-'prosrc'
    into v_definition,v_source,v_metadata from pg_proc p where p.oid=v_function;
  if md5(regexp_replace(v_source,'\s+',' ','g'))=v_new_fingerprint then return; end if;
  if md5(regexp_replace(v_source,'\s+',' ','g'))<>v_old_fingerprint
    or (length(v_definition)-length(replace(v_definition,v_old_items,'')))<>length(v_old_items)
    or (length(v_definition)-length(replace(v_definition,v_old_tail,'')))<>length(v_old_tail) then
    raise exception 'Unexpected shared maintenance read model. No function was overwritten.';
  end if;
  v_definition := replace(replace(v_definition,v_old_items,v_new_items),v_old_tail,v_new_tail);
  execute v_definition;
  if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=v_function) is distinct from v_metadata
    or md5(regexp_replace((select p.prosrc from pg_proc p where p.oid=v_function),'\s+',' ','g'))<>v_new_fingerprint
    or pg_get_functiondef(v_function) is distinct from v_definition then
    raise exception 'Shared maintenance metadata or source changed unexpectedly; rolling back.';
  end if;
end;
$extra_items$;
commit;
