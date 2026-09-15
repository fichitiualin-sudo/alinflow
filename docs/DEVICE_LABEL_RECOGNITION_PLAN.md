# Készülékadatok beolvasása adattábláról

## Cél
Egy fotó beolvasása együtt javasolja a gyártót, az adott beltéri vagy kültéri pontos típusát és az S/N-t. Az ellenőrzött mezők egyetlen mentéssel rögzíthetők, a Munkafotók alatt.

## Jelenlegi működés
Az AppointmentDevicesPanel külön kezeli a sorozatszám-javaslat kiválasztását és mentését. A vonalkód sikeres olvasása után a szövegfelismerés elmarad, ezért gyártó és típus még nem olvasható be.

## Megváltoztathatatlan szabályok
- Meglévő adatok, dokumentumok, képek és készülékkapcsolatok megmaradnak.
- Felismerés csak helyben, a fotó nem kerül külső felismerőszolgáltatásba.
- Egyértelmű javaslat csak üres szerkesztett mezőt tölthet ki; meglévő érték cseréje külön kiválasztást igényel. Tartós mentés mindig felhasználói művelet.
- Az oldalak és a készülékek nem keveredhetnek. Marketingnévből nem találunk ki pontos típust.
- Valós ügyfélfotó, személyes adat vagy azonosító nem kerül tesztadatként a repóba.

## Adatmodell
A meglévő manufacturer, indoorModel, outdoorModel, indoorSerial és outdoorSerial JSON-mezőket használjuk. Migráció nincs.

## Implementációs lépések
1. Valós képek helyi OCR-vizsgálata; konzervatív gyártó- és típuscímke-feldolgozás.
2. Vonalkód és szöveg együttes felismerése megszakítható, korlátos feldolgozással; részleges eredmény megőrzése.
3. Gyártó és oldalankénti típus/S/N csoportok, automatikus üresmező-kitöltés, egyetlen ellenőrzés utáni mentés.
4. Regressziós tesztek, típusellenőrzés, build, mobil/asztali próba, kiadás és éles ellenőrzés.

## Ellenőrzés
`npm test`, `npx tsc --noEmit`, `npm run build`, mobil/asztali komponenspróba és valódi fotók olvasási ellenőrzése. Korábbi adat és másik oldal megőrzése, megszakítás, részleges felismerés és visszatöltés tesztelendő.

## Visszaállítás
A kód visszaállítása adatvesztés nélkül; nincs adatbázis-változtatás.

## Eredmények és módosított fájlok
- Elkészült a közös gyártó és az oldalankénti pontos típus/S/N beolvasása. Egyedi találat üres draftmezőbe kerül, eltérő vagy több találat mezőnként választható. Egyetlen mentés rögzít minden készülékadatot, a többi műszaki mező megőrzésével.
- A Munkafotók alatt megszűnt a további belső lenyitás. A beolvasás végén a felület a mezőkhöz görget. A hiányzó adatokat megnevezi, közelebbi/szemből fotót vagy kézi kitöltést ajánl.
- A helyi vonalkódos S/N mellé szövegfelismerés került. Csak OCR-hez, ideiglenesen kétszeres nagyítás készül, legfeljebb 3840 pixeles hosszabb oldallal. A tárolt fotó és tárhelyhasználat nem változik. A 90 másodperces OCR-időkorlát a modulbetöltést és képelőkészítést is lefedi; megszakítás után késői eredmény nem tölti ki a mezőket. OCR-hiba esetén a sikeres vonalkód részleges találatként megmarad.
- A magyar/angol típuskód- és gyártócímkék feldolgozása kizárja az ellenkező egységet, elektromos értékeket, csonka típuskódot és a kétkarakteres ismeretlen gyártózajt. Nem következtet marketingnévből és nem javítgat hasonló betűket/számokat.
- Valós fotókkal, helyi másolaton: mindkét S/N sikeres; a kültériről a Midea gyártó is automatikusan kitöltődik. A fotókon a pontos típusok nem olvashatók biztonságosan. Jól olvasható szintetikus adattáblán gyártó, pontos típus és S/N együttes kitöltése, egyetlen mentése és visszatöltése sikeres. Valós ügyféladatba tesztérték nem került.
- Mobil (390×844) és asztali (1366×900) próba sikeres, vízszintes túlcsordulás és böngészőkonzol-hiba nélkül. Meglévő adatok, másik oldal, dupla indítás, megszakítás, részleges eredmény és retained készülékek regressziói sikeresek.
- `npm test`: 336 teszt, 334 sikeres, 2 korábbi natív PostgreSQL-próba kihagyva, 0 hiba; a PGlite-tesztek futottak. `npx tsc --noEmit`, `npm run build` és `git diff --check` sikeres. Nincs új gyökérszintű `app/` vagy `page.tsx`.
- Migráció és új környezeti változó nem szükséges. Korlát: az OCR találatai ellenőrzendők; távoli, ferde vagy csillogó címkéről a pontos típust kézzel vagy új fotóval kell pótolni. A vonalkód-feldolgozás és a fotóletöltés a külön OCR-időkorláton kívül marad.

Módosított fájlok:
- `src/components/alinflow/AppointmentDevicesPanel.tsx`
- `src/components/alinflow/WorkPhotosPanel.tsx`
- `src/lib/alinflow/serial-recognition.ts`
- `src/lib/alinflow/device-label.ts`
- `src/lib/alinflow/device-label-image.ts`
- `tests/appointment-devices-panel.test.cjs`
- `tests/serial-recognition.test.cjs`
- `tests/device-label.test.cjs`
- `tests/device-label-image.test.cjs`
- `docs/SCREENS_AND_UX.md`
- `docs/TEST_CHECKLIST.md`
- `docs/DEVICE_LABEL_RECOGNITION_PLAN.md`
