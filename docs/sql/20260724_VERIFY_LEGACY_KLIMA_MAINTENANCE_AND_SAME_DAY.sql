-- AlinFlow legacy Klima Excel fix verification.
-- Expected main values based on the 2026-07-23 import data:
-- - hidden duplicate appointments: 15 on the current live import after the live catch-all
-- - visible same-day duplicate groups: 0
-- - maintenance appointments: 124
-- - maintenance links: 137

select 'legacy_klima_hidden_same_day_duplicates' as check_name, count(*)::bigint as count_value
from public.appointments
where legacy_source_key like 'legacy-klima-xlsx:installation:%'
  and coalesce(notes, '') like '%legacy_merged_into:%'
union all
select 'legacy_klima_visible_same_day_duplicate_groups', count(*)::bigint
from (
  select customer_id, scheduled_date
  from public.appointments
  where legacy_source_key like 'legacy-klima-xlsx:installation:%'
    and coalesce(notes, '') not like '%legacy_merged_into:%'
  group by customer_id, scheduled_date
  having count(*) > 1
) duplicates
union all
select 'legacy_klima_maintenance_appointments', count(*)::bigint
from public.appointments
where legacy_source_key like 'legacy-klima-xlsx:maintenance:%'
union all
select 'legacy_klima_maintenance_links', count(*)::bigint
from public.maintenance_appointment_items
where legacy_source_key like 'legacy-klima-xlsx:maintenance-link:%'
union all
select 'legacy_klima_maintenance_without_links', count(*)::bigint
from public.appointments a
where a.legacy_source_key like 'legacy-klima-xlsx:maintenance:%'
  and not exists (
    select 1 from public.maintenance_appointment_items mai
    where mai.maintenance_appointment_id = a.id
  )
union all
select 'legacy_klima_maintenance_links_invalid_installation', count(*)::bigint
from public.maintenance_appointment_items mai
left join public.appointments installation on installation.id = mai.installation_appointment_id
where mai.legacy_source_key like 'legacy-klima-xlsx:maintenance-link:%'
  and (
    installation.id is null
    or installation.appointment_type <> 'installation'
    or coalesce(installation.notes, '') like '%legacy_merged_into:%'
  )
union all
select 'legacy_klima_maintenance_links_invalid_maintenance', count(*)::bigint
from public.maintenance_appointment_items mai
left join public.appointments maintenance on maintenance.id = mai.maintenance_appointment_id
where mai.legacy_source_key like 'legacy-klima-xlsx:maintenance-link:%'
  and (
    maintenance.id is null
    or maintenance.appointment_type <> 'maintenance'
  )
union all
select 'legacy_klima_canonical_same_day_without_quote_items', count(*)::bigint
from public.appointments a
join public.quotes q on q.id = a.quote_id or q.appointment_id = a.id
where a.legacy_source_key like 'legacy-klima-xlsx:installation:%'
  and coalesce(a.notes, '') like '%legacy_merged_same_day_source_rows:%'
  and not exists (
    select 1 from public.quote_items qi
    where qi.quote_id = q.id
  )
union all
select 'legacy_klima_workspace_missing_on_new_maintenance', count(*)::bigint
from public.appointments
where legacy_source_key like 'legacy-klima-xlsx:maintenance:%'
  and workspace_id is null
union all
select 'legacy_klima_workspace_missing_on_new_links', count(*)::bigint
from public.maintenance_appointment_items
where legacy_source_key like 'legacy-klima-xlsx:maintenance-link:%'
  and workspace_id is null;
