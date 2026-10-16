-- Explicit extra lines retain their quoted prices but can never deduct AC stock.
-- Apply after 20260906_AUDIT_DATA_SAFETY.sql, before releasing extra-item entry.
-- Patch only the two predicates in the existing transaction; permissions, locks,
-- completion idempotency and material stock handling remain unchanged. No rows
-- are rewritten; untyped legacy manual lines continue to count as climates.
-- Rollback: restore only complete_installation from the prior audit migration.
begin;
do $extra_stock$
declare
  v_function oid := to_regprocedure('public.complete_installation(uuid,uuid,text,jsonb,jsonb)');
  v_definition text;
  v_source text;
  v_metadata jsonb;
  v_old_guard constant text := $oldguard$and qi.workspace_id = p_workspace_id) then raise exception 'A szereles tetelei hianyoznak.'; end if;$oldguard$;
  v_new_guard constant text := $newguard$and qi.workspace_id = p_workspace_id and coalesce(qi.description,'') !~ '(^|[|])item_type=extra([|]|$)') then raise exception 'A szereleshez legalabb egy klima tetel szukseges.'; end if;$newguard$;
  v_old_stock constant text := $oldstock$and split_part(coalesce(qi.description, ''), '|', 1) <> ''$oldstock$;
  v_new_stock constant text := $newstock$and split_part(coalesce(qi.description, ''), '|', 1) <> '' and coalesce(qi.description,'') !~ '(^|[|])item_type=extra([|]|$)'$newstock$;
  v_old_fingerprint constant text := '78c8256b42d5c4b2886008589edb488d';
  v_new_fingerprint constant text := '25fa8a7af4dbaeccea01ef10a3e2676b';
begin
  if v_function is null then raise exception 'The installation completion transaction is missing.'; end if;
  select pg_get_functiondef(p.oid),p.prosrc,to_jsonb(p)-'prosrc'
    into v_definition,v_source,v_metadata from pg_proc p where p.oid=v_function;
  if md5(regexp_replace(v_source,'\s+',' ','g'))=v_new_fingerprint then return; end if;
  if md5(regexp_replace(v_source,'\s+',' ','g'))<>v_old_fingerprint
    or (length(v_definition)-length(replace(v_definition,v_old_guard,'')))<>length(v_old_guard)
    or (length(v_definition)-length(replace(v_definition,v_old_stock,'')))<>length(v_old_stock) then
    raise exception 'Unexpected installation completion transaction. No function was overwritten.';
  end if;
  v_definition := replace(replace(v_definition,v_old_guard,v_new_guard),v_old_stock,v_new_stock);
  execute v_definition;
  if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=v_function) is distinct from v_metadata
    or md5(regexp_replace((select p.prosrc from pg_proc p where p.oid=v_function),'\s+',' ','g'))<>v_new_fingerprint
    or pg_get_functiondef(v_function) is distinct from v_definition then
    raise exception 'Installation transaction metadata or source changed unexpectedly; rolling back.';
  end if;
end;
$extra_stock$;
commit;
