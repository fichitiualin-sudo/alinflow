# Kicsi, különálló térképes gombostűk

## Cél
A felhasználó visszajelzése alapján minden külön helyszín külön, kicsi gombostűként látszik minden nagyításnál. Nincs közeli helyszíneket összevonó kör. Mindkét térképen megmarad a gyors rajzolás, a színjelzés és az egy helyhez tartozó darabszám.

## Jelenlegi működés
A MAP_PERFORMANCE_PLAN.md szerinti csoportosított gyűrűket a felhasználó elutasította. A stabil jelölőpéldányok, optimalizált PNG-k és a memoizált forrásadatok hasznos gyorsítását megtartjuk.

## Megváltoztathatatlan szabályok
- Nincs közeli pontokat összevonó vagy állapot alapján elrejtő megjelenítés.
- A már korábban is közös, pontosan azonos koordinátájú helyszín darabszáma és összes állapotszíne megmarad; a telepítések külön megnyithatók a meglévő listából.
- Nincs adat-, dokumentum-, időpont- vagy koordinátamódosítás.
- Kijelölés és változatlan adatok nem hozzák létre újra a térképet/jelölőket, és nem állítják vissza a nagyítást.

## Adatmodell
Nincs migráció, új mező vagy környezeti változó.

## Implementáció
1. Csoportosító eltávolítása a közös jelölőrétegből és a függőségekből; minden helyszín közvetlenül a Google optimalizált rajzolójához kerül.
2. Kicsi, gyorsítótárazott PNG-gombostűk, a csúcsuk a tényleges koordinátára mutat. Egy hely esetén színes fej, több telepítés/ügyfél esetén darabszám. Közös cím esetén minden állapot színe megmarad.
3. Csak a változott jelölő tulajdonságai frissülnek; mozgatás/nagyítás nem hoz létre új jelölőket.
4. Szövegek, dokumentáció és célzott regressziótesztek frissítése.

## Ellenőrzés
Típusellenőrzés, build, térképtesztek; 600 külön jelölővel asztali/mobil böngészős próba, megmaradó nézet és példányok; éles adatok olvasási ellenőrzése.

## Elvégzett munka és eredmény
- A karbantartási és visszahívási térkép közös rétege minden külön helyszínt önálló gombostűként rajzol. Nincs közelség szerinti összevonás.
- A gombostű kinézetét utólag az eredeti `6a1ae37` változatból állítottuk vissza: ugyanaz a 40×48-as SVG-alak, sötét kontúr és nagy fehér közép, most gyorsítótárazott PNG-ként. A visszaállításkori alapméret asztalon 34×40 px, mobilon 18×22 px, több tételnél mobilon 24×28 px volt. Az újabb kérés szerinti megjelenítési méret ezek szélességének és magasságának 75%-a: rendre 25,5×30 px, 13,5×16,5 px és 18×21 px. A gyorsítótár legfeljebb 128 PNG-t tart meg.
- Mozgatás és nagyítás nem hoz létre új jelölőpéldányokat; kijelölés csak az érintett ikonokat frissíti. Koordinátaváltozás a meglévő jelölőt mozgatja.
- `npx tsc --noEmit` és `npm run build`: sikeres.
- Célzott térképtesztek: 50/50 sikeres. Teljes tesztcsomag: 506 sikeres, 2 kihagyott, 0 hibás.
- Böngésző: 600 mesterséges helyszín mind a 600 jelölője a térképen marad 9-es és 19-es nagyításnál is. Újrarajzolás, kijelölés, eltolás és a térképtípus váltása nem hoz létre új példányokat, nem hív új `fitBounds`-ot. Mobilon (390×844) a részletek és a teljes képernyő működnek. Ez a szimulált SDK-val végzett próba a Google szolgáltatás tényleges sebességét nem méri.
- Sűrű területen távoli nézetben a külön gombostűk átfedhetik egymást; közelebbi nagyítás segít elkülöníteni őket.

## Módosított fájlok
- `src/lib/alinflow/map-marker-layer.ts`
- `src/lib/alinflow/map-marker-style.ts`
- `src/components/alinflow/CallbackMapPanel.tsx`
- `src/components/alinflow/MaintenanceMapPanel.tsx`
- `src/components/alinflow/GoogleMapCanvas.css`
- `tests/map-marker-layer.test.cjs`
- `tests/map-marker-style.test.cjs`
- `package.json`, `package-lock.json`
- `docs/SCREENS_AND_UX.md`, `docs/MAP_PERFORMANCE_PLAN.md`, `docs/MAP_PIN_PLAN.md`

## Visszaállítás
Kód-visszaállítás, adatbázis-módosítás nélkül.

## Az eredeti gombostű kinézetének visszaállítása
A felhasználó a módosítások előtti gombostűt kérte vissza. A referencia a `6a1ae37` commit `MaintenanceMapPanel.tsx` fájljának `markerIcon` függvénye, amely az egységesítés előtti `5825a5c` változatban is ugyanaz. Az alak, sötét kontúr, fehér közép és az egyes helyszínek asztali/mobil mérete ebből származik. A többszínű fej, a darabszám és a gyorsítótárazott, stabil jelölőréteg megmarad.

Ellenőrzés: 51 térképteszt, `npx tsc --noEmit` és `npm run build` sikeres. Böngészőben az eredeti SVG és az új PNG három színben, mindkét méretben egymás mellett összehasonlítva. A 600 helyszín mobil- és asztali méret közötti váltása megtartja a 600 példányt és az eredeti térképkivágást; csak az ikonok frissülnek. Változatlan adatok újrarajzolása nem frissíti az ikonokat.

Az ezzel a visszaállítással módosított fájlok:
- `src/lib/alinflow/map-marker-style.ts`
- `src/lib/alinflow/map-marker-layer.ts`
- `src/components/alinflow/GoogleMapCanvas.tsx`
- `tests/map-marker-style.test.cjs`
- `tests/map-marker-layer.test.cjs`
- `docs/SCREENS_AND_UX.md`
- `docs/MAP_PIN_PLAN.md`

## A gombostűk megjelenítése 75%-os méretben
A felhasználó a visszaállított gombostűk szélességét és magasságát egyaránt 75%-ra kérte. A jelenlegi asztali méret 25,5×30 px; legfeljebb 640 px széles mobilnézetben 13,5×16,5 px, több bejegyzésnél 18×21 px. A horgonypont ugyanilyen arányban változik, így a csúcs továbbra is a helyszín koordinátájára mutat. Az alak, színek, darabszám és a gyorsítótárazott jelölőréteg megmarad.

Ellenőrzés: 10 jelölőstílus-teszt, `npx tsc --noEmit` és `npm run build` sikeres.

Módosított fájlok: `src/lib/alinflow/map-marker-style.ts`, `tests/map-marker-style.test.cjs`, `docs/SCREENS_AND_UX.md`, `docs/MAP_PIN_PLAN.md`.
