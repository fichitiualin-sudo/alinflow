# Sorozatszám-felismerés és munkafotók

## Cél
A valós munkán feltöltött adattábla-fotókon jelentett felismerési hiba feltárása és javítása. A „Sorozatszámok és adattábla-fotók” rész kizárólag a Munkafotók lenyíló részében legyen elérhető.

## Jelenlegi működés
Az AppointmentDevicesPanel az időpont klímalistája alatt szerepel; külön beltéri/kültéri fotógalériát használ. A felismerés a mentett képet tölti le, majd helyben Tesseract böngészőworkerrel dolgozik. Minden kivétel azonos, fotóminőséget említő üzenetbe torkollik. Az S/N-feldolgozás csak szűk címkeformátumokat fogad el.

## Megváltoztathatatlan szabályok
- Meglévő kép, készülékkapcsolat, sorozatszám és dokumentum nem sérülhet.
- A fotók privátak, a felismerés helyben történik; valós ügyfélfotó nem kerül tesztfixture-be vagy a repóba.
- Felismerési javaslat csak ellenőrzés és kiválasztás után kerül a szerkesztőbe, mentett adatot nem ír felül automatikusan.
- Ügyfél-, munkaterület-, időpont- és beltéri/kültéri kapcsolatok megmaradnak.

## Adatmodell
Az áthelyezés UI-változás. Új tábla vagy korábbi képek átmásolása nem szükséges.

## Implementációs lépések
1. A jelentett munka és fotók olvasási vizsgálata, hiba reprodukálása.
2. A készülékfotós rész áthelyezése a Munkafotók alá, meglévő funkciók megtartásával.
3. Bizonyított felismerési ok javítása és regressziós tesztek.
4. Típusellenőrzés, build, mobil/asztali próba, kiadás és éles ellenőrzés.

## Ellenőrzés
`npx tsc --noEmit`, `npm run build`, célzott és meglévő tesztek. OCR-próba valós képpel, tartós ügyféladat-változtatás nélkül.

## Visszaállítás
A kód előző kiadása visszaállítható; meglévő fotó- és készülékadat nem változik.

## Eredmények és módosított fájlok
- Az éles telepítés két korábban feltöltött fotójával reprodukálva: a Tesseract elindult, de a teljes képen lévő keskeny/fényvisszaverő feliratokról hibás, szétszórt szöveget adott. Nem tárhely- vagy mentési hiba volt.
- Új helyi Code 128 beolvasás (`@zxing/library@0.23.0`), sűrű sorvizsgálattal, két iránnyal és több fényességi küszöbbel; szükség esetén legfeljebb kétszeres nagyítás. Ellenőrzőösszeg-hibás eredményt elutasít, legfeljebb öt különböző, ellenőrizendő azonosítót ad. Vonalkód hiányában a korábbi helyi OCR következik; a címkefeldolgozás üres sorokat, kettőspont nélküli SN-t és több címkét is kezel.
- A „Sorozatszámok és adattábla-fotók” rész kizárólag a Munkafotók alá került. A képek és beltéri/kültéri készülékkapcsolatok változatlanok. A letöltési és motorhibák külön üzenetet kapnak; dupla indítás és késői eredmények ellen védelem működik.
- Mindkét eredeti fotó pontos azonosítóját sikeresen beolvasta a tényleges böngészős komponens. Kiválasztás, külön helyi tesztmentés és visszatöltés a megfelelő mezőbe sikeres. Valós ügyféladatba tesztérték nem íródott. Vonalkód nélküli szintetikus képen az OCR-tartalékág is sikeres (`TESTABC012345`).
- Mobil (390×844) és asztali (1366×900) ellenőrzés: nincs vízszintes túlcsordulás, egyetlen belépési pont, a klímalista becsukva is külön használható fotórész. Böngészőkonzol hiba nélkül.
- `npm test`: 306 tesztből 304 sikeres, 2 korábbi natív PostgreSQL-teszt kihagyott, 0 hiba. A PGlite-regresszió futott. `npx tsc --noEmit`, `npm run build`, `git diff --check`: sikeres. Nincs gyökérszintű `app/` vagy új `page.tsx`.
- Migráció és új környezeti változó nem szükséges. A valós fotók, azonosítók és privát URL-ek nem kerültek a repóba. Éles kiadás után ugyanazon két fotóval, tartós adatírás nélkül ellenőrizendő a beolvasás.
- Korlát: a beolvasott vonalkód azonosítóját továbbra is össze kell vetni a képen az S/N-nel; más vonalkódtípusokra a szövegfelismerés marad. A 90 másodperces időkorlát az OCR-worker szakaszra vonatkozik, a modulimport/képdekódolás külön időkorlátot nem kapott. Elhagyott nézetbe késői eredmény nem ír.

Technikai források: [ZXing Code128Reader](https://github.com/zxing-js/library/blob/master/src/core/oned/Code128Reader.ts), [Tesseract helyi recognize API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md).

Módosított fájlok:
- `src/components/alinflow/AppointmentDevicesPanel.tsx`
- `src/components/alinflow/WorkPagePanel.tsx`
- `src/components/alinflow/WorkPhotosPanel.tsx`
- `src/lib/alinflow/serial-recognition.ts`
- `src/lib/alinflow/serial-barcode.ts`
- `tests/appointment-devices-panel.test.cjs`
- `tests/work-photo-placement.test.cjs`
- `tests/serial-recognition.test.cjs`
- `tests/serial-barcode.test.cjs`
- `package.json`
- `package-lock.json`
- `docs/SCREENS_AND_UX.md`
- `docs/TEST_CHECKLIST.md`
- `docs/SERIAL_PHOTO_FIX_PLAN.md`
