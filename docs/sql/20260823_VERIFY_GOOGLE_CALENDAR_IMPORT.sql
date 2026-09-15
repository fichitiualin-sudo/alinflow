-- Run after 20260823_ADD_GOOGLE_CALENDAR_IMPORT.sql.
-- Every passed value must be true and every count_value must be 0.

select
  'workspace_settings.calendar_settings exists' as check_name,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workspace_settings'
      and column_name = 'calendar_settings'
      and data_type = 'jsonb'
  ) as passed;

select
  'google_calendar_event_links table exists' as check_name,
  to_regclass('public.google_calendar_event_links') is not null as passed;

select
  'google_calendar_event_links RLS enabled' as check_name,
  coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'google_calendar_event_links'
  ), false) as passed;

select
  'google_calendar_event_links unique indexes exist' as check_name,
  count(*) = 2 as passed
from pg_indexes
where schemaname = 'public'
  and tablename = 'google_calendar_event_links'
  and indexname in (
    'google_calendar_event_links_event_uidx',
    'google_calendar_event_links_appointment_uidx'
  );

select
  'google_calendar_event_links member policies exist' as check_name,
  count(*) = 4 as passed
from pg_policies
where schemaname = 'public'
  and tablename = 'google_calendar_event_links'
  and policyname in (
    'google_calendar_event_links_member_select',
    'google_calendar_event_links_member_insert',
    'google_calendar_event_links_member_update',
    'google_calendar_event_links_member_delete'
  );

select 'google links with invalid workspace' as issue, count(*) as count_value
from public.google_calendar_event_links l
left join public.workspaces w on w.id = l.workspace_id
where w.id is null
union all
select 'google links with invalid appointment', count(*)
from public.google_calendar_event_links l
left join public.appointments a on a.id = l.appointment_id
where a.id is null
union all
select 'google links crossing workspace boundary', count(*)
from public.google_calendar_event_links l
join public.appointments a on a.id = l.appointment_id
where a.workspace_id is distinct from l.workspace_id
union all
select 'duplicate google event links', count(*)
from (
  select workspace_id, google_calendar_id, google_event_id
  from public.google_calendar_event_links
  group by workspace_id, google_calendar_id, google_event_id
  having count(*) > 1
) duplicates
union all
select 'appointments linked to multiple google events', count(*)
from (
  select workspace_id, appointment_id
  from public.google_calendar_event_links
  group by workspace_id, appointment_id
  having count(*) > 1
) duplicates;
