-- AlinFlow live Supabase schema audit
-- Read-only queries: these statements do not create, update or delete data.

-- 1. Tables, columns and defaults.
select
  c.table_name,
  string_agg(
    c.column_name || ' ' || c.udt_name
      || case when c.is_nullable = 'NO' then ' not null' else '' end
      || coalesce(' default ' || c.column_default, ''),
    E'\n'
    order by c.ordinal_position
  ) as columns
from information_schema.columns c
where c.table_schema = 'public'
group by c.table_name
order by c.table_name;

-- 2. Constraints.
select
  pc.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class pc on pc.oid = con.conrelid
join pg_namespace pn on pn.oid = pc.relnamespace
where pn.nspname = 'public'
order by pc.relname, con.conname;

-- 3. Indexes.
select
  tablename as table_name,
  indexname as index_name,
  indexdef as definition
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

-- 4. RLS state and policies.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;

select
  tablename as table_name,
  policyname,
  roles,
  cmd,
  permissive,
  qual as using_expression,
  with_check as check_expression
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 5. Triggers.
select
  event_object_table as table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;

-- 6. Approximate table sizes. These are PostgreSQL statistics, not exact counts.
select
  relname as table_name,
  n_live_tup as estimated_rows,
  n_dead_tup as estimated_dead_rows
from pg_stat_user_tables
where schemaname = 'public'
order by relname;

-- 7. Exact, non-personal migration-readiness counters.
select jsonb_build_object(
  'jobs_total', (select count(*) from jobs),
  'jobs_by_type', (
    select coalesce(jsonb_object_agg(coalesce(appointment_type, '<null>'), count_value), '{}'::jsonb)
    from (
      select appointment_type, count(*) as count_value
      from jobs
      group by appointment_type
    ) grouped_jobs
  ),
  'jobs_missing_customer', (select count(*) from jobs where customer_id is null),
  'jobs_missing_date', (select count(*) from jobs where scheduled_date is null),
  'customers_with_multiple_jobs', (
    select count(*)
    from (
      select customer_id
      from jobs
      where customer_id is not null
      group by customer_id
      having count(*) > 1
    ) duplicate_jobs
  ),
  'work_reports_total', (select count(*) from work_reports),
  'work_reports_by_type', (
    select coalesce(jsonb_object_agg(coalesce(appointment_type, '<null>'), count_value), '{}'::jsonb)
    from (
      select appointment_type, count(*) as count_value
      from work_reports
      group by appointment_type
    ) grouped_reports
  ),
  'customers_with_multiple_installation_reports', (
    select count(*)
    from (
      select customer_id
      from work_reports
      where coalesce(appointment_type, 'installation') = 'installation'
      group by customer_id
      having count(*) > 1
    ) duplicate_installation_reports
  ),
  'signature_image_without_signed_at', (
    select count(*)
    from work_reports
    where nullif(btrim(signature_data_url), '') is not null
      and signed_at is null
  ),
  'signed_at_without_signature_image', (
    select count(*)
    from work_reports
    where signed_at is not null
      and nullif(btrim(signature_data_url), '') is null
  )
) as migration_readiness;
