-- One-time activation of the daily Google Contacts worker; safe to repeat.
-- Deploy the daily worker BEFORE running this script as postgres.
-- Pause ONLY the alinflow-google-contacts-sync cron job, then wait until its
-- current 120-second lease has finished. Do not start manual contact sync or
-- contact approval during activation. The script refuses an active cron/lease.
-- Resume that same cron job after verification if it was active beforehand.
-- The minute schedule is a cheap queue gate: it drains one daily cohort in
-- bounded batches and makes no Vercel request when no contact is due.
-- No contact identity, state, snapshot, token, customer or calendar row changes.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $daily_contacts$
declare
  v_now timestamptz;
  v_next_utc timestamp;
  v_changed integer;
begin
  if current_user <> 'postgres' then
    raise exception 'Run daily Contacts activation as postgres.';
  end if;
  if to_regclass('public.google_contacts_links') is null
    or to_regclass('public.google_contacts_connections') is null
    or to_regclass('cron.job') is null then
    raise exception 'Existing Google Contacts sync and cron setup are required.';
  end if;
  if exists(select 1 from cron.job
    where jobname = 'alinflow-google-contacts-sync' and active) then
    raise exception 'Pause only alinflow-google-contacts-sync before activation.';
  end if;

  -- Serialize against claim/release and connection changes. A pre-existing
  -- worker is never overtaken: wait for its lease to expire before retrying.
  perform 1 from public.google_contacts_connections order by workspace_id for update;
  if exists(select 1 from public.google_contacts_connections
    where lease_token is not null and lease_expires_at > clock_timestamp()) then
    raise exception 'A Contacts sync lease is still active; wait and retry.';
  end if;

  v_now := clock_timestamp();
  v_next_utc := date_trunc('day', v_now at time zone 'UTC') + interval '3 hours';
  if v_next_utc at time zone 'UTC' <= v_now then
    v_next_utc := v_next_utc + interval '1 day';
  end if;

  -- A prior run or the daily worker already assigned 03:00 UTC: keep its date.
  -- Pending, creating, uncertain and review links retain their exact schedules
  -- and safety state, so approval/recovery work is not silently skipped.
  update public.google_contacts_links
    set next_sync_at = v_next_utc at time zone 'UTC', updated_at = clock_timestamp()
    where state = 'synced'
      and (next_sync_at at time zone 'UTC')::time <> time '03:00:00';
  get diagnostics v_changed = row_count;
  raise notice 'Daily Contacts activation: % existing synced schedules aligned.', v_changed;
end;
$daily_contacts$;

commit;

-- Read-only verification (counts and schedule only; no contact data or secrets):
-- select jobname, schedule, active from cron.job
--   where jobname = 'alinflow-google-contacts-sync';
-- select state, count(*) as links,
--   count(*) filter (where next_sync_at <= clock_timestamp()) as due,
--   count(*) filter (where (next_sync_at at time zone 'UTC')::time = time '03:00:00') as daily_slot,
--   min(next_sync_at) as earliest_next, max(next_sync_at) as latest_next
--   from public.google_contacts_links group by state order by state;
-- select count(*) as active_leases from public.google_contacts_connections
--   where lease_token is not null and lease_expires_at > clock_timestamp();
-- Re-running with cron paused and no live lease must align zero already-daily
-- rows. Keep the named cron's schedule '* * * * *'; once-per-day cron would
-- process only one batch, leaving other approved contacts behind.
-- Rollback: pause the Contacts cron and wait for leases, restore the previous
-- application, then optionally make only state='synced' links due again. Keep
-- all identities, snapshots, memberships and non-synced states unchanged.
-- Restoring the former five-minute worker also restores its higher CPU usage.
