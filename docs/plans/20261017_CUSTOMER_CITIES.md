# Hiányzó települések javítása

## Cél
Az importált és teljes munkacímmel megjelenített ügyfelek települése a szerkesztőben és számlázáskor is rendelkezésre álljon.

## Jelenlegi működés
A teljes munkacím betöltése jelenleg elrejti a külön városmezőt. Régi importokban vagy korábbi mentés miatt a törzsben is hiányozhat a település. A számlázó külön irányítószámot és települést vár.

## Megváltoztathatatlan szabályok
Már meglévő helyes város, cím, időpont és dokumentum nem írható felül. Nem készül valódi számla, email vagy új AlinFlow-időpont. A meglévő, engedélyezett Google Naptár-szinkron az érintett meglévő események címadatait frissítheti. Több településhez tartozó irányítószámnál nem találgatunk. A már helyes térképi koordináták maradjanak meg.

## Adatmodell
Új mező nem szükséges. A hiányzó városok célzott pótlása csak egyértelmű irányítószám/adott tárolt cím alapján, mentett előtteállapottal és összehasonlított eredeti értékekkel történhet. Személyes adat nem kerül a repóba.

## Lépések
1. Import, betöltő, számlázó és éles hiányok csak olvasási felmérése.
2. Közös, egyértelmű településfelismerés és a kitöltött város megőrzése; számlázási regressziók.
3. Célzott adatpótlás előnézet/mentés, koordináták változatlanságának ellenőrzése.
4. Típusellenőrzés, build, regresszió, PR/Vercel kiadás és éles UI ellenőrzés.

## Ellenőrzés
Teljes cím, külön címmezők, hiányzó város, többértelmű irányítószám, másik munkacím; a korábbi térkép-mentés javítás megmarad. npx tsc --noEmit; npm run build.

## Visszaállítás
Célzott kódrevert; adatpótlásnál megőrzött előtteértékek és csak változatlan újértékek feltételes visszaírása, ügyfél/időpont törlése nélkül.

## Módosított fájlok
- `src/lib/alinflow/customers.ts`: közös település/irányítószám-felismerés.
- `src/app/page.tsx`: betöltés és módosításfelismerés ugyanazzal a címfeloldással.
- `src/lib/alinflow/server-auth.ts`, `src/app/api/create-invoice/route.ts`: hiteles adatforrásból teljes számlázási hely és külön utca.
- `src/lib/alinflow/facebook-leads.ts`: egyértelmű irányítószámból hiányzó település pótlása új leadnél.
- `src/lib/alinflow/format.ts`: ékezet nélküli teljes címnél sem ismétlődik a település.
- `tests/customer-location.test.cjs`, `tests/invoice-customer-location.test.cjs`: új regressziók; meglévő import-, mentés-, jogosultság-, karbantartás- és általános fixture-ök frissítése.

## Adatjavítás eredménye
54 ügyfél hiányzó városa javítva (53 KLIMAlin, 1 Urbán Klíma), zárolt tranzakcióban, előtteállapot-mentéssel és eredetiérték-feltételekkel. 52 hely a törzsadatokból, 2 egyező telepítési címekből egyértelmű. 90 kapcsolódó időpont üzleti adatai és koordinátái, 37 dokumentum és 11 munkalap változatlanok; az automatikus verzió-időbélyeg frissülhetett. A címváltozási trigger által érvénytelenített koordináták tranzakción belül visszaálltak a mentett értékekre. A próba visszagörgetése és az éles tranzakció ellenőrzése sikeres. Utóellenőrzés: nincs érvényes, külön tárolt irányítószám melletti üres város; 2 hibás hosszúságú irányítószám tisztázandó, 16 további rekordban nincs használható helyadat. Személyes adatok és mentések kizárólag helyi privát fájlokban.
## Kódellenőrzés eredménye
- `npx tsc --noEmit`: sikeres.
- `npm run build`: sikeres, szintetikus nyilvános Supabase buildértékekkel.
- Teljes `npm test`: 1244 esetből 1242 sikeres, 2 környezetfüggő kihagyás, 0 hiba; a helyi PGlite-függőség rendelkezésre állt.
- `git diff --check`: sikeres; nincs gyökérszintű `app` és nincs új/duplikált `page.tsx`.
- Számlázási ellenőrzés szintetikus ügyféllel és mock szolgáltatóval: a külön irányítószám/település/utca XML-mezők, munkacím-felülbírálás, megosztott irányítószámok és jogosultságok lefedve. Valós számla vagy email nem készült.
## Éles visszaellenőrzés kiegészítése
A kiadás után a naptári sor már a helyes települést mutatta, de régi munkapiszkozat visszaállíthatott üres várost. A `src/lib/alinflow/drafts.ts` visszaolvasáskor kizárólag a piszkozat saját címéből/irányítószámából pótolja az üres várost, ha az adatok egyértelműek és összhangban vannak. Kitöltött város, ellentmondó irányítószám és minden más szerkesztett mező megmarad; nincs másik munka vagy adatbázisbeli cím átvétele, nincs tárolótörlés vagy automatikus adatbázis-mentés. A `tests/auth-draft-isolation.test.cjs` a régi piszkozatok helyreállítását és a felhasználói szerkesztések megőrzését is ellenőrzi.

A piszkozat-kiegészítés ellenőrzése: TypeScript és build sikeres; 1250 tesztből 1248 sikeres, 2 környezetfüggő kihagyás, 0 hiba. További adatbázis-javítás vagy migráció nincs.
