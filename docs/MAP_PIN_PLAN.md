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
- A gombostű 20×28 px, több bejegyzésnél 24×32 px, háromjegyű darabszámtól 30×38 px. A gyorsítótár legfeljebb 128 PNG-t tart meg.
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
