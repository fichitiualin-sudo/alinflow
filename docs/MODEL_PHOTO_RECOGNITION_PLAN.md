# Pontos típuskód felismerése a mentett fotóról

## Cél
Az AlinFlow saját beolvasója olvassa ki és töltse a típusmezőbe a fotón szereplő beltéri/kültéri kódot. A kézzel már azonosított kód beírása nem helyettesíti az automatikus felismerést.

## Jelenlegi működés
A vonalkódos S/N sikeres. A teljes képen futó egyszeri helyi Tesseract SPARSE_TEXT a táblázatos, ferde adattábla típussorát kihagyja, miközben emberileg olvasható. A készülékpanel a kapott egyedi típust már kitölti az üres draftmezőbe.

## Megváltoztathatatlan szabályok
- Valódi képből kell felismerni: nincs a fotóhoz, terméknévhez vagy S/N-hez kötött előre beírt típuskód.
- A két oldal, készülék és időpont nem keveredhet; korábbi adatok és dokumentumok megmaradnak.
- A meglévő típus nem íródik át automatikusan; ellenőrzés után továbbra is felhasználói mentés történik.
- A feldolgozás helyben fut; a valós képek és ügyféladatok nem kerülnek a repóba vagy külső képfelismerő szolgáltatásba.
- A teszt idején az éles készülék már kitöltött típusmezője nem szolgálhat a felismerés bizonyítékaként.

## Adatmodell
Nincs új mező vagy migráció. A meglévő modellmezők és mentési folyamat marad.

## Implementációs lépések
1. A típussor képrészletének helyi OCR-vizsgálata, megfelelő előfeldolgozás bizonyítása.
2. Általános, képtartalom-alapú adattábla/részlet-feldolgozás a meglévő beolvasásban, korlátos erőforrás- és időhasználattal.
3. Regressziós tesztek az előfeldolgozásra, részleges eredményre, megszakításra és mezőkitöltésre.
4. Üres helyi készülékmezőkkel a két valós képről történő tényleges automatikus kitöltés ellenőrzése; típusellenőrzés, build, kiadás és éles próba.

## Ellenőrzés
`npm test`, `npx tsc --noEmit`, `npm run build`; mobil/asztali próba, helyi elkülönített adatokkal. A siker pontos képi típusfelismerést jelent, nem kézi pótlást vagy előre ismert termékkód visszaadását.

## Visszaállítás
A kód előző kiadása adatvesztés nélkül visszaállítható.

## Eredmények és módosított fájlok
- A helyi felismerő az összefüggő világos táblázatcellákat keresi, a szomszédos felirat/érték párt kiegyenesíti, és ugyanazzal az OCR-workerrel olvassa. Legfeljebb tíz képrészletet és két kötőjel-elválasztási változatot dolgoz fel.
- A jól olvasható alapképet megőrzi; gyenge alapfelismerésnél az egyező változatokat használja. Eltérő, azonos támogatottságú találatok választási lehetőségként maradnak. Nincs I/1 vagy O/0 karaktercsere.
- Az eredeti OCR-ből már kiolvasott gyártó és S/N megmarad; a részlet saját oldalát külön kezeli. Megszakítás és időtúllépés az előfeldolgozást is leállítja.
- Két korábbi valós adattábla-fotóval, üres helyi tesztmezőkből mindkét pontos típuskód és S/N automatikusan bekerült a megfelelő mezőbe. A kültéri fotó a közös gyártót is kitöltötte. A második készülék üres adatai változatlanok maradtak.
- A mobilnézet (390 × 844), helyi mentés és visszatöltés sikeres. Éles ügyféladatot a próba nem módosított.
- `npm test`: 359 teszt, 357 sikeres, 2 kihagyott, 0 hibás; a PGlite-adatbázistesztek engedélyezve. `npx tsc --noEmit` és `npm run build`: sikeres. Nincs gyökér `app/` vagy új/duplikált `page.tsx`.
- Módosított fájlok: `src/lib/alinflow/serial-recognition.ts`, `src/lib/alinflow/device-label-regions.ts`, `tests/serial-recognition.test.cjs`, `tests/device-label-regions.test.cjs`, ez a terv.
