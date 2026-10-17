# Térképi hely megőrzése karbantartás mentésekor

## Cél
A karbantartás, munkatételek vagy lezárás mentése ne tüntesse el a telepítések térképi helyét. A hiányzó helyek számát a felület tényleges, kompatibilitási szűrést alkalmazó telepítési listájából számoljuk.

## Jelenlegi működés
A page.tsx betöltője a munka teljes címét jeleníti meg, ilyenkor a külön városmezőt üresre állítja. Az általános mentő ezt az ábrázolási értéket visszaírta az ügyféltörzsbe, amit az adatbázis valódi címváltozásnak tekintett, ezért törölte a telepítések koordinátáit. A karbantartási állapotszámítás önmagában nem távolítja el a telepítést.

## Megváltoztathatatlan szabályok
A tényleges címváltozás továbbra is érvénytelenítse az elavult helyadatokat. Új ügyfelek címe és a kifejezetten szerkesztett ügyféladatok menthetők maradnak. Régi időpont, aláírás, dokumentum, készlet és jogosultság nem változik. Az éles diagnosztika csak olvasási művelet; valós tesztmunka, levél, számla nem készül.

## Adatmodell
Elsődlegesen alkalmazásoldali mentési hatókör javítása; új adattábla vagy ügyfélmező nem szükséges. Meglevő címeket nem találgatunk és nem írunk át tömegesen. A térkép meglévő koordinátakeresője a tárolt címekhez használható.

## Lépések
1. Éles adatok csak olvasási ellenőrzése, kompatibilis időpontlista szerinti számlálás.
2. Megjelenített munkacím és ügyféltörzs-cím mentésének szétválasztása; változatlan munkacím megőrzése.
3. Betöltéstől karbantartásmentésig tartó regresszió, valós címszerkesztés és új ügyfél ellenőrzése.
4. TypeScript, build és célzott tesztek, elkülönített PR/Vercel kiadás, éles visszaellenőrzés.

## Ellenőrzés
- Karbantartás mentése/lezárása nem üríti az ügyfél városát és nem módosítja a telepítés helyét.
- Teljes munkacím, külön településes cím, üres munkacím miatti ügyfélcím-fallback, más helyszínű munka.
- Új ügyfél és valódi, kifejezett címszerkesztés menthető.
- npx tsc --noEmit; npm run build; megfelelő regressziós tesztek.

## Visszaállítás
Az alkalmazás célzott visszaállítása, adatok törlése nélkül. A régi változat újból előidézheti a hibát; meglévő koordináták ettől nem törlődnek kiadáskor.

## Módosított fájlok
- `src/app/page.tsx`: az általános munkamentés megőrzi a törzs címmezőit; az ügyfélszerkesztés explicit címmódosítást jelöl. Az üres munkacím helyére megjelenített törzscím nem válik mentett címváltozássá. Munkaterület/bejelentkezés-váltás és címolvasási hiba megállítja a további írásokat.
- `src/lib/alinflow/customers.ts`: irányítószámként csak a cím eleji, településnév előtti négy számjegy értelmezhető; a helyrajzi szám nem törli a települést a megjelenítésből.
- `tests/maintenance-map-persistence.test.cjs`: valódi betöltő–mentő regressziók teljes, különböző és üres munkacímmel, új ügyféllel, valódi címszerkesztéssel, hibával és munkaterület-váltással.
- `tests/regression.test.cjs`: a meglévő atomikus ajánlatmentési teszt kontextusának frissítése.
- Ez a végrehajtási terv.

## Ellenőrzési eredmények
- Célzott betöltő–mentő regresszió: 8/8 sikeres.
- `npx tsc --noEmit`: sikeres.
- `npm run build`: sikeres, helyi szintetikus Supabase buildbeállításokkal.
- Meglévő `maintenance-geocoding-sql.test.mjs`: 7 ellenőrzési csoport sikeres helyi PGlite adatbázison; valódi címváltozás továbbra is érvénytelenít, idegen hozzáférés és elavult koordinátaválasz tiltott, aláírt dokumentum érintetlen.
- Nincs gyökérszintű `app/` vagy új főoldal; nincs adatbázis-migráció, tömeges címátírás vagy ügyféladat a változtatásban.
- Teljes `npm test`: 1217 teszt, 1215 sikeres, 0 hibás, 2 meglévő kihagyás.
