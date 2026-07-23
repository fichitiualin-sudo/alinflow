select *
from (
  values
    ('workspaces table exists', to_regclass('public.workspaces') is not null),
    ('workspace_members table exists', to_regclass('public.workspace_members') is not null),
    ('customers.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'workspace_id')),
    ('appointments.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'appointments' and column_name = 'workspace_id')),
    ('jobs.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'workspace_id')),
    ('quotes.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quotes' and column_name = 'workspace_id')),
    ('quote_items.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quote_items' and column_name = 'workspace_id')),
    ('documents.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'workspace_id')),
    ('work_reports.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'work_reports' and column_name = 'workspace_id')),
    ('work_checklists.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'work_checklists' and column_name = 'workspace_id')),
    ('purchase_declarations.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchase_declarations' and column_name = 'workspace_id')),
    ('maintenance_appointment_items.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_appointment_items' and column_name = 'workspace_id')),
    ('seller_companies.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'seller_companies' and column_name = 'workspace_id')),
    ('climate_products.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'climate_products' and column_name = 'workspace_id')),
    ('inventory_stock.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_stock' and column_name = 'workspace_id')),
    ('material_inventory.workspace_id exists', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'material_inventory' and column_name = 'workspace_id')),
    ('workspace material unique index exists', to_regclass('public.material_inventory_workspace_name_uidx') is not null),
    ('workspace inventory unique index exists', to_regclass('public.inventory_stock_workspace_product_uidx') is not null),
    ('workspace seller unique index exists', to_regclass('public.seller_companies_workspace_name_tax_uidx') is not null),
    ('save appointment workspace function exists', to_regprocedure('public.save_appointment_with_job_mirror(uuid, uuid, uuid, text, date, text, text, text, text, text, uuid, uuid)') is not null),
    ('cancel appointment workspace function exists', to_regprocedure('public.cancel_appointment_with_job_mirror(uuid, uuid, timestamptz, text, uuid)') is not null)
) as checks(check_name, passed);

select 'customers_without_workspace' as issue, count(*) as count_value from public.customers where workspace_id is null
union all select 'appointments_without_workspace', count(*) from public.appointments where workspace_id is null
union all select 'jobs_without_workspace', count(*) from public.jobs where workspace_id is null
union all select 'quotes_without_workspace', count(*) from public.quotes where workspace_id is null
union all select 'quote_items_without_workspace', count(*) from public.quote_items where workspace_id is null
union all select 'documents_without_workspace', count(*) from public.documents where workspace_id is null
union all select 'work_reports_without_workspace', count(*) from public.work_reports where workspace_id is null
union all select 'work_checklists_without_workspace', count(*) from public.work_checklists where workspace_id is null
union all select 'purchase_declarations_without_workspace', count(*) from public.purchase_declarations where workspace_id is null
union all select 'maintenance_items_without_workspace', count(*) from public.maintenance_appointment_items where workspace_id is null
union all select 'seller_companies_without_workspace', count(*) from public.seller_companies where workspace_id is null
union all select 'climate_products_without_workspace', count(*) from public.climate_products where workspace_id is null
union all select 'inventory_stock_without_workspace', count(*) from public.inventory_stock where workspace_id is null
union all select 'material_inventory_without_workspace', count(*) from public.material_inventory where workspace_id is null
order by issue;

select
  w.id,
  w.name,
  w.slug,
  count(wm.user_id) as member_count
from public.workspaces w
left join public.workspace_members wm on wm.workspace_id = w.id and wm.active
group by w.id, w.name, w.slug
order by w.created_at;

select
  p.tablename,
  p.policyname,
  p.cmd,
  p.roles,
  p.qual,
  p.with_check
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in (
    'customers',
    'appointments',
    'jobs',
    'quotes',
    'quote_items',
    'documents',
    'work_reports',
    'work_checklists',
    'purchase_declarations',
    'maintenance_appointment_items',
    'seller_companies',
    'climate_products',
    'inventory_stock',
    'material_inventory'
  )
  and (
    p.qual = 'true'
    or p.with_check = 'true'
  )
order by p.tablename, p.policyname;
