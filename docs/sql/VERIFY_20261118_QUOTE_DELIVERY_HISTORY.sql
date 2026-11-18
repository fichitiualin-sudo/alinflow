-- Read-only release check. Returns permissions and schema presence, without customer content.
select to_regclass('public.quote_delivery_history') is not null as history_installed,
       coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.quote_delivery_history')),false) as history_rls,
       exists(select 1 from pg_policies where schemaname='public' and tablename='quote_delivery_history'
         and policyname='read_sent_quotes' and cmd='SELECT' and 'authenticated'=any(roles)
         and qual like '%active_workspace_member%' and qual like '%sent_at IS NOT NULL%') as scoped_confirmed_reads,
       has_column_privilege('authenticated','public.quote_delivery_history','items','SELECT') as member_can_read_lines,
       not has_column_privilege('authenticated','public.quote_delivery_history','email_payload','SELECT') as private_envelope,
       not has_any_column_privilege('authenticated','public.quote_delivery_history','INSERT')
         and not has_any_column_privilege('authenticated','public.quote_delivery_history','UPDATE')
         and not has_table_privilege('authenticated','public.quote_delivery_history','DELETE') as immutable_client,
       not has_any_column_privilege('anon','public.quote_delivery_history','SELECT') as no_anonymous_read,
       bool_and(p.oid is not null and not p.prosecdef
         and has_function_privilege('service_role',p.oid,'EXECUTE')
         and not has_function_privilege('authenticated',p.oid,'EXECUTE')
         and not has_function_privilege('anon',p.oid,'EXECUTE')) as server_only_recording
from (values ('public.prepare_quote_delivery(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb,numeric,text,text)'),
             ('public.confirm_quote_delivery(uuid,uuid,uuid,text)')) expected(signature)
left join pg_proc p on p.oid=to_regprocedure(expected.signature);
