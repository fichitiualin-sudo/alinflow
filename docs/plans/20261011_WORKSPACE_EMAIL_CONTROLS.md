# Munkaterületi emailek és választható küldés

## Cél

Az emailek a saját vállalkozás feladónevét és értékelési linkjeit használják. A teljes lezáráskor a köszönő email, naptárból rögzítéskor az ajánlat és időpontlevél külön pipával választható. A vásárlási nyilatkozat alapból csukott részbe kerül; a H tarifa kikerül a dokumentumfelületből.

## Jelenlegi működés

A globális EMAIL_FROM felülírhatja a munkaterületi feladónevet. Az email route-ok kliensoldali beállításból és KLIMAlin alapértékekből építkeznek. A teljes lezárás és a naptárból rögzítés automatikusan indít leveleket. A munkaoldal tartalmazza a nyilatkozatot és a H tarifa panelt.

## Megváltoztathatatlan szabályok

- Egyik munkaterület sem kapja meg a másik márkanevét, kapcsolattartóját vagy értékelési linkjeit alapértékként.
- A hitelesített küldőcím marad; a megjelenő feladónév a munkaterületé.
- Kikapcsolt pipa esetén nincs email és nincs elküldöttnek jelölt dokumentum. A mentés és lezárás ettől sikeres lehet.
- Az idempotencia és a részleges hibák újrapróbálása megmarad.
- Meglévő ügyfelek, időpontok, aláírt nyilatkozatok és mentett dokumentumok nem törlődnek.
- Éles ügyfélnek ellenőrzés közben nem küldünk levelet.

## Adatmodell

Nincs tervezett migráció. A küldési választás az adott művelet része; a már meglévő munkaterületi beállítások és küldési naplók maradnak.

## Implementációs lépések

1. Közös szerveroldali feladóképzés és munkaterületi emailbeállítás-betöltés, minden email route ellenőrzése.
2. KLIMAlin Facebook-link ellenőrzése és szükséges javítása, Urbán értékelési linkek elkülönítése.
3. Köszönő email pipa a teljes lezárásnál; két külön küldési választás a gyors naptárrögzítésnél.
4. Nyilatkozat összecsukása, H tarifa eltávolítása a dokumentumfelületről.
5. Célzott regressziós tesztek, típusellenőrzés, build, mobil/asztali ellenőrzés, éles telepítés.

## Ellenőrzés

- Küldési választások minden kombinációja és újrapróbálás.
- KLIMAlin/Urbán feladó és linkek izolációja, hiányzó/üres beállítások.
- `npx tsc --noEmit`, `npm run build`, Vercel-build.
- Csukott nyilatkozat és hiányzó H tarifa panel; korábbi dokumentumok visszatöltése.

## Visszaállítás

A forrásváltozás visszavonható adatmigráció nélkül. Korábbi küldési naplókat és dokumentumokat nem módosítunk.

## Módosított fájlok és eredmény

- Elkészült a szerveroldali munkaterületi emailazonosság és a négy email route bekötése. Az Urbán üres értékelési mezői üresen maradnak.
- Elkészült a teljes lezárás köszönőemail-pipája, a naptár két külön küldési pipája, a csukott nyilatkozat és a H tarifa panel eltávolítása.
- Éles, csak olvasási adatellenőrzés: mindkét munkaterület saját feladónévvel szerepel; az Urbán három értékelési mezője üres. A KLIMAlin ellenőrzött Facebook-címe mentve, külön böngészőlapon és adatbázisból visszaellenőrizve.
- `npm test`: 750 sikeres, 5 kihagyott, 0 hibás teszt. A korábbi lezárási tesztet az új kötelező küldési paraméterhez igazítottuk.
- `npx tsc --noEmit`: sikeres. A helyi build fordítása és típusellenőrzése sikeres; az oldaladatok gyűjtése hiányzó helyi Supabase-környezet miatt megállt (`/api/h-tariff/pdf`). A teljes éles build eredménye a kapcsolódó PR-ban követhető.
- Valódi komponensek helyi előnézete szintetikus adatokkal: mobil (390 px) és asztali (1440 px) megjelenés ellenőrizve; kikapcsolt pipák helyi mentési értéke helyes; a nyilatkozat csukva indul és nyitható. Nincs vízszintes túlcsordulás a mobil munkaoldalon.
- Nincs migráció vagy új környezeti változó. Nem készült éles email vagy bizonylat, meglévő dokumentum nem változott.

Forrásfájlok: `src/lib/alinflow/email-identity.ts`, `workspace-settings.ts`, `calendar-email-delivery.ts`; a négy `src/app/api/send-*` email route; `src/app/page.tsx`; `WorkPagePanel.tsx`, `WorkReportPanel.tsx`, `WorkSectionToggleButton.tsx`. Kapcsolódó email-, naptár-, lezárási és PDF-tesztek, valamint `docs/EMAILS_AND_CALENDAR.md` és `docs/DOCUMENTS.md` frissültek.

Korlát: a Facebook régi linkjének mobil/email-hibája asztalon nem volt reprodukálható. Az új cím a Facebook saját Vélemények menüjének ellenőrzött célja; a Facebook bejelentkezési és alkalmazásmegnyitási viselkedését az AlinFlow nem szabályozza. Már elküldött emailek tartalmát a módosítás nem írja át.
