# Gyorsabb és áttekinthetőbb térképek

## Cél
Mindkét térképen folyamatos mozgatás és olvasható, nagyításhoz igazodó jelölők. A közeli helyszínek közös darabszámot kapnak; minden ügyfél továbbra is elérhető.

## Jelenlegi működés
A közös GoogleMapCanvas minden helyszínt külön, optimalizálás nélkül rajzol. Új marker-tömb esetén az összes jelölőt újra létrehozza és visszaállítja a nézetet. Csak a pontosan azonos koordináták kerülnek egy csoportba.

## Megváltoztathatatlan szabályok
- Mindkét térkép közös megjelenítőt használ.
- A számok az ügyfelek/telepítések darabszámát jelentik, nem a közös jelölők számát.
- Minden karbantartási állapot színe és darabszáma megmarad, a pontosan közös koordinátákon is. A kör többszínű szegélye az állapotok megoszlását jelzi; kattintásra pontos bontás jelenik meg. Egyetlen sürgős állapot sem fedheti el a többit.
- Nincs ügyfél-, dokumentum- vagy időpontmódosítás, és nincs automatikus geokódolás.

## Adatmodell
Nincs migráció vagy új tárolt adat. Kizárólag a böngészős megjelenítés változik.

## Implementációs lépések
1. Google MarkerClusterer használata a látható terület közeli pontjainak összevonására, súlyozott darabszámmal és minden állapotot mutató színes gyűrűvel.
2. Optimalizált, gyorsítótárazott jelölőképek; meglévő jelölők megtartása, csak változó adatok frissítése.
3. Kattintásra állapotonkénti pontos bontás és nagyítás gomb; választható lista az egymásra eső helyekhez.
4. Stabil React származtatott adatok, változatlan adatoknál a nézet megtartása; közös útmutató mindkét térképen.
5. Célzott tesztek, típusellenőrzés/build, asztali/mobil ellenőrzés, kiadás és éles olvasási próba.

## Ellenőrzés
- npx tsc --noEmit
- npm run build
- Jelölőcsoportok darabszáma, állapotszíne, nagyítása és közös koordináták elérése.
- Változatlan adat/kijelölés nem építi újra a térképet és nem állítja vissza a nagyítást.
- Mobil és asztali megjelenés, keresés, szűrés, teljes képernyő, komponens leállítása.

## Visszaállítás
Kód visszaállítása migráció nélkül; az összes korábbi adat megmarad.

## Elkészült működés
- Mindkét térképen kis számozott gyűrűk és a látható területre korlátozott Google MarkerClusterer. Az összes állapot színe és súlyozott darabszáma megmarad, a közös koordinátákon is.
- A ritka állapotok legalább 10 fokos gyűrűszeletet kapnak az észrevehetőséghez; a felugró ablak minden esetben a pontos darabszámot mutatja.
- A közös jelölőből külön nagyítás vagy tízesével lapozható helyszínválasztás érhető el. Maximális nagyításnál is minden helyszín megnyitható.
- 28 px-es alapjelölő, 36 px-es csoportjelölő; a háromjegyű számhoz az egyetlen helyszín is 36 px-re nő (négyjegyű számtól 40 px), hogy a szám olvasható maradjon. Retina PNG-k, legfeljebb 128 gyorsítótárazott kép.
- Változatlan adatok és kijelölés nem hozza létre újra a helyszínjelölőket és nem állítja vissza a nézetet. A karbantartási állapotok számítása a helyi nap változását is figyelembe veszi a következő rendereléskor.

## Módosított fájlok
- `src/components/alinflow/GoogleMapCanvas.tsx`, `GoogleMapCanvas.css`: közös megjelenítő és felugró bontás.
- `src/components/alinflow/MaintenanceMapPanel.tsx`, `CallbackMapPanel.tsx`: teljes színösszetétel, súlyozott darabszám, színmagyarázat és útmutató.
- `src/lib/alinflow/map-marker-layer.ts`: jelölőpéldányok megtartása, látható terület csoportjai, kijelölés, részletek és erőforrások felszabadítása.
- `src/lib/alinflow/map-marker-style.ts`: állapotonkénti összesítés és gyorsítótárazott gyűrűképek.
- `src/app/page.tsx`: származtatott ügyfél- és térképadatok memoizálása.
- `tests/map-marker-layer.test.cjs`, `map-marker-style.test.cjs`: célzott regressziótesztek.
- `package.json`, `package-lock.json`: rögzített `@googlemaps/markerclusterer@2.6.2` függőség.
- `docs/SCREENS_AND_UX.md`, jelen terv: végleges működés és ellenőrzés.

## Ellenőrzési eredmények
- Típusellenőrzés és production build sikeres.
- Térképes tesztcsomag: 50/50 sikeres. Teljes csomag: 506 sikeres, 2 izolált adatbázis-restaurálást igénylő teszt kihagyva, 0 hiba. Az utolsó képméret-finomítás után mind a 22 új teszt ismét sikeres.
- Böngészőben 600 mesterséges helyszínnel, tényleges Google MarkerClustererrel és Mercator-vetítésű SDK-másolattal: asztali kezdőnézetben 6 jelölő, mobilon 5 jelölő. Újrarenderelés/kijelölés után 1 térkép, változatlan jelölőlétrehozás és fitBounds-szám; csak a megfelelő ikonok frissültek.
- Nagyítás, több állapot színes/pontos bontása, maximális nagyításnál 15 egybeeső hely lapozása, két térképmód, mozgatás és teljes képernyő működött. A vizsgált nagyított mintanézetben 0 átfedő jelölőpár. Mobil 390 px nézetben 375 px tartalomszélesség, vízszintes túlcsordulás nélkül.
- Nincs gyökér `app/`, duplikált főoldal, migráció vagy új környezeti változó. Korábbi dokumentumok/időpontok mentését nem módosítja.

## Korlátok és források
Az SDK-másolatos próba a megjelenítést és a valódi csoportosítási algoritmust teszteli; a Google hálózatának sebességét és az egyes készülékek képfrissítését nem méri. Az optimalizált képes jelölők mellett a meglévő ügyféllista biztosít billentyűzetes elérést. A szélsőségesen sűrű nézet további nagyítással vagy a csoport listájával bontható ki; koordináták és ügyféladatok nem módosulnak.

Google-források: [jelölők csoportosítása](https://developers.google.com/maps/documentation/javascript/marker-clustering), [képek megjelenítési mérete és optimalizálása](https://developers.google.com/maps/documentation/javascript/reference/marker#Icon).
