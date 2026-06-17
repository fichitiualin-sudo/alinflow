begin;

create table if not exists public.seller_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_number text not null,
  representative text not null,
  active boolean not null default true,
  is_default boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists seller_companies_name_tax_uidx
  on public.seller_companies (lower(name), tax_number);

insert into public.seller_companies (name, tax_number, representative, active, is_default)
select 'AMOVA 4U Kft.', '29253630-2-13', 'Adorján Mirjam', true, true
where not exists (
  select 1
  from public.seller_companies
  where lower(name) = lower('AMOVA 4U Kft.')
    and tax_number = '29253630-2-13'
);

create table if not exists public.purchase_declarations (
  id uuid primary key default gen_random_uuid(),
  legacy_source_key text,
  customer_id uuid not null references public.customers(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  work_report_id uuid references public.work_reports(id) on delete set null,
  seller_company_id uuid references public.seller_companies(id) on delete set null,
  seller_name text not null,
  seller_tax_number text not null,
  seller_representative text not null,
  quote_items jsonb not null default '[]'::jsonb,
  signature_data_url text,
  signer_name text,
  signed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists purchase_declarations_legacy_source_key_uidx
  on public.purchase_declarations (legacy_source_key)
  where legacy_source_key is not null;

create index if not exists purchase_declarations_customer_id_idx
  on public.purchase_declarations (customer_id);

create index if not exists purchase_declarations_work_report_id_idx
  on public.purchase_declarations (work_report_id);

create index if not exists purchase_declarations_seller_company_id_idx
  on public.purchase_declarations (seller_company_id);

alter table public.seller_companies enable row level security;
alter table public.purchase_declarations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'seller_companies'
      and policyname = 'seller_companies_authenticated_all'
  ) then
    create policy seller_companies_authenticated_all
      on public.seller_companies
      for all
      to authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'purchase_declarations'
      and policyname = 'purchase_declarations_authenticated_all'
  ) then
    create policy purchase_declarations_authenticated_all
      on public.purchase_declarations
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end;
$$;

commit;
