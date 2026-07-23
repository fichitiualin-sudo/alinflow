-- AlinFlow workspace settings
-- Additive, idempotent migration. Do not store API keys or other secrets here.

begin;

create table if not exists public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  company_profile jsonb not null default '{}'::jsonb,
  quote_settings jsonb not null default '{}'::jsonb,
  email_settings jsonb not null default '{}'::jsonb,
  billing_settings jsonb not null default '{}'::jsonb,
  document_settings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_settings_updated_by_idx
  on public.workspace_settings(updated_by);

alter table public.workspace_settings enable row level security;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workspace_settings'
      and policyname = 'workspace_settings_member_select'
  ) then
    drop policy workspace_settings_member_select on public.workspace_settings;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workspace_settings'
      and policyname = 'workspace_settings_member_insert'
  ) then
    drop policy workspace_settings_member_insert on public.workspace_settings;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workspace_settings'
      and policyname = 'workspace_settings_member_update'
  ) then
    drop policy workspace_settings_member_update on public.workspace_settings;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workspace_settings'
      and policyname = 'workspace_settings_member_delete'
  ) then
    drop policy workspace_settings_member_delete on public.workspace_settings;
  end if;
end $$;

create policy workspace_settings_member_select
  on public.workspace_settings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspace_settings.workspace_id
        and wm.user_id = auth.uid()
        and wm.active
    )
  );

create policy workspace_settings_member_insert
  on public.workspace_settings
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspace_settings.workspace_id
        and wm.user_id = auth.uid()
        and wm.active
    )
  );

create policy workspace_settings_member_update
  on public.workspace_settings
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspace_settings.workspace_id
        and wm.user_id = auth.uid()
        and wm.active
    )
  )
  with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspace_settings.workspace_id
        and wm.user_id = auth.uid()
        and wm.active
    )
  );

create policy workspace_settings_member_delete
  on public.workspace_settings
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspace_settings.workspace_id
        and wm.user_id = auth.uid()
        and wm.active
    )
  );

insert into public.workspace_settings (
  workspace_id,
  company_profile,
  quote_settings,
  email_settings,
  billing_settings,
  document_settings
)
select
  w.id,
  jsonb_build_object(
    'displayName', 'KLIMAlin',
    'legalName', 'Adorján Alin E.V.',
    'phone', '06 30 700 4908',
    'email', 'klima.alin@gmail.com',
    'address', '',
    'website', 'klimalin.hu',
    'secondaryWebsite', 'legkondikalkulator.hu',
    'logoUrl', '/alin-klima-logo.png'
  ),
  jsonb_build_object(
    'title', 'KLIMAlin árajánlat',
    'subtitle', 'Klímaberendezés alapszereléssel együtt',
    'validityDays', 7,
    'bundleIntro', 'A telefonos / online egyeztetés alapján az alábbi klímás ajánlatot küldjük. Az árak bruttó összegek, és alapszereléssel együtt értendők.',
    'alternativesIntro', 'A telefonos / online egyeztetés alapján az alábbi választható klímás ajánlatokat küldjük. Az árak bruttó összegek, alapszereléssel együtt, és külön-külön értendők.',
    'acceptanceText', 'Amennyiben megfelel Önnek az ajánlat, válasz emailben vagy telefonon tudunk időpontot egyeztetni.',
    'installationSectionTitle', 'Alapszerelés tartalma',
    'installationSectionContent', 'max. 3 m szigetelt rézcső-pár / klíma' || chr(10) || '1 db faláttörés, tömítés és esztétikus lezárás' || chr(10) || 'kondenzvíz elvezetés kialakítása gravitációsan, megfelelő lejtéssel, adottság szerint' || chr(10) || 'kültéri fali konzol vastag rezgéscsillapítókkal, max. 4 m szerelési magasságig, létraállással' || chr(10) || 'kábelcsatorna és rögzítők a szükséges mértékben' || chr(10) || 'betáp kábel max. 5 m-ig' || chr(10) || 'nyomáspróba + vákuumozás + beüzemelés, működési teszt' || chr(10) || 'felhasználói betanítás, rendrakás',
    'qualitySectionTitle', 'Minőségi kivitelezés',
    'qualitySectionContent', 'Alukasírozott, hőszigetelt rézcső-pár.' || chr(10) || 'Időjárásálló gumikábel a teljes nyomvonalon.' || chr(10) || 'Stabil konzol + vastag rezgéscsillapítók a kültéri egységnél.' || chr(10) || 'Szakszerű faláttörés, tömítés és esztétikus lezárás.' || chr(10) || 'Nyomáspróba + vákuumozás, majd beüzemelés és működési teszt.' || chr(10) || 'Betanítás, szűrőtisztítás ismertetése + rendrakás a végén.',
    'footerText', 'Adorján Alin · KLIMAlin' || chr(10) || 'klimalin.hu · legkondikalkulator.hu · 06 30 700 4908'
  ),
  jsonb_build_object(
    'senderName', 'KLIMAlin',
    'footerText', 'Adorján Alin · KLIMAlin' || chr(10) || 'klimalin.hu · legkondikalkulator.hu · 06 30 700 4908',
    'appointmentHeaderText', 'időpont visszaigazolás',
    'thankYouTitle', 'Köszönjük, hogy minket választottak!',
    'thankYouIntro', 'Örülünk, hogy ránk bízták a klíma telepítését. Használják egészséggel, sok kellemesen hűvös napot kívánunk!'
  ),
  jsonb_build_object(
    'defaultPaymentMethod', 'cash',
    'transferDueDays', 2,
    'deviceInvoiceLabel', 'Készülék és anyag',
    'laborInvoiceLabel', 'Munkadíj',
    'maintenanceInvoiceLabel', 'Légkondicionáló karbantartás',
    'sendInvoiceEmailByDefault', true
  ),
  jsonb_build_object(
    'workReportFooterText', 'Adorján Alin · KLIMAlin' || chr(10) || 'klimalin.hu · legkondikalkulator.hu · 06 30 700 4908',
    'quoteFooterText', 'Adorján Alin · KLIMAlin' || chr(10) || 'klimalin.hu · legkondikalkulator.hu · 06 30 700 4908'
  )
