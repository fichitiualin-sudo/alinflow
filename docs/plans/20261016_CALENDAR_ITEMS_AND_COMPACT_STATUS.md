# Több tétel a naptárból és tömörebb állapotjelzések

## Cél
A munkaoldalon külön egyéb tétel is hozzáadható. A naptár gyors rögzítése több klímát és egyedi tételt kezel, és ügyfélhez tartozó javítási, leszerelési időpontot kínál. A naptár és térkép frissítési vezérlői kis helyen, a fontos hibák megtartásával jelennek meg.

## Jelenlegi működés
A munkaoldali szerkesztő már megjeleníti a kézi QuoteItem tételeket, de hiányzik a hozzáadógomb. A gyors naptárűrlap egyetlen productId/quantity/price mezőcsoportot ment. Három ügyfél-időponttípus létezik; az általános elfoglaltság modellezése külön vizsgálandó. A térkép megosztásfrissítése külön nagy sort foglal.

## Megváltoztathatatlan szabályok
A korábbi ügyfelek, időpontok, ajánlatok és aláírt dokumentumok nem változnak. A mennyiségek, árak, email-pipák és hiba utáni újrapróbálás megmaradnak. Egyéb elfoglaltság nem hoz létre ál-ügyfelet, klímakészlet-mozgást vagy önkéntelen ügyfélemailt. Munkaterület-határok változatlanok.

## Adatmodell
A több tételhez a meglévő QuoteItem és ajánlati mentés használható. Az egyéb időpont pontos adattárolását a meglévő séma és a kért ügyfélkapcsolat alapján választjuk ki, és szükség esetén additív, idempotens migrációval készül. A döntés az implementáció előtt ide kerül.

## Implementációs lépések
1. Munkaoldali egyéb tétel hozzáadása a meglévő kézi tételkezeléssel.
2. Gyors naptárűrlap többtételes szerkesztése, minden tétel mentése/előnézete/emailje és visszatöltése.
3. Egyéb időpont megoldása az adatmodell és felhasználói pontosítás alapján.
4. Naptárjelzés tömörítése, térképi frissítés beillesztése a meglévő vezérlősorba, felesleges függőleges térköz megszüntetése.
5. Célzott regressziós ellenőrzések, típusellenőrzés, build, mobil/asztali vizuális ellenőrzés, elkülönített kiadás.

## Ellenőrzés
Több különböző klíma, mennyiség és egyedi tétel árösszesítője; hiányos sorok; új/meglévő ügyfél; emailek kapcsolhatósága; régi időpontok sértetlensége. Egyéb eseménynél ütközés, újratöltés, szerkesztés és munkaterület-izoláció. npx tsc --noEmit; npm run build; megfelelő tesztek és mobil/asztali megjelenítés.

## Visszaállítás
Célzott alkalmazáskód-visszaállítás; meglévő adatok törlése nélkül. Az other típusú mentett munkák megmaradnak; az alkalmazás visszaállítása előtt a régebbi verzió típuskezelését ellenőrizni kell.

