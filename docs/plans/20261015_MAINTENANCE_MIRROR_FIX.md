# Karbantartási telepítésazonosítók javítása

## Cél
A régi telepítés egyszer szerepeljen a térképen és a karbantartási kiválasztóban; a karbantartási kapcsolat és a koordináta mindig a tényleges telepítéshez kerüljön.

## Jelenlegi működés
A kompatibilitási összefésülés csak az `appointments.legacy_source_key=jobs:<id>` irányt ismeri. Importált időpontok megőrzik eredeti importkulcsukat, miközben a mentés `jobs.legacy_source_key=appointments:<id>` tükröt készít. Ezt a kliens második munkaként mutatja, és a tükör UUID-ját valódi időpontként küldi. Éles, csak olvasási ellenőrzés négy ilyen párt talált. Egy mai karbantartás mentve maradt, de a kapcsolatok mentése hibázott, és a duplán mutatott telepítés az ajánlati mennyiséget is megkettőzte.

## Megváltoztathatatlan szabályok
- Megmaradnak a valóban külön telepítések, dokumentumok, aláírások, időpontok és lemondások.
- Csak pontos tükörhivatkozás, egyező ügyfél és munkaterület alapján párosítunk, dátum vagy név alapján nem.
- Az időpont szerververziója, geokódja és karbantartási besorolása a tényleges időpontból származik.
- Hibás karbantartási linkcsere nem törölheti a korábbi érvényes kapcsolatokat.
- Adatjavítás előtt privát mentés, tranzakciós próba és célzott ellenőrzés szükséges; nincs ügyfélnek küldött tesztüzenet.

## Adatmodell
Új üzleti mező nem kell. A linkek cseréjéhez szűk, hitelesített, munkaterülethez és ügyfélhez kötött tranzakciós RPC készül. Meglévő tábla/FK/RLS nem lazul. A migráció ismételhető és önmagában nem ír át adatokat.

## Implementációs lépések
1. Kétirányú tükörfeloldás és canonical azonosítók; elavult kliensazonosítók biztonságos kezelése.
2. Karbantartási linkek atomi ellenőrzése és cseréje; kapcsolódó klienshívás.
3. A térképes hiányzó koordinátaszám és a ténylegesen feldolgozható célpontok egyeztetése.
4. A bizonyítottan érintett, el nem küldött/ki nem számlázott mai karbantartás kapcsolatának és megkettőzött készüléktételének célzott helyreállítása, a lemondott előzmény megőrzésével.
5. Ellenőrzött migráció és alkalmazáskiadás; éles visszaolvasás.

## Ellenőrzés
- Kétirányú tükör, külön telepítések, idegen munkaterület/ügyfél, canonical szerververzió.
- Érvénytelen linkcsere visszagörgetése, jogosultságok, elavult jobazonosító, ismétlés.
- `npx tsc --noEmit`, `npm run build`, célzott regressziók és mobil/asztali felület.
- Az adatpótlás előtt/után az érintetlen mezők és kapcsolt dokumentumok változatlansága.

## Visszaállítás
Az alkalmazás előző változata visszatehető. Az új RPC eltávolítható; a helyreállított érvényes kapcsolatok önállóan megmaradnak. Célzott adat-visszaállítás kizárólag a privát mentés és aktuális sorverzió ellenőrzése után történhet.

## Módosított fájlok
- `src/lib/alinflow/appointment-records.ts`, `src/lib/alinflow/maintenance-selection.ts`: pontos tükörfeloldás és korábbi piszkozatok azonosítóinak rendezése.
- `src/app/page.tsx`: betöltés, kiválasztás, egyszeres darabszám/időtartam és atomi kapcsolatmentés.
- `src/components/alinflow/MaintenanceMapPanel.tsx`: a pótolható koordináták száma a tényleges célpontokat követi.
- `docs/sql/20261015_ATOMIC_MAINTENANCE_LINKS.sql`: hitelesített, munkaterülethez kötött linkcsere, meglévő RLS/trigger/FK megtartásával.
- `tests/appointment-records.test.cjs`, `tests/maintenance-selection.test.cjs`, `tests/maintenance-links-sql.test.mjs`: új regressziók.
- Meglévő tesztadatok/frissített naptári esetek: `tests/action-outcomes.test.cjs`, `tests/auth-draft-isolation.test.cjs`, `tests/calendar-email-flow.test.cjs`, `tests/customer-save-geocoding.test.cjs`, `tests/facebook-leads-client.test.cjs`, `tests/maintenance-origin-lifecycle.test.cjs`.

## Ellenőrzési eredmények
- Teljes CJS tesztkészlet: 979 teszt, 974 sikeres, 5 környezetfüggő kihagyás, 0 hiba.
- PostgreSQL/PGlite: 13 új atomi kapcsolatmentési ellenőrzés sikeres, köztük visszagörgetés RLS/trigger hibája után.
- `npx tsc --noEmit`: sikeres. `npm run build`: sikeres, kizárólag helyi buildhez megadott, nem éles Supabase helykitöltőkkel.
- Friss privát natív PostgreSQL mentésből elkülönített helyi adatbázis visszaállítva; a migráció kétszer sikeresen lefutott. A célzott adatjavítás tranzakciós próbája és az érintetlen rekordok ujjlenyomat-ellenőrzése sikeres.
- Nincs új gyökérszintű `app/` vagy ismétlődő útvonal.
- Az adatjavító példányok és ügyfélazonosítók kizárólag figyelmen kívül hagyott/privát fájlokban maradnak.
