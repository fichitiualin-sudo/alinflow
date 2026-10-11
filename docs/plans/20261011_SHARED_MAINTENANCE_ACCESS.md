# Korábbi telepítések karbantartási megosztása

## Cél
A kiválasztott AlinFlow-karbantartó a saját munkaterületén a korábbi telepítéseket is elérhesse karbantartáshoz, és már az első karbantartási egyeztető hívást is ő intézze. A felhasználó körülbelül 300 korábbi ügyfélnél kéri ezt; nem a telepítő által előzetesen végzett egyenkénti kapcsolatfelvételt választotta. Az új karbantartás saját munkalapot és az ügyfél által akkor aláírt adatkezelési tájékoztatót kapjon. Az eredeti telepítő lássa, ha más végezte el a karbantartást.

## Jelenlegi működés
- A térkép már minden korábbi, nem lemondott telepítést betölt, kizárólag a saját munkaterületről. Nincs új telepítésekre szűkítő dátumhatár.
- A tájékoztató partnerének kiválasztása csak dokumentumbeállítás; nem ad ügyféladat-hozzáférést.
- Az aktív munkaterületi tagság teljes CRM-adatkört nyitna meg, ezért karbantartási megosztásra nem használható.
- Új karbantartási munkalap aláírásakor a meglévő aláírási folyamat új tájékoztató-pillanatképet tud készíteni. A régi telepítési munkalap ismételt aláírása nem szükséges.
- A jelenlegi tájékoztató az önálló partneri adatátadást előzetes, külön hozzájáruláshoz köti. A felhasználó pontosítása szerint a korábbi ügyfelek szóban beleegyeztek, hogy valaki keresse őket karbantartás miatt, de a konkrét vállalkozót nem nevezte meg. Ez nem pusztán tájékoztatás volt; ugyanakkor nem rögzítünk belőle a jelenlegi tájékoztató szerinti, megnevezett partnerre szóló hozzájárulást.
- A végleges igény szerint a kiválasztott karbantartó kezdeményezi az első hívást is, később pedig a saját vállalkozásából számláz a karbantartásról. Az első kapcsolatfelvétel és a saját szolgáltatás adatkezelői/adatfeldolgozói szerepének, jogalapjának és szerződéses feltételeinek külön elemzése még szükséges. A vállalkozások közötti szerződés puszta meglétéből nem következtetünk jogszerű adatátadásra, és nem feltételezzük, hogy minden művelet kizárólag hozzájárulásra épülhet.

## Megváltoztathatatlan szabályok
- Nem adunk teljes munkaterületi tagságot, és nem lazítjuk a meglévő ügyfél-, ajánlat-, dokumentum- és számlatáblák RLS-szabályait.
- A forrás eredeti telepítése, árai, munkafotói, számlái és aláírt dokumentumai nem másolódnak át a partner teljes CRM-jébe.
- A hozzáférés külön, visszavonható megbízás, nem a tájékoztató partnermezőjének mellékhatása.
- A kiszolgált adatmezők tételesen meghatározottak; nem használunk teljes rekordot visszaadó lekérdezést.
- A karbantartás saját új esemény. Nem írja felül a telepítés dátumát, munkalapját, nyilatkozatát vagy számláját.
- A tényleges szolgáltató saját munkaterülete készíti az új karbantartási dokumentumot és saját meglévő számlázási kapcsolatát használja. Új számlakibocsátó nem válik automatikusan aktívvá.
- Régi aláíráshoz nem kapcsolunk utólag új tájékoztatót, és nem jelölünk automatikusan ügyfél-hozzájárulást.
- Az első hívás kívánt delegálása nem jelenti a partner adat-hozzáférésének aktiválását. A tényleges szerepek, adatkezelési jogalap, tájékoztatás és dokumentálás rendezése előtt nem nyitunk meg ügyféladatokat; a későbbi karbantartási aláírásból nem vezetünk le korábbi engedélyt.

## Adatmodell – tervezett, még nem aktivált
- Külön karbantartási jogosultság a forrásmunkaterület, telepítés és kiválasztott partner felhasználó/munkaterület között; a megadás és visszavonás szerveroldali naplózásával.
- Az első kapcsolatfelvétel és a későbbi saját karbantartási szolgáltatás adatkezelési feltételei külön rögzítendők az elemzés eredménye szerint. A függőben levő megbízás vagy még nem rendezett jogalap nem teszi olvashatóvá az ügyfél személyes adatait.
- Szűk szerveres lekérdezés a karbantartásra átvett telepítésekhez. Minden kérés újraellenőrzi a bejelentkezést, az aktív tagságot, a célt és a megbízás érvényességét.
- Külön kapcsolat a forrástelepítés és a partnernél újonnan létrehozott karbantartás között. A forráshoz visszaadott eredmény dátumra, állapotra és a munkát végző vállalkozásra korlátozott.
- Sem korlátlan visszamenőleges adatmásolás, sem az ügyfélengedélyt feltételező migráció nem készül.