## Módosított fájlok
- `src/app/api/create-invoice/route.ts`
- `src/app/api/send-appointment/route.ts`
- `src/app/page.tsx`
- `src/components/alinflow/CalendarPanel.tsx`
- `src/components/alinflow/DocumentPreviewDocuments.tsx`
- `src/components/alinflow/MaintenanceMapPanel.tsx`
- `src/components/alinflow/SchedulePanel.tsx`
- `src/components/alinflow/WorkPagePanel.tsx`
- `src/components/alinflow/WorkReportPanel.tsx`
- `src/lib/alinflow/appointment-devices.ts`
- `src/lib/alinflow/appointments.ts`
- `src/lib/alinflow/billing.ts`
- `src/lib/alinflow/document-pdf-render.ts`
- `src/lib/alinflow/documents.ts`
- `src/lib/alinflow/google-contacts-source.ts`
- `src/lib/alinflow/maintenance-map.ts`
- `src/lib/alinflow/materials.ts`
- `src/lib/alinflow/privacy-notice.ts`
- `src/lib/alinflow/products.ts`
- `src/lib/alinflow/purchase-declarations.ts`
- `src/lib/alinflow/signed-document-export.ts`
- `src/lib/alinflow/types.ts`
- `src/lib/alinflow/work-report.ts`
- `tests/action-outcomes.test.cjs`
- `tests/calendar-email-flow.test.cjs`
- `tests/document-layout.test.cjs`
- `tests/document-pdf.test.cjs`
- `tests/google-calendar-sync.test.cjs`
- `tests/invoice-delivery.test.cjs`
- `tests/maintenance-origin-lifecycle.test.cjs`
- `tests/privacy-notice.test.cjs`
- `tests/regression.test.cjs`
- `tests/shared-maintenance-ui.test.cjs`
- `docs/plans/20261016_CALENDAR_ITEMS_AND_COMPACT_STATUS.md`
- `docs/sql/20261016_EXTRA_ITEMS_SHARED_MAINTENANCE.sql`
- `docs/sql/20261016_EXTRA_ITEMS_STOCK_GUARD.sql`
- `docs/sql/20261016_OTHER_CUSTOMER_APPOINTMENTS.sql`
- `src/components/alinflow/AppointmentItemsEditor.tsx`
- `tests/calendar-status-ui.test.cjs`
- `tests/extra-items-shared-maintenance-sql.test.cjs`
- `tests/extra-items-stock-sql.test.cjs`
- `tests/extra-quote-items.test.cjs`
- `tests/other-appointments.test.cjs`
- `tests/other-service-workflow.test.cjs`
- `tests/work-page-extra-items.test.cjs`
## Egyéb ügyfélmunka – elfogadott adatmodell
A felhasználó pontosítása szerint az egyéb időpont javítás, leszerelés és hasonló ügyfélmunka, nem ügyfél nélküli elfoglaltság. Ezért a meglévő AppointmentType negyedik értéke `other`; az ügyfélkapcsolat kötelező marad. Az appointments/jobs-tükör, a munkaterület-védelem és a Google Naptár verziózott sora változatlanul használható. A mentési RPC engedélylistája és a szűk típus-CHECK-ek idempotens migrációval bővülnek, a meglevő jogosultságok és triggerek megőrzésével. Az egyéb munka alapideje egy óra; a régi három típus ideje változatlan. Az új típus nem telepítés, nem generál klímakészlet-levonást, NKVH-feladatot vagy vásárlási nyilatkozatot. Szolgáltatási tételei a saját EV számlázásához tartoznak. Migráció előbb, alkalmazáskód utána; valódi ügyféllevél vagy Google-esemény teszteléshez nem készül.

## Backend ellenőrzés – egyéb ügyfélmunka
Az éles sémán kizárólag visszagörgetett tranzakcióban ellenőrizve: migráció kétszeri futtatása; meglévő időpont/job/munkalap/Google-sor adatok hash-e változatlan; ACL/RLS és a munkaazonosság-/Google-trigger változatlan. Authenticated szereppel mind a négy típus létrehozása és módosítása stabil azonosítókkal működik, hibás típus és típuskicserélés elutasítva, other nem indíthat telepítési készletlevonást. Az új 2026-10-16.1 tájékoztató csak other munkalaphoz, egyetlen szolgáltatói adatkezelővel fogadható el; a régi telepítési és karbantartási verziók továbbra menthetők. A próbában létrehozott szintetikus munkák és minden sémaváltozás ROLLBACK-kel visszavonva, külső küldés nélkül. A célzott other/Google/email tesztek és az other munkafolyamat mentés/lezárás/lemondás/aláírás/PDF/betöltés regressziói sikeresek; a teljes kiadási buildet a koordináló folyamat futtatja.


## Elkészült megoldás és kiadási ellenőrzés
A QuoteItem.itemType=extra jelölés a meglévő description mezőben marad meg, additív formában; jelölés nélküli régi kézi tételek klímák maradnak. Minden összeg megmarad, extrák nem növelik az AC-darabszámot, eszközhelyeket, alapanyag-szorzót, karbantartási térképet, névjegyek készüléklistáját vagy az új vásárlási nyilatkozat választékát. Szervizmunka saját aláírt munkalappal és szolgáltatói tájékoztatóval zárható; a lemondott munka nem aktiválható újra lezárással és nem számlázható. Régi aláírt dokumentumok változatlanok; azokba az aktuális extra tételeket nem keverjük vissza.

- Teljes tesztkör: 1209 teszt, 1207 sikeres, 2 környezetfüggő kihagyás, 0 hiba (PGlite engedélyezve).
- npx tsc --noEmit és npm run build sikeres; a helyi build szintetikus publikus Supabase-beállításokat használt. A Vercel a saját éles konfigurációjával külön buildel.
- Három migráció együtt, kétszer futtatva natív PostgreSQL-en, ROLLBACK-kel ellenőrizve. Jogosultságok és meglévő adatok megmaradnak.
- Asztali és 390 px-es mobil előnézet valódi komponensekkel, szintetikus adatokkal ellenőrizve; nincs vízszintes kilógás. A szerviz-PDF vizuálisan ellenőrizve.
- Nincs gyökér app mappa vagy új duplikált page.tsx.

Kiadási sorrend: ellenőrzött PR/Vercel build, három additív migráció atomikusan, main merge, éles Vercel és böngészős visszaellenőrzés. Teszteléshez valódi ügyféllevél, számla vagy Google-esemény nem készül.
