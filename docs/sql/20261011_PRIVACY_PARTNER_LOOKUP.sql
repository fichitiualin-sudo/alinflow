-- Exact lookup for the server-side privacy partner chooser. No data, grants on
-- business tables, RLS policies, memberships or signed documents are changed.
-- Dependencies: auth.users(id,email,email_confirmed_at,banned_until,deleted_at),
-- public.workspaces(id,name,active), workspace_members(workspace_id,user_id,active),
-- workspace_settings(workspace_id,document_settings); Supabase service_role role.
begin;

create or replace function public.lookup_privacy_partner(
  p_email text default null,
  p_user_id uuid default null,
  p_workspace_id uuid default null
)
returns table(user_id uuid, workspace_id uuid, workspace_name text, party jsonb)
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select u.id, w.id, w.name,
    jsonb_build_object(
      'legalName', s.document_settings #>> '{privacyNotice,serviceProvider,legalName}',
      'address', s.document_settings #>> '{privacyNotice,serviceProvider,address}',
      'email', s.document_settings #>> '{privacyNotice,serviceProvider,email}',
      'phone', s.document_settings #>> '{privacyNotice,serviceProvider,phone}',
      'taxNumber', s.document_settings #>> '{privacyNotice,serviceProvider,taxNumber}'
    )
  from auth.users u
  join public.workspace_members m on m.user_id = u.id and m.active
  join public.workspaces w on w.id = m.workspace_id and w.active
  left join public.workspace_settings s on s.workspace_id = w.id
  where u.email_confirmed_at is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and (
      (p_email is not null and p_user_id is null and p_workspace_id is null
        and char_length(btrim(p_email)) between 3 and 254
        and lower(u.email) = lower(btrim(p_email)))
      or
      (p_email is null and p_user_id is not null and p_workspace_id is not null
        and u.id = p_user_id and w.id = p_workspace_id)
    )
  order by w.name, w.id, u.id
  limit 10;
$$;

revoke all on function public.lookup_privacy_partner(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.lookup_privacy_partner(text, uuid, uuid) to service_role;

comment on function public.lookup_privacy_partner(text, uuid, uuid) is
  'Server-only exact-email or user/workspace-pair lookup for the privacy-notice partner. Does not grant maintenance or workspace access.';

commit;
