-- Read-only postflight after MAINTENANCE_PRIVACY_NOTICE.sql.
-- The aggregate counts do not expose names, contact details or signatures.
select 'maintenance_version_supported' as check_name,
  coalesce(position('2026-10-11.2' in pg_get_functiondef(to_regprocedure('public.guard_work_report_privacy_notice()'))) > 0, false) as passed
union all
select 'legacy_version_supported',
  coalesce(position('2026-10-11.1' in pg_get_functiondef(to_regprocedure('public.guard_work_report_privacy_notice()'))) > 0, false)
union all
select 'private_guard_execution',
  not has_function_privilege('authenticated', 'public.guard_work_report_privacy_notice()', 'execute')
  and not has_function_privilege('anon', 'public.guard_work_report_privacy_notice()', 'execute');

select privacy_notice ->> 'version' as notice_version, count(*) as saved_notice_count
from public.work_reports
where privacy_notice is not null
group by privacy_notice ->> 'version';

select count(*) as invalid_maintenance_notice_count
from public.work_reports
where privacy_notice ->> 'version' = '2026-10-11.2'
  and (appointment_type is distinct from 'maintenance'
    or jsonb_array_length(privacy_notice -> 'controllers') <> 1
    or (privacy_notice -> 'controllers' -> 0 ->> 'role') is distinct from 'service_provider'
    or (privacy_notice ->> 'signatureDataUrl') is distinct from signature_data_url
    or (privacy_notice ->> 'signerName') is distinct from signer_name
    or (privacy_notice ->> 'signedAt')::timestamptz is distinct from signed_at::timestamptz);
