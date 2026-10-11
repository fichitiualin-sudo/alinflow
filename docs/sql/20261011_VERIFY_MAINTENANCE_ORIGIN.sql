-- READ ONLY. Run PRE before migration and retain results, then PRE + POST after.
-- Compare while application writes are paused. No personal data is returned.

-- PRE: counts/fingerprints of original data must match before and after migration.
select 'appointments' as table_name, count(*) as row_count,
  md5(coalesce(string_agg(md5((to_jsonb(a) - array['maintenance_origin', 'maintenance_source_name'])::text), '' order by id), '')) as original_fingerprint
from public.appointments a
union all
select 'customers', count(*), md5(coalesce(string_agg(md5(to_jsonb(c)::text), '' order by id), '')) from public.customers c
union all
select 'jobs', count(*), md5(coalesce(string_agg(md5(to_jsonb(j)::text), '' order by id), '')) from public.jobs j
union all
select 'quotes', count(*), md5(coalesce(string_agg(md5(to_jsonb(q)::text), '' order by id), '')) from public.quotes q
union all
select 'quote_items', count(*), md5(coalesce(string_agg(md5(to_jsonb(qi)::text), '' order by id), '')) from public.quote_items qi
union all
select 'documents', count(*), md5(coalesce(string_agg(md5(to_jsonb(d)::text), '' order by id), '')) from public.documents d
union all
select 'work_reports', count(*), md5(coalesce(string_agg(md5(to_jsonb(wr)::text), '' order by id), '')) from public.work_reports wr
union all
select 'work_checklists', count(*), md5(coalesce(string_agg(md5(to_jsonb(wc)::text), '' order by to_jsonb(wc)::text), '')) from public.work_checklists wc;

-- PRE: policy definitions, RLS flags, table grants and triggers must be unchanged.
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'appointments'
order by policyname;
select relrowsecurity, relforcerowsecurity, relacl
from pg_class where oid = 'public.appointments'::regclass;
select tgname, tgenabled, pg_get_triggerdef(oid) as trigger_definition
from pg_trigger where tgrelid = 'public.appointments'::regclass and not tgisinternal
order by tgname;

-- PRE: empty on first activation, both columns on reapplication.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'appointments'
  and column_name in ('maintenance_origin', 'maintenance_source_name')
order by column_name;

-- POST ONLY: all checks must be true.
select * from (values
  ('origin_column', exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'appointments'
      and column_name = 'maintenance_origin' and data_type = 'text' and is_nullable = 'NO' and column_default = '''own''::text'
  )),
  ('source_name_column', exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'appointments'
      and column_name = 'maintenance_source_name' and data_type = 'text' and is_nullable = 'YES' and column_default is null
  )),
  ('validated_constraints', (
    select count(*) = 3 from pg_constraint where conrelid = 'public.appointments'::regclass and contype = 'c' and convalidated
      and conname in ('appointments_maintenance_origin_check', 'appointments_maintenance_origin_installation_check', 'appointments_maintenance_source_name_check')
  )),
  ('appointments_rls_enabled', (select relrowsecurity from pg_class where oid = 'public.appointments'::regclass)),
  ('valid_origins', not exists (
    select 1 from public.appointments where maintenance_origin is null or maintenance_origin not in ('own', 'external')
  )),
  ('external_only_for_installations', not exists (
    select 1 from public.appointments where maintenance_origin = 'external' and coalesce(appointment_type, 'installation') <> 'installation'
  )),
  ('valid_source_names', not exists (
    select 1 from public.appointments where maintenance_source_name is not null and (
      maintenance_origin <> 'external' or char_length(maintenance_source_name) not between 1 and 160
      or maintenance_source_name <> btrim(maintenance_source_name)
      or maintenance_source_name ~ '[[:cntrl:]]|^[[:space:]]|[[:space:]]$'
    )
  ))
) checks(check_name, passed);

select conname, pg_get_constraintdef(oid) as constraint_definition
from pg_constraint where conrelid = 'public.appointments'::regclass
  and conname in ('appointments_maintenance_origin_check', 'appointments_maintenance_origin_installation_check', 'appointments_maintenance_source_name_check')
order by conname;

-- On first activation all old rows must be own and labelled_sources must be zero.
-- On reapplication these counts/fingerprints must match the pre-migration state.
select maintenance_origin, count(*) as appointment_count,
  count(*) filter (where maintenance_source_name is not null) as labelled_sources,
  md5(coalesce(string_agg(md5(jsonb_build_array(id, maintenance_origin, maintenance_source_name)::text), '' order by id), '')) as classification_fingerprint
from public.appointments group by maintenance_origin order by maintenance_origin;
