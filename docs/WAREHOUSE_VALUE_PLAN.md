# Bruttó készletérték és raktári csoportosítás

## Cél és jelenlegi működés
A belső beszerzési ár jelenleg a mentett nettó/bruttó formában látható. A Raktár folyamatos listája most mindig bruttó egységárat, valamint teljes, lefoglalt és szabad bruttó beszerzési értéket mutat. Először a pozitív fizikai készletű tételek, utánuk a többi jelenik meg, mindkét csoport magyar betűrendben. A „Raktár logika” és „Mit jelent?” kártyák megszűnnek.

## Megváltoztathatatlan szabályok és adatmodell
- Nincs séma- vagy mentési változás: az eredetileg megadott nettó/bruttó összeg és jelölés megmarad. A bruttósítás megjelenítési számítás, nettó árnál 27%-kal. Az árszerkesztő ezt egyértelműen jelzi.
- Kizárólag belső beszerzési érték; minden ár és összesítő nyomtatáskor rejtett, ügyfélnek szánt adatba nem kerül.
- Fizikai készlet értéke = pozitív készlet × bruttó beszerzési egységár. A lefoglalt rész készlettételenként legfeljebb a raktáron lévő mennyiség; a többletfoglalás korábbi figyelmeztetése megmarad.
- Hiányzó ár nem nulla. Az összesítő jelzi az ismeretlen árú készlettételeket és a részösszeget. Betöltési hiba alatt nem mutat teljesnek látszó nullaértéket.
- A kereső csak a listát szűri; az összesítő mindig a teljes raktárra vonatkozik.
- A listák rendezése nem módosítja a kapott tömböket, a termékeket, készletmozgásokat, foglalásokat vagy korábbi dokumentumokat.

A bruttósításnál alkalmazott általános áfakulcs forrása: [Áfa tv. 82. § (1), Nemzeti Jogszabálytár](https://njt.jog.gov.hu/jogszabaly/2007-127-00-00.101), ellenőrizve 2026-09-14. Ez belső készletérték-számítás; a számlázó adóbeállításait nem módosítja.

## Lépések
1. Bruttósítási, készletérték- és csoportosítási segédfüggvények és célzott tesztek.
2. Egységes bruttó kijelzés, belső összesítő és két betűrendes csoport a klímáknál és az anyagoknál; elavult magyarázókártyák eltávolítása.
3. Mobil/asztali próba, korábbi mentések kompatibilitása és adatvédelmi regresszió.
4. Típusellenőrzés, build, kiadás és csak olvasási éles ellenőrzés.

## Ellenőrzés és visszaállítás
`npx tsc --noEmit`, `npm run build`, meglévő és célzott tesztek: nettó/bruttó ekvivalencia, kerekítés, tört anyagmennyiség, nulla/hiányzó ár, túlfoglalás, magyar rendezés, kereséstől független összesítés, nyomtatási rejtés. Adatbázis-migráció nem szükséges. A kód az előző kiadásra visszaállítható, mert mentett adatot nem alakít át.

## Eredmények és fájljegyzék
- Elkészült a bruttó árkijelzés és előnézet, a teljes/lefoglalt/szabad készletérték és a két betűrendes csoport. A régi magyarázókártyák eltávolítva.
- `npm test`: 282 tesztből 280 sikeres, 2 kihagyott, 0 hibás; a helyi adatbázisos regresszió PGlite-tal futott. `npx tsc --noEmit` és `npm run build`: sikeres. `git diff --check`: rendben. Nincs gyökérszintű `app/` vagy új `page.tsx`.
- A valódi raktárkomponens helyi, kizárólag mesterséges adatokkal végzett böngészőpróbája 390×844 és 1366×900 méretben rendben; nincs vízszintes túlcsordulás. A korábban nettóként mentett ár eredeti összeggel/típussal szerkeszthető. Nettó 100 000 Ft mentése után a bruttó egységár 127 000 Ft; 10 darabos készlet és 2 foglalt darab mellett az értékek 1 270 000 / 254 000 / 1 016 000 Ft. Kereséskor az összesítő változatlan, az összes tétel lapozás nélkül elérhető.
- A hiányzó/hibás árbetöltést, részösszeget, nulla értéket, tört mennyiséget, túlfoglalást, bruttó megadást, magyar rendezést és belső adatok nyomtatási/ügyféloldali elrejtését célzott tesztek ellenőrzik.
- Kiadás után csak olvasási ellenőrzés szükséges: az új összesítő és csoportok megjelennek, a meglévő árak betöltődnek. Adatbázis-migráció és új környezeti változó nem szükséges.

Módosított fájlok:
- `src/components/alinflow/InventoryPurchasePrice.tsx`
- `src/components/alinflow/WarehousePanel.tsx`
- `src/lib/alinflow/warehouse-value.ts`
- `tests/inventory-purchase-prices-panel.test.cjs`
- `tests/warehouse-value.test.cjs`
- `docs/SCREENS_AND_UX.md`
- `docs/TEST_CHECKLIST.md`
- `docs/WAREHOUSE_VALUE_PLAN.md`
