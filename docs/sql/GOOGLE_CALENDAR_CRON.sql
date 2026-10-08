-- OPTIONAL deployment template: run as postgres AFTER GOOGLE_CALENDAR_SYNC.sql.
-- It activates a one-minute retry job. Do not apply before the production route
-- and its GOOGLE_CALENDAR_CRON_SECRET environment variable have been deployed.
--
-- Prerequisites (Supabase Dashboard, not committed SQL literals):
-- 1. Enable pg_cron and pg_net, and make Supabase Vault available.
-- 2. In Vault create these named secrets:
--    alinflow_app_url: the exact canonical HTTPS origin used by
--      GOOGLE_CALENDAR_APP_URL, without path/query/fragment or trailing slash.
--    alinflow_google_calendar_cron_secret: the same randomly generated token as
--      GOOGLE_CALENDAR_CRON_SECRET (at least 32 characters; base64url recommended).
-- No Google token or Supabase service-role key belongs in the cron command.
-- 3. Keep net and vault out of Data API exposed schemas. If no explicit
--    authenticator pgrst.db_schemas setting is stored in the database, inspect
--    Project Settings > Data API > Exposed schemas. Only after that check, add
--    SET LOCAL alinflow.calendar_net_schema_not_exposed='confirmed'; immediately
--    after BEGIN in the execution copy. This template never confirms it itself.
--
-- Official references:
-- https://supabase.com/docs/guides/functions/schedule-functions
-- https://supabase.com/docs/guides/database/extensions/pg_net
-- https://supabase.com/docs/guides/database/vault
-- https://supabase.com/docs/guides/cron/quickstart
-- https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16
begin;

do $preflight$
begin
  if current_user <> 'postgres' then
    raise exception 'Run this optional Google Calendar cron setup as postgres.';
  end if;
  if not exists(select 1 from pg_extension where extname='pg_cron')
    or not exists(select 1 from pg_extension where extname='pg_net')
    or to_regclass('vault.decrypted_secrets') is null
    or to_regclass('net.http_request_queue') is null
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'Enable supported pg_cron, pg_net and Vault before scheduling Google Calendar.';
  end if;
  if to_regclass('public.google_calendar_sync_queue') is null then
    raise exception 'Apply GOOGLE_CALENDAR_SYNC.sql first.';
  end if;
end;
$preflight$;

do $api_access$
declare v_role text; v_schemas text;
begin
  -- Supabase manages pg_net's PUBLIC grants. Do not revoke or replace them:
  -- browser isolation comes from NOLOGIN roles and the unexposed net schema.
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if not exists(select 1 from pg_roles where rolname=v_role and not rolcanlogin) then
      raise exception 'An application role can log in directly; audit database access before enabling cron.';
    end if;
  end loop;
  foreach v_role in array array['anon','authenticated'] loop
    if has_column_privilege(v_role,'vault.decrypted_secrets','decrypted_secret','SELECT') then
      raise exception 'Vault secrets are readable by a browser role; audit privileges first.';
    end if;
  end loop;
  -- Database-specific role settings override the role-wide setting. A missing
  -- value can mean PostgREST uses Dashboard/environment configuration; it is
  -- unknown, never proof of privacy. Only an explicit operator check covers it.
  select btrim(substr(setting,length('pgrst.db_schemas=')+1)) into v_schemas
  from pg_db_role_setting s
  join pg_roles r on r.oid=s.setrole
  cross join lateral unnest(s.setconfig) as config(setting)
  where r.rolname='authenticator'
    and s.setdatabase in (0,(select oid from pg_database where datname=current_database()))
    and split_part(setting,'=',1)='pgrst.db_schemas'
  order by (s.setdatabase<>0) desc limit 1;
  if v_schemas is not null then
    -- Refuse an unrecognized quoted/custom format instead of assuming it safe.
    if v_schemas !~ '^[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*)*$'
      or regexp_split_to_array(v_schemas,'\s*,\s*') && array['net','vault'] then
      raise exception 'PostgREST exposed schemas are unsafe or unrecognized; verify net and vault are excluded.';
    end if;
  elsif current_setting('alinflow.calendar_net_schema_not_exposed',true) is distinct from 'confirmed' then
    raise exception 'PostgREST exposed schemas are unknown. Inspect Data API settings, then explicitly confirm for this transaction.';
  end if;
end;
$api_access$;

do $configuration$
declare v_origin text; v_secret text;
begin
  select decrypted_secret into v_origin from vault.decrypted_secrets where name='alinflow_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='alinflow_google_calendar_cron_secret';
  if v_origin is null or v_origin !~ '^https://([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$'
    or v_secret is null or length(v_secret) not between 32 and 512 or v_secret !~ '^[A-Za-z0-9_+/=-]+$' then
    raise exception 'Configure the canonical HTTPS origin and cron token in the two named Vault secrets.';
  end if;
  if exists(select 1 from cron.job where jobname='alinflow-google-calendar-sync'
    and (username <> 'postgres' or database <> current_database()
      or command <> 'select public.dispatch_google_calendar_sync();')) then
    raise exception 'A different cron job already uses the Google Calendar job name; nothing was replaced.';
  end if;
end;
$configuration$;

create or replace function public.dispatch_google_calendar_sync()
returns bigint language plpgsql security definer set search_path='' set row_security=off as $dispatch$
declare v_origin text; v_secret text;
begin
  -- Idle or paused workspaces do not cause Vercel invocations. The application
  -- route still uses its atomic claim RPC; this check is only a cheap wake-up gate.
  if not exists (select 1 from public.google_calendar_sync_queue q
    join public.google_calendar_connections c on c.workspace_id=q.workspace_id
    join public.workspaces w on w.id=q.workspace_id
    where q.desired_version>q.synced_version and c.status='connected' and w.active
      and q.next_attempt_at<=clock_timestamp()
      and (q.lease_expires_at is null or q.lease_expires_at<=clock_timestamp())) then
    return null;
  end if;
  select decrypted_secret into v_origin from vault.decrypted_secrets where name='alinflow_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='alinflow_google_calendar_cron_secret';
  if v_origin is null or v_origin !~ '^https://([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$'
    or v_secret is null or length(v_secret) not between 32 and 512 or v_secret !~ '^[A-Za-z0-9_+/=-]+$' then
    raise exception 'Google Calendar cron Vault configuration is missing or invalid.';
  end if;
  return net.http_post(
    url:=v_origin || '/api/google-calendar/cron',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_secret),
    body:='{}'::jsonb,
    timeout_milliseconds:=55000
  );
end;
$dispatch$;
alter function public.dispatch_google_calendar_sync() owner to postgres;
revoke all on function public.dispatch_google_calendar_sync() from public,anon,authenticated,service_role;
-- The postgres function owner retains EXECUTE. No application role receives it.

select cron.schedule('alinflow-google-calendar-sync','* * * * *',
  'select public.dispatch_google_calendar_sync();');

commit;

-- Verification: inspect this named job in Supabase Cron and its History.
-- A successful cron SQL run means pg_net queued the request, not that HTTP
-- finished. Inspect net._http_response status_code/timed_out/error_msg for HTTP
-- outcomes; never copy outgoing Authorization headers or Vault values to logs.
-- Pause only this job through its Active toggle in the Supabase Cron dashboard.
-- Re-running this template updates this same named postgres job; no jobs are deleted.
