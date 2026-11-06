# Készülékenként választható karbantartás

## Cél
Egy négy klímát tartalmazó telepítésből egyetlen készülék karbantartása is rögzíthető legyen. Csak a kiválasztott készülék kapjon új karbantartási dátumot; a munkalap, az értesítők és a mennyiségek ezt kövessék.

## Jelenlegi működés
A `maintenance_appointment_items` kizárólag telepítési időpontokat kapcsol össze karbantartási időpontokkal. Az időpontválasztó, visszatöltés és térképes állapot ezért a teljes telepítési mennyiséget veszi át.

## Megváltoztathatatlan szabályok
- A telepítés, eredeti ajánlat, készlet és korábbi aláírt munkalap változatlan marad.
- Régi, készülékválasztás nélküli karbantartás továbbra is az egész kapcsolt telepítésre vonatkozik.
- A saját és a partner által végzett karbantartás ugyanazt a kiválasztást követi, munkaterületi jogosultságbővítés nélkül.
- Sikertelen mentés nem törölheti a korábbi kapcsolatokat, az újrapróbálás nem készíthet új időpontot.

## Adatmodell
Additív nullable `selected_devices` JSON a kapcsolótáblán. A `null` a régi teljes telepítést jelenti; az új nem üres tömb terméknév és terméken belüli sorszám alapján azonosít. Ez a megosztott, ár nélküli telepítési másolatban is ugyanaz. A darabszám és a forrás telepítés szerveroldalon ellenőrzött. A kliens külön mezőben őrzi és visszatölti a választást; a partnereredmények szintén továbbítják.

## Implementációs lépések
1. Közös készülékválasztó és tiszta kiválasztási segédfüggvények; időpont és naptár gyorsrögzítés bekötése.
2. Atomi, ellenőrzött mentés és kompatibilis visszatöltés; idempotens SQL-migráció.
3. Munkalap/értesítő mennyiségek és készülékenkénti karbantartási előzmény; térképen a fennmaradó esedékesség megőrzése.
4. Célzott regressziók, típusellenőrzés, build, mobil és asztali ellenőrzés.

## Kiegészítés: készülékenkénti visszautasítás
Az ügyfél kérésére a tartós „Nem kéri a karbantartást” jelölés is készülékenként állítható. Ez különbözik az adott alkalom készülékválasztásától. A meglévő, közös forrástelepítéshez kötött karbantartási preferencia kap additív `declined_devices` mezőt, változatlan felhasználói és megosztási jogosultságokkal. Az egyedi jelölések a munkaoldalon és a térképes listában állíthatók; a többi készülék előzménye és esedékessége változatlan. A teljes telepítés korábbi visszautasítása továbbra is érvényes; egyetlen készülék visszakapcsolása nem kapcsolja vissza a többit.

## Ellenőrzés
- 4 azonos klímából 1, eltérő típusok és későbbi másik készülék választása.
- Mentés/visszatöltés/újrapróbálás és partneri eredmény; régi teljes karbantartás.
- Érvénytelen vagy idegen készülék, aláírt előzmény védelme.
- `npx tsc --noEmit`, `npm run build`, célzott tesztek.

## Visszaállítás
Az új funkció visszavonható a tárolt választások megtartásával. Részleges karbantartási adatok létrejötte után régi klienst nem szabad visszaengedni úgy, hogy teljes telepítésként értékelje őket. Régi adatokat a migráció nem módosít.

## Módosított fájlok és lezárás
- Teljes tesztcsomag: 1441 sikeres, 0 hibás, 8 opcionális SQL-teszt kihagyva.
- Külön izolált PostgreSQL-futtatás:16 részleges karbantartási és10 készülékpreferencia-ellenőrzés sikeres, a pontos éles függvényexporttal és kétszeri migrációval.
- TypeScript: npx tsc --noEmit sikeres. Next.js production build sikeres,31 útvonal. A lokális build helyettesítő nyilvános Supabase-környezettel futott; éles környezetet a Vercel kiadási build ellenőrzi.
- Asztali és390px mobilnézet: készülékválasztó és4 önálló visszautasítási pipa kipróbálva. Próbaoldal eltávolítva; nincs új gyökér app/ vagy felesleges page.tsx.
- Hibás vagy részlegesen mentett választás esetén az aláírás, számlázás és lezárás előtti ellenőrzés megállítja az írást; újramentéssel javítható.
- Teljes public-séma biztonsági mentés ellenőrizve, repón kívüli privát helyen. A két éles migráció egy tranzakcióban sikeres.13 üzleti tábla darabszáma és tartalmi lenyomata változatlan.249 korábbi karbantartási kapcsolat és33 korábbi preferencia megmaradt. Mindkét VERIFY sikeres.
- Valódi próbaügyfél, számla, email és karbantartási bejegyzés nem készült.
- Alkalmazáskiadás: ellenőrzött PR-on keresztül, Vercel builddel.

Módosított fájlok:

- `docs/DATA_MODEL.md`
- `docs/plans/20261106_PARTIAL_MAINTENANCE.md`
- `docs/sql/20261106_MAINTENANCE_DEVICE_PREFERENCES.sql`
- `docs/sql/20261106_PARTIAL_MAINTENANCE.sql`
- `docs/sql/VERIFY_20261106_MAINTENANCE_DEVICE_PREFERENCES.sql`
- `docs/sql/VERIFY_20261106_PARTIAL_MAINTENANCE.sql`
- `src/app/page.tsx`
- `src/components/alinflow/MaintenanceDevicePicker.tsx`
- `src/components/alinflow/MaintenanceMapPanel.tsx`
- `src/components/alinflow/SchedulePanel.tsx`
- `src/components/alinflow/WorkPagePanel.tsx`
- `src/lib/alinflow/google-contacts-source.ts`
- `src/lib/alinflow/maintenance-consistency.ts`
- `src/lib/alinflow/maintenance-contact-choice.ts`
- `src/lib/alinflow/maintenance-devices.ts`
- `src/lib/alinflow/maintenance-map.ts`
- `src/lib/alinflow/maintenance-selection.ts`
- `src/lib/alinflow/shared-maintenance-client.ts`
- `src/lib/alinflow/shared-maintenance.ts`
- `src/lib/alinflow/types.ts`
- `src/lib/alinflow/work-report.ts`
- `tests/action-outcomes.test.cjs`
- `tests/action-work-report.test.cjs`
- `tests/appointment-scheduling-flow.test.cjs`
- `tests/calendar-email-flow.test.cjs`
- `tests/document-integrity.test.cjs`
- `tests/google-contacts-source.test.cjs`
- `tests/installation-completion.test.cjs`
- `tests/maintenance-contact-choice.test.cjs`
- `tests/maintenance-device-picker.test.cjs`
- `tests/maintenance-device-preferences-sql.test.mjs`
- `tests/maintenance-device-preferences.test.cjs`
- `tests/maintenance-devices.test.cjs`
- `tests/maintenance-origin-lifecycle.test.cjs`
- `tests/maintenance-selection.test.cjs`
- `tests/partial-maintenance-consistency.test.cjs`
- `tests/partial-maintenance-history.test.cjs`
- `tests/partial-maintenance-sql.test.mjs`
- `tests/privacy-work-report-flow.test.cjs`
- `tests/shared-maintenance-customer-history.test.cjs`
- `tests/shared-maintenance-ui.test.cjs`
