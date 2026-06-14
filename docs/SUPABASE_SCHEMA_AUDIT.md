# Élő Supabase-séma audit

> Felmérés dátuma: 2026-06-14
>
> Projekt: `alinflow-db`
>
> Módszer: kizárólag olvasási lekérdezések a Supabase SQL Editorban.

## Fázishatár

Ez a stabilizálási fázis nem módosította az adatbázist, az alkalmazáskódot vagy a felhasználói működést. A cél az élő séma, a repository SQL-fájljai és a jelenlegi kód közötti eltérések rögzítése volt a későbbi additív `appointments` migráció előtt.

Az audit újrafuttatható lekérdezései:

[`docs/sql/SUPABASE_SCHEMA_AUDIT_READONLY.sql`](sql/SUPABASE_SCHEMA_AUDIT_READONLY.sql)

## Publikus táblák

Az élő `public` sémában 11 alaptábla található:

| Tábla | Elsődleges kulcs | Fontos megjegyzés |
| --- | --- | --- |
| `climate_products` | `id text` | Aktív termékek és szereléssel együtt kezelt árak. |
| `customers` | `id uuid` | Tartalmazza a `postal_code` és `stock_deducted` mezőket. |
| `documents` | `id uuid` | Egyedi: `(customer_id, document_type)`. |
| `inventory_stock` | `product_id text` | Klímánként egy készletrekord. |
| `jobs` | `id uuid` | Tartalmazza az `appointment_type` mezőt; nincs ügyfelenkénti unique constraint. |
| `material_inventory` | `name text` | Anyagonként egy készletrekord. |
| `profiles` | `id uuid` | Az `auth.users` táblára hivatkozik. |
| `quote_items` | `id uuid` | A `quotes` rekordhoz kapcsolódik. |
| `quotes` | `id uuid` | Az ügyfél ajánlatadatai. |
| `work_checklists` | `customer_id uuid` | Ügyfelenként egy checklist, `completed_at jsonb` dátumokkal. |
| `work_reports` | `id uuid` | Több rekordot enged ügyfelenként; van `appointment_type`. |

Az élő sémában **nincs `appointments` tábla**.

## Kritikus mezők és constraint-ek

### `jobs`

- `customer_id uuid`, idegen kulcs: `customers(id) on delete cascade`
- `quote_id uuid`, idegen kulcs: `quotes(id) on delete set null`
- `scheduled_date date`
- `scheduled_time text`
- `appointment_type text not null default 'installation'`
- nincs `customer_id` alapú unique constraint

A jelenlegi kód a `jobs` rekordokat `created_at desc` sorrendben tölti be, majd ügyfelenként csak az első rekordot használja. Több `jobs` rekord esetén ezért a legújabb rekord jelenne meg kompatibilitási állapotként, a többi nem lenne elérhető a jelenlegi UI-ban.

### `work_reports`

- elsődleges kulcs: `id`
- `customer_id` idegen kulcs, de nem unique
- `appointment_type text default 'installation'`
- külön index:
  - `(customer_id, appointment_type, work_date, created_at)`
  - karbantartásra szűrt `(customer_id, work_date, created_at)`

Az élő séma alkalmas több karbantartási munkalap tárolására. Nincs olyan constraint, amely ügyfelenként csak egy munkalapot engedne.

### `documents`

- egyedi constraint: `(customer_id, document_type)`
- külön index: `customer_id`
- külön index: `document_type`

Azonos statikus `document_type` értékből ügyfelenként csak egy rekord lehet. A lemondott karbantartások jelenleg dátumot és időt tartalmazó egyedi dokumentumtípussal őrződnek meg.

### `work_checklists`

- elsődleges kulcs: `customer_id`
- `completed_at jsonb not null default '{}'`

Az ügyfelenként egyetlen checklist megfelel a jelenlegi szerelési adminisztráció kompatibilitási modelljének. A karbantartási történetet nem ebben a táblában kell tárolni.

## RLS és policy-k

- Az RLS mind a 11 publikus táblán engedélyezett.
- Forced RLS egyik táblán sincs bekapcsolva.
- Minden táblán két, funkcionálisan azonos, permissive `ALL` policy található az `authenticated` szerepkör számára:
  - `AlinFlow authenticated manage ...`
  - `Authenticated users can manage ...`