## Implementációs lépések
1. A karbantartó által kezdeményezett első hívás tényleges feladatmegosztásának és szerződéses modelljének elemzése; az egyes műveletek szerepeinek, jogalapjának, tájékoztatásának és bizonyítható feltételeinek meghatározása. A szóbeli, meg nem nevezett partnerre vonatkozó igen ténye megőrzendő, de nem alakítható automatikusan megnevezett partnerre szóló hozzájárulássá. Ezt követi a szükséges mezők és megbízási hatókör véglegesítése.
2. Friss sémafelmérés, védett mentés, idempotens jogosultsági és kapcsolótábla, szűk lekérdezések.
3. Tulajdonosi megbízáskezelés; partnernél az átvett telepítések megjelenítése a meglévő eredetszűrő alatt.
4. Saját karbantartási időpont és új aláírt munkalap/tájékoztató; forrásoldali karbantartási eredmény.
5. Jogosultsági, visszavonási, párhuzamos mentési, adatszivárgási és korábbi dokumentumokat megőrző ellenőrzések.

## Ellenőrzés
- Más partner, inaktív felhasználó/munkaterület, lejárt vagy visszavont megbízás, kitalált azonosító nem olvashat adatot.
- Ár, belső megjegyzés, eredeti aláírás és egyéb teljes CRM-adat nem kerül a megosztási válaszba.
- Régi és új telepítések egyaránt megjelenhetnek; a láthatósági pipák nem adnak jogosultságot.
- Új munkalap új aláírást és új tájékoztatót kap; régi dokumentumok változatlansága ellenőrzött.
- Az első egyeztető hívást a kijelölt karbantartó csak a véglegesített, dokumentált hozzáférési feltételekkel intézheti; a régi általános szóbeli igen és az új munkalap aláírása önmagukban nem aktiválják a hozzáférést.
- Mobil/asztali nézet, munkaterület-váltás és frissítés.
- `npx tsc --noEmit`, `npm run build`, célzott biztonsági tesztek.

## Visszaállítás
A megosztások visszavonhatók; a funkció elrejthető. Az eredeti telepítések és a ténylegesen elvégzett karbantartások bizonyító dokumentumai megőrzendők. Visszaállítás sem törölhet vagy módosíthat régi aláírást.

## Állapot
Előzetes, forráskód alapján ellenőrzött terv; a felhasználói követelmény 2026. október 11-én pontosítva az első hívás karbantartónak delegálásával. A korábbi szóbeli igen és a meg nem nevezett partner ténye ismert, nem vár további azonos tartalmú felhasználói pontosításra. Az első kapcsolatfelvétel szerepe, jogalapja és szerződéses feltételei még elemzésre várnak. Alkalmazás- vagy adatbázis-módosítás, adatátadás és éles aktiválás még nem történt; a megosztás nincs késznek vagy aktiválásra jóváhagyottnak jelölve.

## Jóváhagyott pontosítás és végrehajtás

A felhasználó kéri a karbantartói hozzáférés megvalósítását és az új karbantartások saját adatkezelési tájékoztatóját. A külön kérdésre megerősítette: az első telefonos egyeztetést a karbantartó az átadó vállalkozás nevében végzi, a saját vállalkozásának az ügyfél ezt követően adhat megrendelést. Ez az előző, még eldöntetlen szerepmodellel kapcsolatos pontokat pontosítja.

- A kezdeti hozzáférés elkülönített, visszavonható megbízás: az átadó nevében végzett karbantartás-egyeztetés, dokumentált írásos adatfeldolgozási megállapodással. A megállapodás aláírását nem feltételezzük a szerep kiválasztásából.
- A kiválasztott felhasználó csak az egyeztetéshez szükséges kapcsolati és telepítési adatokat olvashatja; más ügyfélműveleteket, árakat, fotókat, aláírásokat és számlákat nem.
- Csak tényleges ügyfélmegrendelés rögzítésekor jön létre minimális saját ügyfél és karbantartási munka a fogadó munkaterületen. A forrás eredeti rekordjai változatlanok.
- A karbantartási tájékoztató új, visszafelé olvasható verzióban a tényleges karbantartó vállalkozást nevezi meg. Régi aláírt dokumentumot nem alakít át; aláírás és tájékoztató egyezése ellenőrzendő.
- Az aktív tájékoztató-beállítást használó új karbantartás lezárása megköveteli a munkalap saját aláírt példányát. A lezárás nem hoz létre utólag aláírást.
- Éles adatmegosztási grant vagy aláírt megállapodás most még nem keletkezett. A technikai megvalósítás előkészítése folyamatban; aktiválás előtt az írásos megállapodás ténye és a pontos partner ellenőrizendő.

