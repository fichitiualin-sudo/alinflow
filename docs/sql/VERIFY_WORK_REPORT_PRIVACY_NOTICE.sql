-- READ ONLY. Run PRE before migration, retain results, then PRE + POST afterwards.
-- No personal data or signatures are returned; fingerprints/counts detect changes.

-- PRE (also valid after migration): original work reports and policies unchanged.
select count(*) as report_count,
  count(*) filter (where signature_data_url is not null) as signed_report_count,
  md5(coalesce(string_agg(md5((to_jsonb(wr) - array['privacy_notice','privacy_consent_revoked_at'])::text), '' order by id), '')) as original_report_fingerprint
from public.work_reports wr;

select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'work_reports'
order by policyname;

select table_name, column_name, data_type, is_nullable
from information_schema.columns where table_schema = 'public'
  and table_name in ('work_reports', 'work_report_privacy_history')
  and (column_name like 'privacy_%' or table_name = 'work_report_privacy_history')
order by table_name, ordinal_position;

-- POST ONLY: all checks must be true. New counts are zero at first activation;
-- a re-run must preserve existing signed snapshots and history counts.
select * from (values
  ('notice_column', exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_reports' and column_name='privacy_notice' and data_type='jsonb' and is_nullable='YES')),
  ('revocation_column', exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_reports' and column_name='privacy_consent_revoked_at' and data_type='timestamp with time zone' and is_nullable='YES')),
  ('history_rls', (select relrowsecurity from pg_class where oid='public.work_report_privacy_history'::regclass)),
  ('history_read_only', has_table_privilege('authenticated','public.work_report_privacy_history','SELECT') and not has_table_privilege('authenticated','public.work_report_privacy_history','INSERT,UPDATE,DELETE,TRUNCATE')),
  ('history_no_anon', not has_table_privilege('anon','public.work_report_privacy_history','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
  ('history_no_cascade_fks', not exists(select 1 from pg_constraint where conrelid='public.work_report_privacy_history'::regclass and contype='f')),
  ('guard_definer_safe_path', exists(select 1 from pg_proc where oid='public.guard_work_report_privacy_notice()'::regprocedure and prosecdef and proconfig @> array['search_path=""','row_security=off'])),
  ('guard_not_directly_callable', not has_function_privilege('authenticated','public.guard_work_report_privacy_notice()','EXECUTE') and not has_function_privilege('anon','public.guard_work_report_privacy_notice()','EXECUTE')),
  ('guard_enabled', exists(select 1 from pg_trigger where tgrelid='public.work_reports'::regclass and tgname='work_reports_guard_privacy_notice' and tgenabled='O'))
) checks(check_name, passed);

select count(*) filter (where privacy_notice is not null) as notices,
  count(*) filter (where privacy_consent_revoked_at is not null) as revoked_consents,
  count(*) filter (where privacy_consent_revoked_at is not null and (privacy_notice is null or privacy_notice ->> 'consentGranted' is distinct from 'true')) as invalid_revocations,
  count(*) filter (where privacy_notice is not null and (
    privacy_notice ->> 'signatureDataUrl' is distinct from signature_data_url
    or privacy_notice ->> 'signerName' is distinct from signer_name
    or (privacy_notice ->> 'signedAt')::timestamptz is distinct from signed_at::timestamptz
  )) as mismatched_signatures
from public.work_reports;

select count(*) as history_count from public.work_report_privacy_history;
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname='public' and tablename='work_report_privacy_history' order by policyname;
