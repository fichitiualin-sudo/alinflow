# Folyamatos raktárlista és belső beszerzési árak

## Cél
A klíma- és anyagkészlet egyben görgethető, lapozás nélküli lista legyen. Mindkét készlettípusnál megadható és látható legyen a beszerzési egységár, világos nettó/bruttó jelöléssel. Ez az adat semmilyen ügyfélnek szánt ajánlatba, dokumentumba, emailbe, számlába vagy naptárbejegyzésbe nem kerülhet.

## Jelenlegi működés
A `WarehousePanel.tsx` a már betöltött készletet tízes oldalakra vágja. A `ClimateProduct.price` és `installPrice` ügyfélnek szánt ár, a beszerzési ár jelenleg nincs tárolva. Az anyagok azonosítója a munkaterületen belüli név. A termékár-szinkron nyilvános eladási árat frissít.

## Megváltoztathatatlan szabályok
- A raktáron, lefoglalt és szabad mennyiség számítása és a készletmozgatás változatlan marad.
- Beszerzési ár nem kerül a termék-, ajánlattétel-, ügyfél- vagy cégbeállítás-objektumba; saját belső adattárolása van.
- A publikus katalógus-szinkron nem írhatja felül a belső árakat.
- A korábbi dokumentumokat és készletet nem módosítja a migráció. Árat nem találunk ki, a hiányzó ár nem nulla.
- Hibás vagy párhuzamos mentés nem jelenthet hamis sikert. Másik munkaterület és kijelentkezés után nem maradhat látható belső adat.
- A lapozás megszüntetése a raktárra vonatkozik; a többi lista szabálya megmarad.

## Adatmodell
Új, kizárólag aktív munkaterület-tagok által olvasható és írható `inventory_purchase_prices` tábla: munkaterület, tételtípus, termékazonosító/anyagnév, opcionális beszerzési egységár, nettó/bruttó jelölés és szerveroldali verzióidőbélyeg. Az árak csak a raktár megnyitásakor töltődnek be, külön komponensállapotba. A mentés pontos munkaterületet és a korábbi verziót ellenőrzi. Az üres ár mező törlés helyett nullát tárol.

## Implementációs lépések
1. Kimeneti adatfolyamok célzott, független adatvédelmi áttekintése.
2. A belső áradatok idempotens, additív migrációja és mentési/betöltési segédmodulja.
3. Folyamatos raktárlista és egyszerű, tételenkénti ármegadás.
4. Célzott adatvédelmi, hatókör-, árkezelési és SQL-tesztek, mobil/asztali ellenőrzés.
5. Friss mentés és sémaaudit után migráció, kiadás és olvasási ellenőrzés az éles felületen.

## Ellenőrzés
- `npx tsc --noEmit`, `npm run build`, célzott és meglévő regressziós tesztek.
- Több mint tíz tétel egyszerre látható; készletműveletek elérhetők.
- Ár mentése/visszatöltése, üres/0/negatív/tizedes összeg, elavult verzió és munkaterületváltás.
- Belső árak kizárása minden ügyfélnek szánt adatból, eredeti eladási ár megőrzése.
- SQL kétszeri futtatás, aktív/inaktív/anonim/másik munkaterület hozzáférése, régi adatok megőrzése.

## Visszaállítás
A kód visszaállítható a megelőző kiadásra. Az új belső ártáblát és a korábbi adatokat meg kell őrizni; eladási árakat és készletmozgásokat nem módosítunk visszaállításkor.

## Eredmények és módosított fájlok

- A klímák és anyagok lapozás nélkül jelennek meg, közös keresővel. Minden tételhez külön nettó/bruttó beszerzési egységár menthető. Kezdetben nincs kitalált ár; üres mezővel törölhető az érték.
- A belső ármodult kizárólag a Raktár használja. A teljes árblokk nyomtatáskor rejtett. A `cleanQuoteItems` kifejezett mezőlistája eldobja az ismeretlen, esetleg véletlenül hozzákevert belső adatot is.
- `npm test`: 260 sikeres, 2 meglévő natív PostgreSQL-restore teszt környezeti okból kihagyva, nincs hiba. Új SQL: 22/22 sikeres. `npx tsc --noEmit` és `npm run build`: sikeres.
- Mobil 390 px és asztali 1366 px ellenőrizve; vízszintes túlcsordulás nincs. Szintetikus 22 klíma és 13 anyag egyszerre elérhető. `123456,78` nettó tesztár mentése és teljes oldal-újratöltés utáni visszaolvasása helyes; másik tesztcégben nem látható. Készletgombok, hibakezelés, párhuzamos mentés, keresés és nyomtatási rejtés tesztelve.
- Friss adatmentés: Downloads `Supabase Snippet Untitled query (6).csv`, 23 public tábla 3981 sora és 7 Storage objektum metaadata. SHA256: `F96F02733073A40416EA257765B192D8B9B19FADFDDB1BF45214C9B2174F64AA`. A mentés nem képfájlmásolat; a migráció Storage objektumot nem módosít.
- Teljes sémaaudit: Downloads `Supabase Snippet Untitled query (5).csv`, 20 függvény és 17 trigger teljes definíciója, táblák/indexek/policyk/jogok. SHA256: `8C4EB0189D86F08D0C38F214B38D15EE56BC2901D02999BA4DC30D5861AD8A07`. A mentések a repón kívül maradtak.
- Az `INVENTORY_PURCHASE_PRICES.sql` élesben kétszer sikeresen lefutott. Az utóellenőrzés szerint 38 termék, 7 anyag, 28 készletsor, 598 ügyfél, 781 időpont, 513 dokumentum, 113 munkalap, 70 nyilatkozat és 7 fotó megmaradt. Az új tábla üres, RLS és trigger aktív, három célzott policy van, anonim olvasás tiltott.
- Nincs új környezeti változó vagy további futtatandó migráció. Valódi beszerzési árat, készletmozgást vagy ügyfelemailt a teszt nem hozott létre. Kiadási ág: `codex/warehouse-purchase-prices`.

Ténylegesen módosított fájlok:

- [docs/DATA_MODEL.md](DATA_MODEL.md)
- [docs/SCREENS_AND_UX.md](SCREENS_AND_UX.md)
- [docs/TEST_CHECKLIST.md](TEST_CHECKLIST.md)
- [docs/WAREHOUSE_PURCHASE_PRICES_PLAN.md](WAREHOUSE_PURCHASE_PRICES_PLAN.md)
- [docs/sql/INVENTORY_PURCHASE_PRICES.sql](sql/INVENTORY_PURCHASE_PRICES.sql)
- [src/app/page.tsx](../src/app/page.tsx)
- [src/components/alinflow/WarehousePanel.tsx](../src/components/alinflow/WarehousePanel.tsx)
- [src/components/alinflow/InventoryPurchasePrice.tsx](../src/components/alinflow/InventoryPurchasePrice.tsx)
- [src/lib/alinflow/inventory-purchase-prices.ts](../src/lib/alinflow/inventory-purchase-prices.ts)
- [src/lib/alinflow/products.ts](../src/lib/alinflow/products.ts)
- [tests/inventory-purchase-prices.test.cjs](../tests/inventory-purchase-prices.test.cjs)
- [tests/inventory-purchase-prices-panel.test.cjs](../tests/inventory-purchase-prices-panel.test.cjs)
- [tests/inventory-purchase-prices-sql.test.mjs](../tests/inventory-purchase-prices-sql.test.mjs)
- [tests/warehouse-privacy.test.cjs](../tests/warehouse-privacy.test.cjs)
