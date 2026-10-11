# Tartós számlakiállítási védelem

## Cél
A magyar helyi nap kerüljön a számlára. Elveszett szolgáltatói vagy böngészőválasz után ugyanarra a munkára ne készülhessen újabb számla.

## Jelenlegi működés
A `create-invoice` végpont minden kérésre új számlakérést küldött; a böngésző csak a visszaigazolt számlaszámot tartotta memóriában. A keltezés UTC-napot használt.

## Megváltoztathatatlan szabályok
- Valódi számla és ügyféladat nem keletkezik a tesztelésben.
- Külön munkaterület és időpont külön művelet marad; a készülék és munkadíj külön számlázható. Az összevont és külön számlázás egymásra váltása nem hozhat létre átfedő számlát. A kibocsátók meglévő szerveres kiválasztása megmarad.
- Korábbi dokumentumot, időpontot, ellenőrzőlistát nem módosítunk.
- Bizonytalan eredmény nem oldható fel pusztán időtúllépéssel vagy böngészőfrissítéssel.

## Adatmodell
A `20261012_INVOICE_DELIVERY_GUARD.sql` új, RLS-sel védett `invoice_deliveries` táblát és kizárólag service-role jogosultságú claim/finish RPC-ket hoz létre. A hatókör munkaterület + ügyfél + időpont (régi időpont nélküli munkánál ügyfél) + számlatípus. Állapot: processing, confirmed, uncertain, rejected. Csak az azonosítók, időbélyegek, visszaigazolt számlaszám/összegek és az emailküldés választása tárolódnak; nincs kulcs, XML, cím vagy email-cím.

## Implementációs lépések
1. Atomi foglalás és régi, már számlázottnak jelölt ellenőrzőlisták védelme.
2. Visszaigazolt számla esetén az eredeti eredmény visszaadása új külső hívás nélkül. Bizonytalan kísérletnél ellenőrzést kérő hiba; csak explicit szolgáltatói elutasítás után új kísérlet.
3. Europe/Budapest szerinti keltezés; hiányzó számlaszám nem minősül sikernek.
4. Szintetikus route/helper és helyi PostgreSQL-regresszió, típusellenőrzés és build.

## Üzemeltetési korlát
A migrációt a kód kiadása előtt kell futtatni. A már használt `SUPABASE_SERVICE_ROLE_KEY` szükséges; hiányzó konfiguráció vagy napló esetén nincs számlakérés. A régi számlák nem töltődnek vissza automatikusan. Bizonytalan műveletnél a szolgáltatói számlanapló kézi ellenőrzése szükséges; a napló sort nem szabad ellenőrzés nélkül törölni vagy újraengedélyezni. Nem függ új Számlázz.hu fiókbeállítástól.

## Ellenőrzés és visszaállítás
Szintetikus tesztek után `npx tsc --noEmit`, `npm run build`. Éles számlázás nincs. Visszaállításkor a napló megőrzendő; a korábbi, védetlen route visszaállítása megszüntetné a duplikáció elleni védelmet, ezért a számlázást ilyen visszaállítás előtt le kell állítani.

## Módosított fájlok
- `src/app/api/create-invoice/route.ts`
- `src/lib/alinflow/invoice-delivery.ts`
- `docs/sql/20261012_INVOICE_DELIVERY_GUARD.sql`
- `tests/invoice-delivery.test.cjs`, `tests/invoice-delivery-sql.test.cjs`, `tests/api-auth.test.cjs`

## Állapot
Elkészült. Számlázási route/helper és helyi SQL, kibocsátói jogosultságok regressziója sikeres (a kezdeti körben 69 teszt); további módváltási SQL-teszt ellenőrzi az összevont/külön számlázás ütközését. `npx tsc --noEmit` és a helyettesítő, nem éles public Supabase-változókkal végzett build sikeres. Éles migráció, mentés és kiadás külön történik; nincs éles számlakérés.

A mentés ellenőrzőösszegének egyezése után külön, új natív helyi PostgreSQL-adatbázisba visszaállított auth/public/storage sémán is lefutott mind az öt audit-migráció, kétszer. Mind a 69 eredeti tábla soradat-ujjlenyomata és darabszáma változatlan. Visszagörgetett natív próba ellenőrizte az ismételt számlafoglalást, a visszaigazolt eredményt, az összevont/külön ütközést és a service-role korlátozást. A helyi klaszter a próba végén leállt. A szolgáltatói cron/net/vault környezet és a Storage objektumfájlok működését ez a helyi próba nem ellenőrizte.

2026. október 12.: az öt auditmigráció egyetlen tranzakcióban az éles adatbázisra került. Az üres számlanapló, RLS, service-role-only RPC-jogok és mindegyik új hozzáférési védelem utóellenőrzése sikeres. A próba nem állított ki számlát.
