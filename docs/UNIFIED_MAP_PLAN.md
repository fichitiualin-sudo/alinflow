# Egységes térképek

## Cél
A visszahívandó és a telepített klímák nézete ugyanazt a térképszolgáltatót, kinézetet, méretezést és kezelőgombokat használja.

## Jelenlegi működés és döntés
A MaintenanceMapPanel Google Maps megjelenítést, az időpontok mentett címkoordinátáit és Google címkeresést használ. A CallbackMapPanel Leaflet/OpenStreetMap alapot és helyi GeoNames településpontokat használ. Éles olvasási ellenőrzéskor a Google térkép működött, 595 szerelési pontból 589 koordinátával rendelkezett.

A közös megjelenítő Google Maps lesz: ez őrzi meg a meglévő pontos szerelési helyeket és címkeresést szolgáltatóváltás/adatmigráció nélkül. A GeoNames településpontok továbbra is helyben oldódnak fel, az érdeklődők címét nem küldjük új geokódolásra. A Google geokódolási felhasználási feltételeinek EGT- és globális változatai eltérnek; az egységes Google megjelenítő választása nem igényli ezek közötti, számlázási régiótól függő átállást.

## Megváltoztathatatlan szabályok
- Az ügyfelek, időpontok, dokumentumok és koordináták változatlanok.
- Visszahívandóknál megmarad a településcsoportosítás, keresés és a nem jelölhető ügyfelek listája.
- Telepítéseknél megmarad az időponthoz kötött hely, az összes karbantartási állapot/szűrő, a dátumok, a letiltás, ügyfélmegnyitás és útvonalhivatkozás.
- Az azonos koordinátájú telepítések közös számozott jelölőről külön elérhetők; egyik időpont sem takarhatja el a másikat.
- Térképhibánál használható lista; térképváltáskor nincs új főoldali adatbetöltés.

## Adatmodell
Nincs új adatbázismező, migráció vagy környezeti változó. A meglévő nyilvános Google Maps kulcsot mindkét nézet használja; a szerveroldali címkeresés változatlan.

## Lépések
1. Közös Google térképkomponens: egyszeri, újrapróbálható betöltés, egységes számozott jelölők, nagyítás, teljes képernyő, hibaállapot és cleanup.
2. Mindkét panel átvezetése a közös komponensre és azonos térkép/lista elrendezésre; Leaflet-függőségek eltávolítása.
3. Koordinátacsoportosítás és betöltő célzott tesztjei, teljes típusellenőrzés/build, mobil/asztali próba.
4. Éles kiadás és mindkét nézet ellenőrzése.

## Ellenőrzés
`npx tsc --noEmit`, `npm run build`, célzott és teljes tesztcsomag. Mobil/asztali térképváltás, jelölő, egyező koordináták, popup/ügyfélmegnyitás, teljes képernyő/Escape, szűrés, üres és hibás térkép. Nincs gyökér app vagy duplikált főoldal.

## Visszaállítás
Kód-visszaállítás adatbázis- vagy koordinátaváltozás nélkül.

## Módosított fájlok és eredmények
- `src/components/alinflow/GoogleMapCanvas.tsx`, `GoogleMapCanvas.css`: közös megjelenítés és kezelők; teljes képernyő, Escape/fókusz-visszaadás, újrapróbálható hiba.
- `src/lib/alinflow/google-maps-loader.ts`: egyszeri SDK-betöltés, időkorlát, hálózati és késői hitelesítési hibák kezelése.
- `src/components/alinflow/CallbackMapPanel.tsx`, `MaintenanceMapPanel.tsx`: közös megjelenítő és elrendezés; a korábbi `CallbackMapPanel.css` törölve.
- `src/lib/alinflow/maintenance-map.ts`: véges és tartományon belüli koordináták ellenőrzése, azonos pontok csoportosítása az időpontok megtartásával.
- `src/app/page.tsx`: közös visszalépés, dinamikus térképbetöltés és meglévő Google-kulcs átadása.
- `package.json`, `package-lock.json`: Leaflet és típusfüggőségeinek eltávolítása.
- `tests/google-maps-loader.test.cjs`, `tests/maintenance-map-groups.test.cjs`: betöltés, hibák/újrapróbálás, közös koordináták és adatváltozatlanság regressziótesztjei.
- `docs/SCREENS_AND_UX.md`, jelen terv: működés és ellenőrzés dokumentálása.

A típusellenőrzés és a production build sikeres. A teljes tesztcsomag első futása 442 sikeres, 2 feltételesen kihagyott adatbázis-restore teszt; a késői hitelesítési javítás után mind a 28 térképes teszt sikeres (köztük 2 új teszt). Nincs gyökérszintű `app/`, a főoldal egyetlen `src/app/page.tsx` fájlban maradt. A meglévő Facebook-aktiválási dokumentumok korábbi munkapéldány-módosításai nem részei ennek a kiadásnak.

Böngészős próba: a teljes alkalmazás 390 és 1366 px széles helyi nézetben, mesterséges Supabase-adatokkal és hálózat nélküli Google SDK-másolattal. Sikeres térképváltás, 13 közös koordinátájú telepítés csoportosítása/10-es lapozása, felugró ablakból a helyes időpont megnyitása, szűrés, üres keresés, teljes képernyő/Escape és betöltési hiba utáni újrapróbálás. Nincs vízszintes túlcsordulás vagy új teljes Supabase-betöltés térképváltáskor. A valódi Google SDK ellenőrzése az éles kiadás után következik.
