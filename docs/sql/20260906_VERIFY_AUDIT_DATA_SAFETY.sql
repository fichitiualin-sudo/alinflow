-- READ ONLY. Run after 20260906_AUDIT_DATA_SAFETY.sql as database administrator.
-- All passed values must be true; every issue count must be zero.
-- Nonzero counts require individual review, never automatic deletion.
begin read only;

with expected(table_name,column_name,udt_name) as (
  values ('appointments','material_usage','jsonb'),('appointments','stock_deducted_at','timestamptz'),
    ('work_checklists','id','uuid'),('work_checklists','completed_at','jsonb')
)
select e.table_name || '.' || e.column_name as check_name,
  coalesce(c.udt_name=e.udt_name,false) as passed
from expected e left join information_schema.columns c on c.table_schema='public'
  and c.table_name=e.table_name and c.column_name=e.column_name;

with expected(signature) as (
  values
    ('public.require_workspace_member(uuid)'),
    ('public.save_quote_with_items(uuid,uuid,uuid,uuid,text,text,jsonb)'),
    ('public.save_appointment_with_resources(uuid,uuid,uuid,text,date,text,text,text,text,text,uuid,uuid,jsonb)'),
    ('public.complete_installation(uuid,uuid,text,jsonb,jsonb)'),
    ('public.adjust_climate_stock(uuid,text,numeric)'),
    ('public.adjust_material_stock(uuid,text,numeric)')
)
select e.signature as check_name, coalesce(
  not p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not has_function_privilege('anon',p.oid,'EXECUTE'),false) as passed
from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature);

with expected(table_name,trigger_name) as (
  values ('appointments','appointments_guard_work_scope'),('work_reports','work_reports_guard_work_scope'),
    ('quotes','quotes_guard_work_scope'),('work_checklists','work_checklists_guard_work_scope')
)
select e.trigger_name as check_name,
  coalesce(t.tgenabled in ('O','A') and t.tgfoid=to_regprocedure('public.guard_work_scope()'),false) as passed
from expected e left join pg_trigger t on t.tgrelid=to_regclass('public.'||e.table_name)
  and t.tgname=e.trigger_name;

with expected(index_name,column_names) as (
  values ('documents_scope_nulls_uidx',array['workspace_id','customer_id','document_type','appointment_id']),
    ('work_checklists_scope_nulls_uidx',array['workspace_id','customer_id','appointment_id'])
)
select e.index_name as check_name, coalesce(i.indisunique and i.indisvalid and i.indisready
  and i.indnullsnotdistinct and array(
    select a.attname::text from unnest(i.indkey) with ordinality k(attnum,pos)
    join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
    order by k.pos
  )=e.column_names,false) as passed
from expected e left join pg_index i on i.indexrelid=to_regclass('public.'||e.index_name);

select 'duplicate document scopes' as issue,count(*)::bigint as count_value
from (select 1 from public.documents group by workspace_id,customer_id,document_type,appointment_id having count(*)>1) d
union all
select 'duplicate checklist scopes',count(*)::bigint
from (select 1 from public.work_checklists group by workspace_id,customer_id,appointment_id having count(*)>1) d
union all
select 'report linked to foreign work or different work type',count(*)::bigint
from public.work_reports r left join public.appointments a on a.id=r.appointment_id
where r.appointment_id is not null and (a.id is null or a.customer_id is distinct from r.customer_id
  or a.workspace_id is distinct from r.workspace_id or a.appointment_type is distinct from r.appointment_type)
union all
select 'quote linked to foreign work',count(*)::bigint
from public.quotes q left join public.appointments a on a.id=q.appointment_id
where q.appointment_id is not null and (a.id is null or a.customer_id is distinct from q.customer_id
  or a.workspace_id is distinct from q.workspace_id)
union all
select 'completed installation missing stock marker',count(*)::bigint
from public.appointments where appointment_type='installation'
  and status in ('Szerelés kész – admin folyamatban','Lezárva') and stock_deducted_at is null
union all
select 'negative or invalid climate stock',count(*)::bigint
from public.inventory_stock where stock is null or stock<0 or stock::text in ('NaN','Infinity','-Infinity')
union all
select 'negative or invalid material stock',count(*)::bigint
from public.material_inventory where stock is null or stock<0 or stock::text in ('NaN','Infinity','-Infinity');

commit;
