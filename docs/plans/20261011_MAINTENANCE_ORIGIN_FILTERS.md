# Saját és karbantartásra átvett klímák láthatósága

## Cél
A telepített klímák térképén és kapcsolódó karbantartási listáján külön kapcsolható a saját telepítés és a karbantartásra átvett állomány. A besorolás egyszerűen szerkeszthető, az átadó neve opcionálisan megadható.

## Jelenlegi működés
A MaintenanceMapPanel az appointments szerelési rekordjaiból képzett MaintenanceMapPoint listát szűri állapot és keresés alapján. Nincs megbízható saját/átvett jelölés. Egy pont az adott szerelési időponthoz tartozó klímákat fogja össze.

## Megváltoztathatatlan szabályok
- A két kapcsoló csak láthatóságot szabályoz; sem adatot, sem megbízást nem töröl.
- A korábbi telepítések megmaradnak és alapból a saját kategóriában látszanak. Importforrásból nem következtetünk másik telepítőre.
- A besorolás az adott telepítési rekordhoz tartozik, nem az ügyfél összes klímájához.
- Ez a fejlesztés nem ad munkaterületek közötti hozzáférést, és nem helyettesíti az ügyfél hozzájárulását.
- Karbantartási napló, szerelési adatok, készlet, dokumentumok és számlázás változatlan.

## Adatmodell
Az appointments két új mezője: maintenance_origin (own/external, alapérték own), maintenance_source_name (opcionális, legfeljebb 160 karakter). Additív, idempotens migráció, RLS változtatása nélkül. Mentés az aktív munkaterület és az adott időpont/ügyfél azonosítójára szűkítve, a válasz visszaellenőrzésével.

## Implementációs lépések
1. Adatmodell, tiszta leképezés, migráció és validálás.
2. Két alapból bekapcsolt, böngészőben felhasználó/munkaterület szerint megjegyzett nézeti kapcsoló.
3. Térkép és lista azonos szűrése, egységes darabszámok; átvett jelölés és kompakt besorolásszerkesztő.
4. Mentés/visszatöltés és munkaterületváltási hibavédelem.
5. Célzott tesztek, mobil/asztali próba, tsc/build, éles migráció és kiadás ellenőrzése.

## Ellenőrzés
- npx tsc --noEmit; npm run build
- Saját/átvett/mindkettő/egyik sem, keresés és állapotszűrés együtt.
- Közös helyszín többféle besorolással, lapozás és kiválasztott helyszín törlése.
- Mentés, újratöltés, munkaterületi szűkítés, sikertelen mentés visszajelzése.
- Migráció megismételhetősége és meglévő rekordok/RLS változatlansága.

## Visszaállítás
A felület kiadása visszaállítható. Az új mezőkben mentett besorolás megőrzendő, nem törlendő.

## Módosított fájlok és eredmény
- Felület és mentés: `src/app/page.tsx`, `src/components/alinflow/MaintenanceMapPanel.tsx`, új `MaintenanceOriginEditor.tsx`.
- Típusok és leképezés: `src/lib/alinflow/types.ts`, `appointment-records.ts`, `maintenance-map.ts`, új `maintenance-origin.ts`.
- Dokumentáció: ez a terv, `docs/DATA_MODEL.md`, `docs/SCREENS_AND_UX.md`.
- Adatbázis: `20261011_ADD_MAINTENANCE_ORIGIN.sql`, `20261011_VERIFY_MAINTENANCE_ORIGIN.sql`, `20261011_EXCLUDE_MAINTENANCE_ORIGIN_FROM_CALENDAR.sql` a `docs/sql/` könyvtárban.
- Tesztek: új `maintenance-map-origin.test.cjs`, `maintenance-origin-save.test.cjs`, `maintenance-origin-lifecycle.test.cjs`, `maintenance-origin-sql.test.mjs`, `maintenance-origin-calendar-sql.test.mjs`; meglévő `facebook-leads-client.test.cjs` segédkörnyezetének igazítása.
- `npm test`: 811 sikeres, 5 kihagyott, 0 hibás; `npx tsc --noEmit` sikeres. A helyi `npm run build` fordítása és típusellenőrzése sikeres, az oldaladatok gyűjtése a meglévő `/api/h-tariff/pdf` route-nál hiányzó `NEXT_PUBLIC_SUPABASE_URL` miatt megáll. A kiadás konfigurált Vercel-buildje külön ellenőrizendő.
- Szintetikus böngészős próba: asztali és 390×844 mobil, világos/sötét téma; kapcsolók, újratöltéskor megmaradó választás, azonnali átsorolás, hibás mentésnél megmaradó mezők és látható hiba ellenőrizve. Nincs vízszintes túlcsordulás. A teszt nem módosított éles ügyfélbesorolást.
- A piszkozatból való visszalépés a friss telepítési besorolást használja; új időpont sajátként indul; a mentés a már folyamatban lévő betöltés után javítja a helyi állapotot.
- Éles adatbázis: a sémaellenőrzés és védett, kliensjogosultság nélküli visszaállítási másolat után az additív migráció lefutott. 14/14 ellenőrzés igazolta a régi adatok, táblaszerkezet, RLS/jogosultságok és naptársor változatlanságát. Ezután a külön naptár-trigger migráció is sikeres volt, a függvény teljes metadatáinak megőrzését tranzakción belül ellenőrizte.
- Nincs új gyökérszintű `app/` vagy duplikált `page.tsx`. A fejlesztés nem hoz létre partner-hozzáférést.