## Megvalósítás és ellenőrzés – 2026. október 11.

Elkészült a külön, visszavonható karbantartási megbízás, a korlátozott partnernézet, a tényleges ügyfélmegrendeléshez kötött saját ügyfél/időpont átmenet és a forráshoz visszajelzett karbantartási eredmény. A karbantartási tájékoztató új verziója kizárólag a tényleges szolgáltatót tartalmazza. Régi aláírás nem kap utólag új dokumentumot.

A friss, védett mentést követően élesben alkalmazva: `MAINTENANCE_PRIVACY_NOTICE.sql`, majd `20261011_SHARED_MAINTENANCE_ACCESS.sql`. Egy tranzakcióban a meglévő ügyfelek, időpontok, ajánlatok, munkalapok, nyilatkozatok és dokumentumok teljes tartalmi ellenőrzőösszege változatlan maradt. Az utóellenőrzés öt zárt RLS-táblát, kizárólag hitelesített RPC-belépést és két lezárási védelmet igazolt; nulla megosztás és nulla ügyfélátvétel keletkezett. Új környezeti változó nem szükséges.

Ellenőrzések: TypeScript sikeres; teljes CJS tesztfutás 852 sikeres és 5 kihagyott, nulla hibás; a későbbi kiegészítések után 14 célzott UI/aláírási teszt sikeres. PostgreSQL: 15 megosztási és 22 adatkezelési ellenőrzés sikeres, ismételt migrációval. Helyi mobil (390×844) és asztali felületpróba szintetikus adatokkal sikeres. A helyi build a hiányzó Supabase-környezeti változókon először megállt; kifejezetten build-ellenőrzéshez adott helyettesítő értékekkel teljesen lefutott. Az éles környezetet a Vercel build igazolja.

A felhasználó által létrehozott partnerfiók külön üres munkaterületet kapott, más céges tagságot nem. Az adatfeldolgozási megállapodások a Git repón kívül, aláírás nélküli Word/PDF tervezetként készültek. Az adatmegosztás aktiválása a ténylegesen aláírt megállapodásra és a fogadó vállalkozás pontos, kitöltött saját tájékoztatójára vár. Számlázási kulcsot ez a változtatás nem hoz létre.

## Módosított fájlok
- docs/DOCUMENTS.md
- docs/plans/20261011_SHARED_MAINTENANCE_ACCESS.md
- docs/sql/20261011_SHARED_MAINTENANCE_ACCESS.sql
- docs/sql/MAINTENANCE_PRIVACY_NOTICE.sql
- docs/sql/VERIFY_MAINTENANCE_PRIVACY_NOTICE.sql
- docs/sql/VERIFY_SHARED_MAINTENANCE_ACCESS.sql
- src/app/page.tsx
- src/components/alinflow/MaintenanceAccessSettings.tsx
- src/components/alinflow/MaintenanceMapPanel.tsx
- src/components/alinflow/PrivacyNoticeDocument.tsx
- src/components/alinflow/PrivacyNoticeSettings.tsx
- src/components/alinflow/SettingsPanel.tsx
- src/components/alinflow/SharedMaintenanceDialog.tsx
- src/components/alinflow/useSharedMaintenance.ts
- src/components/alinflow/WorkReportPanel.tsx
- src/lib/alinflow/maintenance-map.ts
- src/lib/alinflow/privacy-notice-pdf.ts
- src/lib/alinflow/privacy-notice.ts
- src/lib/alinflow/shared-maintenance-client.ts
- src/lib/alinflow/shared-maintenance.ts
- src/lib/alinflow/signed-document-export.ts
- tests/document-layout.test.cjs
- tests/document-pdf.test.cjs
- tests/maintenance-privacy-signing.test.cjs
- tests/privacy-notice.test.cjs
- tests/shared-maintenance-sql.test.mjs
- tests/shared-maintenance-ui.test.cjs
- tests/work-report-privacy-sql.test.mjs
