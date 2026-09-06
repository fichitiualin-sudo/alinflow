-- READ ONLY. Run as database administrator before the audit migration.
-- Every passed value must be true. Investigate failures; do not delete data.
begin read only;

with required_columns(table_name, column_name, udt_name) as (
  values
    ('workspace_members','workspace_id','uuid'),
    ('workspace_members','user_id','uuid'),
    ('workspace_members','active','bool'),
    ('customers','id','uuid'),
    ('customers','workspace_id','uuid'),
    ('customers','stock_deducted','bool'),
    ('appointments','id','uuid'),
    ('appointments','customer_id','uuid'),
    ('appointments','workspace_id','uuid'),
    ('appointments','quote_id','uuid'),
    ('appointments','appointment_type','text'),
    ('appointments','scheduled_date','date'),
    ('appointments','scheduled_time','text'),
    ('appointments','status','text'),
    ('appointments','updated_at','timestamptz'),
    ('appointments','created_at','timestamptz'),
    ('appointments','legacy_source_key','text'),
    ('quotes','id','uuid'),
    ('quotes','workspace_id','uuid'),
    ('quotes','customer_id','uuid'),
    ('quotes','appointment_id','uuid'),
    ('quote_items','quote_id','uuid'),
    ('quote_items','workspace_id','uuid'),
    ('quote_items','description','text'),
    ('work_reports','customer_id','uuid'),
    ('work_reports','workspace_id','uuid'),
    ('work_reports','appointment_id','uuid'),
    ('work_reports','appointment_type','text'),
    ('work_reports','work_date','date'),
    ('work_reports','work_time','text'),
    ('work_checklists','workspace_id','uuid'),
    ('work_checklists','customer_id','uuid'),
    ('work_checklists','appointment_id','uuid'),
    ('documents','workspace_id','uuid'),
    ('documents','customer_id','uuid'),
    ('documents','appointment_id','uuid'),
    ('documents','document_type','text'),
    ('jobs','workspace_id','uuid'),
    ('jobs','customer_id','uuid'),
    ('jobs','legacy_source_key','text'),
    ('inventory_stock','workspace_id','uuid'),
    ('inventory_stock','product_id','text'),
    ('material_inventory','workspace_id','uuid'),
    ('material_inventory','name','text'),
    ('climate_products','workspace_id','uuid'),
    ('climate_products','id','text')
)
select r.table_name || '.' || r.column_name as check_name,
  coalesce(c.udt_name = r.udt_name, false) as passed,
  r.udt_name as expected_type, c.udt_name as actual_type
from required_columns r
left join information_schema.columns c on c.table_schema='public'
  and c.table_name=r.table_name and c.column_name=r.column_name
order by r.table_name,r.column_name;

select 'PostgreSQL 15 or newer' as check_name,
  current_setting('server_version_num')::int >= 150000 as passed
union all
select 'workspace-scoped appointment RPC exists',
  to_regprocedure('public.save_appointment_with_job_mirror(uuid,uuid,uuid,text,date,text,text,text,text,text,uuid,uuid)') is not null;

with tables(name) as (
  values ('customers'),('appointments'),('quotes'),('quote_items'),('jobs'),
    ('documents'),('work_reports'),('work_checklists'),('inventory_stock'),('material_inventory')
)
select t.name || ' RLS enabled' as check_name, coalesce(c.relrowsecurity,false) as passed
from tables t left join pg_class c on c.oid=to_regclass('public.' || t.name);

-- Inspect the policies as well: enabled RLS alone does not prove isolation.
select tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public'
  and tablename in ('workspace_members','customers','appointments','quotes','quote_items',
    'work_reports','work_checklists','documents','inventory_stock','material_inventory');

-- Existing uniqueness / dependencies must be reviewed before replacing old keys.
select c.conrelid::regclass as relation,c.conname,pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid in (to_regclass('public.work_checklists'),to_regclass('public.documents'))
  or c.confrelid=to_regclass('public.work_checklists');
select tablename,indexname,indexdef from pg_indexes
where schemaname='public' and tablename in ('work_checklists','documents','inventory_stock','material_inventory');

commit;
