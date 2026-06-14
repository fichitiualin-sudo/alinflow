# Additív `appointments` migráció

> Stabilizálási fázis: 4.
>
> Dátum: 2026-06-14.
>
> Élő migráció: sikeresen alkalmazva és idempotensen újrafuttatva.

## Cél

Az új `appointments` tábla egy ügyfélhez több, egymást nem felülíró időpontrekordot tud tárolni:

- opcionális felmérés;
- szerelés;
- korlátlan számú karbantartás;
- lemondott időpontok.

Ez a fázis kizárólag az adatbázis-alapot készíti el. Az alkalmazás továbbra is a `jobs` táblát használja; kompatibilis több-időpontos olvasás és kettős írás csak külön, későbbi fázisban készülhet.

## Változatlan szabályok

- A `jobs` tábla, annak oszlopai, constraintjei és adatai változatlanok maradnak.
- Meglévő rekordot a migráció nem módosít és nem töröl.
- A jelenlegi felhasználói működés és felület nem változik.
- Nincs többcéges mező vagy RLS-átalakítás.
- A `src/app/page.tsx` és az alkalmazáskód nem változik.

## Migráció előtti állapot

A 2026-06-14-i közvetlen ellenőrzés eredménye:

- `appointments` tábla: nincs;
- `jobs`: 16 rekord;
- típusok: 15 `installation`, 1 `maintenance`;
- hiányzó ügyfél, dátum vagy idő: 0;
- ismeretlen időponttípus: 0;
- `public.set_updated_at()` függvény: elérhető.

Ha a futtatáskori adatok nem teljesítik ezeket a backfill-feltételeket, a migráció kivétellel leáll és a tranzakció nem hagy részleges módosítást.

## Új adatmodell

Az `appointments` fő mezői:

| Mező | Szerep |
| --- | --- |
| `id` | Új appointment UUID. |
| `customer_id` | Kötelező kapcsolat az ügyfélhez. |
| `quote_id` | Opcionális kapcsolat az ajánlathoz. |
| `appointment_type` | `installation`, `survey` vagy `maintenance`. |
| `scheduled_date` | Kötelező dátum. |
| `scheduled_time` | Kötelező, a legacy formátummal kompatibilis szöveges idő. |
| `status` | Az időpont aktuális állapota. |
| `cancelled_at` | Opcionális lemondási időpont. |
| `legacy_source_key` | A backfill forrásának egyedi azonosítója. |
| `created_at`, `updated_at` | Létrehozási és frissítési idő. |

A tábla megőrzi a `jobs` kompatibilis mezőit (`title`, `address`, `notes`, `created_by`) is, hogy a későbbi átállás ne veszítsen adatot.

## Backfill

Minden meglévő `jobs` rekordból egy új `appointments` rekord készül.

Az egyedi forráskulcs formája:

```text
jobs:<jobs.id>
```

A `appointments_legacy_source_key_uidx` unique index megakadályozza a duplikációt. Újrafuttatáskor az `on conflict (legacy_source_key) do nothing` nem írja felül az új elsődleges appointment rekordot legacy adatokkal.

## RLS és trigger

- Az RLS engedélyezett az új táblán.
- Egyetlen permissive `ALL` policy készül az `authenticated` szerepkör számára.
- A policy létrehozása `pg_policies` lekérdezéssel idempotens; a migráció nem használ nem támogatott `CREATE POLICY IF NOT EXISTS` alakot.
- Az `updated_at` mezőt a meglévő `public.set_updated_at()` függvény és egy név szerint ellenőrzött trigger frissíti.

## Futtatás

1. Futtasd a migráció előtti számlálókat a [`SUPABASE_SCHEMA_AUDIT_READONLY.sql`](sql/SUPABASE_SCHEMA_AUDIT_READONLY.sql) fájlból.
2. Futtasd egyben a [`20260614_ADD_APPOINTMENTS.sql`](sql/20260614_ADD_APPOINTMENTS.sql) fájlt.
3. Futtasd a [`20260614_VERIFY_APPOINTMENTS.sql`](sql/20260614_VERIFY_APPOINTMENTS.sql) ellenőrzést.
4. Futtasd újra a migrációt.
5. Futtasd újra az ellenőrzést, és igazold, hogy a rekordszám nem változott.

## Elvárt eredmény

- `jobs_total`: 16;
- `appointments_total`: 16;
- `legacy_appointments`: 16;
- `missing_legacy_rows`: 0;
- `duplicate_legacy_keys`: 0;
- `legacy_value_mismatches`: 0;
- `invalid_appointment_types`: 0;
- legacy unique index: elérhető;
- időponttípus-constraint: pontosan 1;
- RLS: bekapcsolva;
- policy: pontosan 1;
- frissítési trigger: pontosan 1.

## Élő végrehajtási eredmény

A migráció az `alinflow-db` projekten kétszer egymás után sikeresen lefutott. A második futás után:

- `jobs_total`: 16;
- `appointments_total`: 16;
- típusok: 15 `installation`, 1 `maintenance`;
- `missing_legacy_rows`: 0;
- `duplicate_legacy_keys`: 0;
- `legacy_value_mismatches`: 0;
- `invalid_appointment_types`: 0;
- unique index: elérhető;
- időponttípus-constraint: 1;
- RLS: bekapcsolva;
- policy: 1;
- frissítési trigger: 1.

## Visszaállítás

A jelenlegi alkalmazás nem olvassa és nem írja az új táblát, ezért a biztonságos visszaállítás a 4. fázis kódjának visszavonása és az `appointments` tábla használaton kívül hagyása. Ez nem érinti a `jobs` működését.

Automatikus `drop table` rollback nincs, mert az adatot törölne. A tábla eltávolítása csak külön jóváhagyással, friss mentés után és annak igazolásával történhet, hogy nincs `legacy_source_key is null` új rekord.

## Kapcsolódó következő fázis

Az 5. stabilizálási fázis bevezette a kompatibilis, elsődlegesen `appointments` alapú olvasást. Az írás továbbra is `jobs` alapú, kettős írás még nincs. Részletek: [`APPOINTMENTS_COMPATIBLE_READ.md`](APPOINTMENTS_COMPATIBLE_READ.md).
