-- AlinFlow workspace settings verification

select
  'workspace_settings table exists' as check_name,
  (to_regclass('public.workspace_settings') is not null) as passed;

select
  'workspace_settings required columns exist' as check_name,
  (count(*) = 8) as passed
from information_schema.columns
where table_schema = 'public'
  and table_name = 'workspace_settings'
  and column_name in (
    'workspace_id',
    'company_profile',
    'quote_settings',
    'email_settings',
    'billing_settings',
    'document_settings',
    'created_at',
    'updated_at'
  );

select
  'workspace_settings RLS enabled' as check_name,
  coalesce(c.relrowsecurity, false) as passed
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'workspace_settings';

select
  'workspace_settings member policies exist' as check_name,
  (count(*) = 4) as passed
from pg_policies
where schemaname = 'public'
  and tablename = 'workspace_settings'
  and policyname in (
    'workspace_settings_member_select',
    'workspace_settings_member_insert',
    'workspace_settings_member_update',
    'workspace_settings_member_delete'
  );

select
  'workspace_settings rows match existing workspaces' as check_name,
  not exists (
    select 1
    from public.workspaces w
    where not exists (
      select 1
      from public.workspace_settings ws
      where ws.workspace_id = w.id
    )
  ) as passed;

select
  'workspace_settings invalid workspace references' as check_name,
  not exists (
    select 1
    from public.workspace_settings ws
    left join public.workspaces w on w.id = ws.workspace_id
    where w.id is null
  ) as passed;

select
  'workspace_settings no obvious secret keys stored' as check_name,
  not exists (
    select 1
    from public.workspace_settings ws
    where ws.company_profile::text ilike '%agent_key%'
       or ws.company_profile::text ilike '%api_key%'
       or ws.quote_settings::text ilike '%agent_key%'
       or ws.quote_settings::text ilike '%api_key%'
       or ws.email_settings::text ilike '%agent_key%'
       or ws.email_settings::text ilike '%api_key%'
       or ws.billing_settings::text ilike '%agent_key%'
       or ws.billing_settings::text ilike '%api_key%'
       or ws.document_settings::text ilike '%agent_key%'
       or ws.document_settings::text ilike '%api_key%'
  ) as passed;
