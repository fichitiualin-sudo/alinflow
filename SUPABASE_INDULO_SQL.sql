create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  city text,
  address text,
  source text,
  status text default 'új lead',
  notes text,
  created_at timestamp with time zone default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  brand text,
  model text,
  name text not null,
  price_total integer,
  installer_invoice integer default 60000,
  material_invoice integer,
  created_at timestamp with time zone default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  product_id uuid references products(id),
  status text default 'időpont foglalva',
  scheduled_date date,
  scheduled_time time,
  address text,
  notes text,
  created_at timestamp with time zone default now()
);
