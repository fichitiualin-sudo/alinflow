-- Existing broad authenticated profile policies are narrowed, not replaced.
-- Profiles are provisioned by the trusted Auth handler; the CRM uses workspace
-- membership for authority, never profiles.role. No profile data is rewritten.
-- Idempotent. Rollback: remove these three policies and this trigger/function.
begin;
alter table public.profiles enable row level security;
drop policy if exists profiles_self_guard on public.profiles;
create policy profiles_self_guard on public.profiles as restrictive for all to authenticated
  using(id=auth.uid()) with check(id=auth.uid());
drop policy if exists profiles_provisioner_insert_guard on public.profiles;
create policy profiles_provisioner_insert_guard on public.profiles as restrictive for insert to authenticated
  with check(false);
drop policy if exists profiles_provisioner_delete_guard on public.profiles;
create policy profiles_provisioner_delete_guard on public.profiles as restrictive for delete to authenticated
  using(false);

create or replace function public.guard_profile_authority()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
  if current_user='authenticated' and (new.id,new.role,new.created_at) is distinct from (old.id,old.role,old.created_at) then
    raise exception 'A profil azonosítója és jogosultsága nem módosítható.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_profile_authority() from public,anon,authenticated;
drop trigger if exists profile_authority_guard on public.profiles;
create trigger profile_authority_guard before update on public.profiles
  for each row execute function public.guard_profile_authority();
commit;
