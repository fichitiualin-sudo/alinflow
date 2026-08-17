begin;

alter table public.climate_products
  add column if not exists external_source text,
  add column if not exists external_key text,
  add column if not exists product_url text,
  add column if not exists image_url text,
  add column if not exists last_synced_at timestamptz;

create unique index if not exists climate_products_workspace_external_key_uidx
  on public.climate_products (workspace_id, external_source, external_key)
  where external_source is not null and external_key is not null;

commit;

select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'climate_products'
  and column_name in ('external_source', 'external_key', 'product_url', 'image_url', 'last_synced_at')
order by column_name;

select
  to_regclass('public.climate_products_workspace_external_key_uidx') is not null
    as external_key_unique_index_exists;
