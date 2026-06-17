select
  to_regclass('public.seller_companies') is not null as seller_companies_exists,
  to_regclass('public.purchase_declarations') is not null as purchase_declarations_exists;

select
  count(*) filter (where lower(name) = lower('AMOVA 4U Kft.') and tax_number = '29253630-2-13') as amova_default_rows
from public.seller_companies;

select
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'purchase_declarations'
      and indexname = 'purchase_declarations_legacy_source_key_uidx'
  ) as purchase_declarations_legacy_unique_index_exists;

select
  count(*) as purchase_declaration_rows
from public.purchase_declarations;
