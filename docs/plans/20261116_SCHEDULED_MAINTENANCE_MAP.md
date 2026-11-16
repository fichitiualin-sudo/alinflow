# Egyeztetett karbantartások lila térképjelölése

## Cél
A mentett, még el nem végzett karbantartási időpont lila „Egyeztetve” jelzést kap a térképen, a listában és a színmagyarázatban. Teljesítés után a meglévő zöld/esedékességi logika működik tovább.

## Jelenlegi működés
A maintenance-map.ts az elvégzett karbantartásokból készülékenként számol állapotot. A megosztott eredmények és kapcsolattartási preferenciák ezt tovább alakítják. A megosztott RPC-k jelenleg csak elvégzett munkák előzményeit adják vissza.

## Megváltoztathatatlan szabályok
- Csak a konkrét telepítéshez és kijelölt készülékhez kapcsolt, mentett karbantartási időpont számít egyeztetettnek.
- Lemondott/lezárt időpont nem lila. A lejárt, még nyitott időpont nem válik automatikusan elvégzetté.
- Az egyeztetés nem növeli a karbantartások számát és nem módosítja az utolsó karbantartást vagy az éves esedékességet.
- Részleges egyeztetés nem fedi el a többi készülék esedékességét. A „Nem kéri” választás megmarad.
- Korábbi dokumentumokhoz, ügyféladatokhoz, időpontokhoz és készlethez nem írunk.
- A meglévő aktív munkaterületi és karbantartási megosztási jogosultságok érvényben maradnak.

## Adatmodell
Nincs új tábla és nincs üzleti adat visszatöltését igénylő migráció. A megosztott egyeztetett időpontokhoz külön, olvasó RPC készül, a meglévő hozzáférési határokkal. A korábbi, elvégzett előzményeket visszaadó szerződések változatlanok, így a régebbi kliensek sem számolják késznek a tervezett munkát.

## Implementációs lépések
1. Az aktuális main elkülönített másolatán dolgozunk.
2. Megosztott időpontok olvasó RPC-je és betöltése; készülékválasztás és lemondás figyelembevétele.
3. Az összevont, preferenciákkal korrigált térképpontokra alkalmazott egyeztetési réteg. Új scheduled állapot és dátum/idő megjelenítés.
4. Lila szűrő, jelölők és részletes készülékbontás; korábbi állapotok megtartása.
5. Célzott regressziók, típusellenőrzés, build, asztali és mobil megjelenítés ellenőrzése.
6. Az olvasó RPC és ellenőrzött alkalmazásverzió kiadása, majd éles visszaellenőrzés.

## Ellenőrzés
- Egyeztetés, teljesítés, lemondás, időpont-módosítás, korábbi lejárt egyeztetés és újabb elvégzett munka.
- Több telepítés, több azonos típusú klíma, részleges készülékkijelölés és részleges visszautasítás.
- Saját, átvett és forrásmunkaterületi nézet; inaktív/visszavont megosztás kizárása.
- npx tsc --noEmit és npm run build.
- Nincs új gyökérszintű app/ vagy duplikált page.tsx; üzleti rekordok nem változnak.

## Visszaállítás
Az alkalmazáscommit visszavonható üzleti adatvesztés nélkül. Az új olvasó RPC-t a korábbi kliens nem használja; szükség esetén külön visszavonható.

## Állapot
Megvalósítva, élesítésre előkészítve. Az éles adatbázis-frissítés és alkalmazáskiadás még nem történt meg: az új SECURITY DEFINER olvasó RPC telepítését az automatikus jóváhagyási ellenőrzés explicit engedélyhez kötötte.

### Ellenőrzési eredmények
- `npx tsc --noEmit`: sikeres.
- `npm run build`: sikeres, helyi buildhez megadott, nem éles Supabase URL/kulcs helyőrzőkkel. Környezeti fájl nélkül a korábbi Supabase-kliens inicializálása leáll; éles környezeti beállítás nem változott.
- Teljes tesztfutás: 1663 teszt, 1660 sikeres, 2 kihagyott, 1 korábbi hiba. Az A09 manuális számlázási teszt hiányzó `pendingActionsRef` mockja az eredeti main másolatán ugyanúgy hibázik; ehhez a fejlesztés nem nyúl.
- Az új szín, szűrő, készüléklogika, megosztás, mentési hiba/újrapróbálás és olvasó SQL célzott ellenőrzései sikeresek. Az SQL izolált PGlite-adatbázison, szintetikus adatokkal, ismételt telepítéssel és jogosultsági kizárásokkal is ellenőrizve.
- Valódi panelből, állapotfüggvényekből, markerrajzolóból és build CSS-ből készült helyi, szintetikus vizuális előnézet; éles Google Maps/adatbetöltés ellenőrzése a kiadás után szükséges.
- Nincs új gyökérszintű `app/` vagy új/duplikált `page.tsx`. Üzleti rekord nem módosult.

### Fájlkör
- `src/app/page.tsx`, `src/lib/alinflow/types.ts`: végső térképi összesítés, mentési sorrend és lemondásjelölés életciklusa.
- `src/lib/alinflow/maintenance-map.ts`, `maintenance-scheduled-map.ts`, `map-marker-style.ts`: állapot, készülékillesztés, szűrés, felirat és lila marker.
- `src/components/alinflow/MaintenanceMapPanel.tsx`, `useSharedMaintenance.ts`, `src/lib/alinflow/shared-maintenance-client.ts`: megjelenítés, elkülönített időpontbetöltés és hibaállapot.
- `docs/sql/20261116_SHARED_MAINTENANCE_SCHEDULES.sql` és ellenőrző párja: additív olvasó RPC és postflight.
- `docs/SCREENS_AND_UX.md` és ez a terv: működés és kiadási állapot.
- Kapcsolódó core-, UI-, marker-, shared-, mentési és SQL-tesztek a `tests/` mappában.
