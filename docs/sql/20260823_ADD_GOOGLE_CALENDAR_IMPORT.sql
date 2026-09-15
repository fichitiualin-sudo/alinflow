-- AlinFlow Google Calendar future appointment import
-- Additive and idempotent. It does not delete or rewrite existing customer or appointment data.

begin;

alter table public.workspace_settings
  add column if not exists calendar_settings jsonb not null default '{}'::jsonb;

create table if not exists public.google_calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  google_calendar_id text not null,
  google_event_id text not null,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  google_updated_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.google_calendar_event_links
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  add column if not exists google_calendar_id text,
  add column if not exists google_event_id text,
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade,
  add column if not exists google_updated_at timestamptz,
  add column if not exists last_synced_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists google_calendar_event_links_event_uidx
  on public.google_calendar_event_links (workspace_id, google_calendar_id, google_event_id);

create unique index if not exists google_calendar_event_links_appointment_uidx
  on public.google_calendar_event_links (workspace_id, appointment_id);

create index if not exists google_calendar_event_links_last_synced_idx
  on public.google_calendar_event_links (workspace_id, last_synced_at desc);

alter table public.google_calendar_event_links enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'google_calendar_event_links'
      and policyname = 'google_calendar_event_links_member_select'
  ) then
    execute $policy$
      create policy google_calendar_event_links_member_select
        on public.google_calendar_event_links
        for select
        to authenticated
        using (
          exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = google_calendar_event_links.workspace_id
              and wm.user_id = auth.uid()
              and wm.active
          )
        )
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'google_calendar_event_links'
      and policyname = 'google_calendar_event_links_member_insert'
  ) then
    execute $policy$
      create policy google_calendar_event_links_member_insert
        on public.google_calendar_event_links
        for insert
        to authenticated
        with check (
          exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = google_calendar_event_links.workspace_id
              and wm.user_id = auth.uid()
              and wm.active
          )
          and exists (
            select 1 from public.appointments a
            where a.id = google_calendar_event_links.appointment_id
              and a.workspace_id = google_calendar_event_links.workspace_id
          )
        )
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'google_calendar_event_links'
      and policyname = 'google_calendar_event_links_member_update'
  ) then
    execute $policy$
      create policy google_calendar_event_links_member_update
        on public.google_calendar_event_links
        for update
        to authenticated
        using (
          exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = google_calendar_event_links.workspace_id
              and wm.user_id = auth.uid()
              and wm.active
          )
        )
        with check (
          exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = google_calendar_event_links.workspace_id
              and wm.user_id = auth.uid()
              and wm.active
          )
          and exists (
            select 1 from public.appointments a
            where a.id = google_calendar_event_links.appointment_id
              and a.workspace_id = google_calendar_event_links.workspace_id
          )
        )
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'google_calendar_event_links'
      and policyname = 'google_calendar_event_links_member_delete'
  ) then
    execute $policy$
      create policy google_calendar_event_links_member_delete
        on public.google_calendar_event_links
        for delete
        to authenticated
        using (
          exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = google_calendar_event_links.workspace_id
              and wm.user_id = auth.uid()
              and wm.active
          )
        )
    $policy$;
  end if;
end $$;

grant select, insert, update, delete on public.google_calendar_event_links to authenticated;

commit;
