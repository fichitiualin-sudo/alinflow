-- A stale business version is an HTTP conflict, not a retryable transaction.
-- PostgREST 14 can retry custom SQLSTATE 40001 forever, even after disconnect.
-- Change only this error code; keep locks, RLS, ownership, grants and guards.
-- No business row is rewritten. Apply after the 20261012 geocode migration.
-- Repeatable. Do not roll back to 40001: that restores the retry loop.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
do $fix$
declare
  definition text;
  old_code constant text := 'using errcode=''40001''';
  new_code constant text := 'using errcode=''PT409''';
begin
  select pg_get_functiondef('public.save_maintenance_geocode(uuid,uuid,timestamptz,text,double precision,double precision,text,text)'::regprocedure)
    into definition;
  if strpos(definition,old_code)>0 then
    if (length(definition)-length(replace(definition,old_code,'')))/length(old_code)<>1 then
      raise exception 'Unexpected geocode function: audit the error handlers before migrating.';
    end if;
    execute replace(definition,old_code,new_code);
  elsif strpos(definition,new_code)=0 then
    raise exception 'Unexpected geocode function: no known stale-version error handler.';
  end if;
end;
$fix$;
commit;
