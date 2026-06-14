# Kompatibilis `appointments` olvasás

> Stabilizálási fázis: 5.
>
> Dátum: 2026-06-14.

## Cél

Az alkalmazás időpont-betöltésének elsődleges forrása az `appointments` tábla. A jelenlegi, ügyfelenként egy időpontot megjelenítő felület változatlan marad, miközben az adatbetöltés már több appointment rekordot is biztonságosan kezel.

Ez a fázis nem vezeti be a külön felmérés-, szerelés- és karbantartás-mentést. Az továbbra is külön stabilizálási fázis.

## Olvasási szabályok

1. Az alkalmazás párhuzamosan betölti az `appointments` és a `jobs` rekordokat.
2. Az önálló, `legacy_source_key` nélküli appointment rekord elsődleges adat.
3. A `jobs:<jobs.id>` kulccsal backfillt appointment a hozzá tartozó `jobs` rekorddal egyeztetődik.
4. Ha a legacy `jobs.updated_at` frissebb, annak értékei jelennek meg. Ez megőrzi a jelenlegi, még `jobs`-ba író működést.
5. Ha egy legacy `jobs` rekord már nem létezik, a hozzá tartozó backfill appointment nem válik újra aktív időponttá.
6. Ha maga a `jobs` lekérdezés hibázik, az appointment rekordok önállóan is betöltődnek.
7. Ha egy job még nem rendelkezik backfill appointmenttal, kompatibilitási fallbackként továbbra is megjelenik.

## Aktuális időpont kiválasztása

A jelenlegi UI ügyfelenként továbbra is egy időpontot jelenít meg.

Az időpont kiválasztási sorrendje:

1. aktív rekord a lemondott rekord előtt;
2. legújabb `created_at`;
3. legújabb `updated_at`;
4. stabil UUID sorrend.

Ez megőrzi a korábbi `jobs created_at desc` működést, de a lemondott appointment nem írhat felül egy aktív időpontot.

## Ügyfél és klíma kapcsolata

- Az appointment `customer_id` mezője határozza meg az ügyfelet.
- Ha az appointment rendelkezik `quote_id` értékkel, az ajánlat és annak `quote_items` klímái elsőbbséget kapnak.
- Ha nincs appointmenthez kötött ajánlat, a korábbi ügyfelenkénti legfrissebb ajánlat fallback marad.
- A klímatételek, mennyiségek és árak formátuma nem változik.

## Változatlan működés

- Az időpontmentés ebben a fázisban továbbra is a `jobs` táblát írja.
- Nincs kettős írás.
- Nincs adatbázis-migráció.
- A `jobs` tábla és adatai megmaradnak.
- Nem változik a naptár, időpontfoglaló, munkaoldal vagy más felület.
- Nem változik az email-, dokumentum-, készlet- vagy munkalaplogika.

## Hibatűrés

- Hiányzó `appointments` tábla esetén a rendszer a `jobs` rekordokat használja.
- Általános appointment olvasási hiba esetén a hiba a konzolban látható, a `jobs` fallback aktív.
- Ha mindkét időpontforrás hibázik, a felület hibaüzenetet jelenít meg.

## Élő adatellenőrzés

A [`20260614_VERIFY_APPOINTMENT_READS.sql`](sql/20260614_VERIFY_APPOINTMENT_READS.sql) csak olvasási lekérdezése ellenőrzi:

- az appointment és ügyfél kapcsolatokat;
- az appointment, ajánlat és klímatétel kapcsolatokat;
- az időponttípusokat;
- a státuszokat;
- a dátumokat és időket;
- a legacy `jobs` kompatibilitást;
- a több időponttal rendelkező ügyfelek számát.

A 2026-06-14-i eredmény:

- appointment: 16;
- érintett ügyfél: 16;
- árva ügyfél vagy ajánlat: 0;
- ügyfél–ajánlat eltérés: 0;
- ajánlathoz tartozó klímatétel hiánya: 0;
- ajánlat nélküli szerelés: 0;
- hibás vagy hiányzó típus, státusz, dátum vagy idő: 0;
- backfill nélküli job: 0;
- appointmentnál frissebb legacy job: 0;
- típusok: 15 `installation`, 1 `maintenance`;
- státuszok: 10 `Időpont foglalva`, 6 `Lezárva`.

## Visszaállítás

A kód visszaállítható a korábbi közvetlen `jobs` olvasásra. Az adatbázishoz nem kell nyúlni, mert ez a fázis nem módosította a sémát vagy az adatokat.

## Következő fázis

A következő fázis állíthatja át a felmérés, szerelés és karbantartás mentését külön appointment rekordokra, atomi `appointments` elsődleges írással és `jobs` kompatibilitási tükörrel. Ez a fázis ezt nem kezdi el.
