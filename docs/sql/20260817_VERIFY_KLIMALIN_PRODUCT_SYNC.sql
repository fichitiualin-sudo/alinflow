select *
from (values
  ('climate_products.external_source exists', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'climate_products' and column_name = 'external_source'
  )),
  ('climate_products.external_key exists', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'climate_products' and column_name = 'external_key'
  )),
  ('climate_products.product_url exists', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'climate_products' and column_name = 'product_url'
  )),
  ('climate_products.image_url exists', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'climate_products' and column_name = 'image_url'
  )),
  ('climate_products.last_synced_at exists', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'climate_products' and column_name = 'last_synced_at'
  )),
  ('climate product external key unique index exists', to_regclass('public.climate_products_workspace_external_key_uidx') is not null)
) as checks(check_name, passed)
order by check_name;

select
  'duplicate KLIMAlin external keys' as issue,
  count(*)::bigint as count_value
from (
  select workspace_id, external_source, external_key
  from public.climate_products
  where external_source = 'klimalin'
    and external_key is not null
  group by workspace_id, external_source, external_key
  having count(*) > 1
) duplicates;