from public.workspaces w
where w.slug = 'alinflow-existing'
on conflict (workspace_id) do nothing;

insert into public.workspace_settings (
  workspace_id,
  company_profile,
  quote_settings,
  email_settings,
  billing_settings,
  document_settings
)
select
  w.id,
  jsonb_build_object(
    'displayName', w.name,
    'legalName', '',
    'phone', '',
    'email', '',
    'address', '',
    'website', '',
    'secondaryWebsite', '',
    'logoUrl', ''
  ),
  jsonb_build_object(
    'title', w.name || ' árajánlat',
    'subtitle', 'Klímaberendezés alapszereléssel együtt',
    'validityDays', 7,
    'bundleIntro', 'A telefonos / online egyeztetés alapján az alábbi klímás ajánlatot küldjük. Az árak bruttó összegek, és alapszereléssel együtt értendők.',
    'alternativesIntro', 'A telefonos / online egyeztetés alapján az alábbi választható klímás ajánlatokat küldjük. Az árak bruttó összegek, alapszereléssel együtt, és külön-külön értendők.',
    'acceptanceText', 'Amennyiben megfelel Önnek az ajánlat, válasz emailben vagy telefonon tudunk időpontot egyeztetni.',
    'installationSectionTitle', 'Alapszerelés tartalma',
    'installationSectionContent', 'max. 3 m szigetelt rézcső-pár / klíma' || chr(10) || '1 db faláttörés, tömítés és esztétikus lezárás' || chr(10) || 'kondenzvíz elvezetés kialakítása gravitációsan, megfelelő lejtéssel, adottság szerint' || chr(10) || 'kültéri fali konzol vastag rezgéscsillapítókkal, max. 4 m szerelési magasságig, létraállással' || chr(10) || 'kábelcsatorna és rögzítők a szükséges mértékben' || chr(10) || 'betáp kábel max. 5 m-ig' || chr(10) || 'nyomáspróba + vákuumozás + beüzemelés, működési teszt' || chr(10) || 'felhasználói betanítás, rendrakás',
    'qualitySectionTitle', 'Minőségi kivitelezés',
    'qualitySectionContent', 'Alukasírozott, hőszigetelt rézcső-pár.' || chr(10) || 'Időjárásálló gumikábel a teljes nyomvonalon.' || chr(10) || 'Stabil konzol + vastag rezgéscsillapítók a kültéri egységnél.' || chr(10) || 'Szakszerű faláttörés, tömítés és esztétikus lezárás.' || chr(10) || 'Nyomáspróba + vákuumozás, majd beüzemelés és működési teszt.' || chr(10) || 'Betanítás, szűrőtisztítás ismertetése + rendrakás a végén.',
    'footerText', ''
  ),
  jsonb_build_object(
    'senderName', w.name,
    'footerText', '',
    'appointmentHeaderText', 'időpont visszaigazolás',
    'thankYouTitle', 'Köszönjük, hogy minket választottak!',
    'thankYouIntro', 'Köszönjük a bizalmat és a korrekt együttműködést.'
  ),
  jsonb_build_object(
    'defaultPaymentMethod', 'cash',
    'transferDueDays', 2,
    'deviceInvoiceLabel', 'Készülék és anyag',
    'laborInvoiceLabel', 'Munkadíj',
    'maintenanceInvoiceLabel', 'Légkondicionáló karbantartás',
    'sendInvoiceEmailByDefault', true
  ),
  jsonb_build_object(
    'workReportFooterText', '',
    'quoteFooterText', ''
  )
from public.workspaces w
where not exists (
  select 1
  from public.workspace_settings ws
  where ws.workspace_id = w.id
);

commit;