- Mindkét policy-pár `using (true)` és `with check (true)` feltételt használ.

Ez jelenleg nem blokkolja az egycéges működést, de duplikált policy-kat jelent. A későbbi SQL-rendezésnél csak név szerinti, `pg_policies` alapú idempotens ellenőrzéssel szabad kezelni őket; `CREATE POLICY IF NOT EXISTS` használatára nem szabad építeni.

## Triggerek

`updated_at` frissítő trigger található az alábbi táblákon:

- `climate_products`
- `customers`
- `documents`
- `inventory_stock`
- `jobs`
- `material_inventory`
- `profiles`
- `quotes`
- `work_checklists`
- `work_reports`

A `quote_items` táblán nincs `updated_at` mező és frissítő trigger.

## Adatállapot a felméréskor

A `pg_stat_user_tables` becslései:

| Tábla | Becsült élő rekord |
| --- | ---: |
| `customers` | 46 |
| `jobs` | 16 |
| `quotes` | 46 |
| `quote_items` | 52 |
| `documents` | 112 |
| `work_reports` | 21 |
| `work_checklists` | 17 |

A migráció szempontjából releváns pontos összesítések:

- `jobs`: 16 rekord
  - 15 `installation`
  - 1 `maintenance`
  - 0 hiányzó `customer_id`
  - 0 hiányzó `scheduled_date`
  - 0 ügyfél rendelkezik egynél több `jobs` rekorddal
- `work_reports`: 21 rekord
  - 16 `installation`
  - 5 `maintenance`
  - 0 ügyfél rendelkezik egynél több szerelési munkalappal
- 0 rekordban van aláíráskép `signed_at` nélkül
- 0 rekordban van `signed_at` aláíráskép nélkül

Ezek a számok pillanatfelvételek. A következő migráció futtatása előtt ugyanazokat az ellenőrzéseket újra le kell futtatni.

## Repository és élő séma eltérései

1. A gyökérben található `SUPABASE_INDULO_SQL.sql` csak egy korai starter sémát ír le.
2. A starter SQL `products` táblát hozna létre, miközben az alkalmazás és az élő rendszer `climate_products` táblát használ.
3. A starter SQL nem tartalmazza a jelenlegi táblák többségét, az RLS policy-kat, indexeket és triggereket.
4. A kód az alábbi, repositoryból hiányzó SQL-fájlokra hivatkozik:
   - `CLIMATE_PRODUCTS_SQL.sql`
   - `INVENTORY_STOCK_SQL.sql`
   - `WORK_CHECKLIST_SQL.sql`
   - `SUPABASE_WORK_REPORT_TIPUS_OSZLOP.sql`
5. A Supabase Dashboard nem tart nyilván alkalmazott migrációt a projektben.
6. A `profiles` tábla eddig nem szerepelt a fő adatmodell-listában.

Az elavult és hiányzó SQL/README fájlok rendezése külön stabilizálási fázis. Ebben a fázisban nem szabad a starter SQL-t futtatni vagy automatikusan lecserélni.

## Következő additív migráció előfeltételei

Az `appointments` tábla bevezetésekor:

1. a `jobs` tábla neve és működése megmarad;
2. az új tábla additív és idempotens migrációval készül;
3. meglévő táblát, oszlopot, constraintet vagy adatot nem törlünk;
4. minden legacy backfill rekord egyedi `legacy_source_key` értéket kap, javasolt formában: `jobs:<jobs.id>`;
5. a `legacy_source_key` mezőhöz unique index készül;
6. a 16 meglévő `jobs` rekord backfillje újrafuttatható és konfliktusmentes;
7. az RLS policy létrehozása `pg_policies` ellenőrzéssel történik;
8. az átmeneti kettős írásban az `appointments` az elsődleges rekord, a `jobs` csak kompatibilitási tükör;
9. a két rekord mentése egyetlen adatbázis-tranzakcióban vagy atomi RPC-ben történik, hogy részleges mentés ne maradhasson;
10. a migráció előtt az audit pontos számlálóit újra ellenőrizni kell.
