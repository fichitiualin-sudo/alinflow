# Naptárból rögzített időpont levelei

## Cél
A naptár gyors rögzítésével mentett szerelési időpont után automatikusan két külön levél induljon: árajánlat és időpont-visszaigazolás. A felmérés és karbantartás a saját időpontlevelét kapja.

## Jelenlegi működés
A gyors rögzítés mentés után külön kérdez rá egy időpontlevélre. Az időpontküldő hibásan ajánlatküldést is naplóz, miközben nem hívja az ajánlat-email API-t. A kézi ajánlatküldő ügyfélstátuszt is módosít, ezért közvetlen újrahasználata visszaléptetné a lefoglalt munkát.

## Megváltoztathatatlan szabályok
- A mentett időpont és az „Időpont foglalva” státusz emailhiba esetén is megmarad.
- Csak sikeres szolgáltatói elfogadás után naplózható az adott levél elküldése.
- Részleges siker után a már elküldött levelet nem küldjük újra; naplózási hiba külön újrapróbálható.
- Felmérés/karbantartás nem küld új klímavásárlási ajánlatot.
- Korábbi ügyfelek, időpontok, dokumentumok nem kerülnek tömeges újraküldésre vagy átírásra.
- Teszteléskor valódi ügyfél nem kap levelet.

## Adatmodell
Nincs új adatbázismező vagy migráció. Az elküldött levelek a meglévő, időponthoz kötött dokumentumnaplót használják. Az aktuális küldési folyamat pillanatképe memóriában marad; újratöltés nem indít automatikus küldést. A naptáras emailkérések stabil műveletazonosítóval kapnak szolgáltatói duplikációvédelmet.

## Implementáció
1. Küldési folyamat két külön lépéssel, párhuzamos kattintás elleni védelemmel és részleges újrapróbálással.
2. Gyors időpontrögzítés után automatikus indítás; áttekinthető eredmény/hiba és hiányzó email jelzése.
3. Hibás ajánlatnaplózás megszüntetése az időpontlevél-küldőben; opcionális idempotenciakulcs támogatása a két meglévő API-ban.
4. Célzott regresszióteszt, típusellenőrzés, build, mobil/asztali szintetikus próba; kiadás és éles olvasási ellenőrzés.

## Visszaállítás
Kód-visszaállítás migráció nélkül. A már elküldött levelek és valós küldési naplók megmaradnak.

## Ellenőrzések és fájlok
Elkészült az automatikus naptáras kétlevél-küldés, levélenkénti eredménnyel és részleges újrapróbálással. Az ajánlat elküldött jelzése nem származhat pusztán az időpontlevélből. A mentés gomb és a küldési folyamat szinkron zárolást kapott; mentett időpont után naplóhiba nem nyitja újra az időpont létrehozását.

Módosított fájlok:
- `src/app/page.tsx`: mentés, automatikus küldés, eredményablak, valódi levélnaplók megjelenítése.
- `src/app/api/send-quote/route.ts`, `src/app/api/send-appointment/route.ts`: opcionális naptáras idempotenciakulcs és stabil levélreferencia.
- `src/lib/alinflow/calendar-email-delivery.ts`: rögzített küldési adatok, lépésenkénti eredmények és újrapróbálás.
- `src/lib/alinflow/calendar-email-idempotency.ts`: időpontjogosultsághoz kötött kulcs és újrapróbálási időablak.
- `tests/calendar-email-delivery.test.cjs`, `tests/calendar-email-idempotency.test.cjs`, `tests/calendar-email-flow.test.cjs`: küldés, jogosultság, részleges hibák és teljes naptáras folyamat tesztjei.
- `docs/EMAILS_AND_CALENDAR.md`, jelen terv: dokumentáció.

Ellenőrzések:
- `npx tsc --noEmit` és `npm run build`: sikeres.
- Teljes tesztcsomag: 469 sikeres, 2 elkülönített adatbázis-restaurálást igénylő teszt kihagyva. Az ezután hozzáadott 15 folyamat-teszttel együtt a célzott naptáras csomag 40/40 sikeres.
- Teljes alkalmazás böngészős tesztje 390 és 1366 px szélességen, mesterséges adatokkal, hálózat és valódi email tiltásával: egy mentett időpont után két külön levél; részleges hibából visszaálláskor az ajánlat nem ment újra és nem keletkezett új időpont; eredményablak túlcsordulás nélkül.
- Nincs gyökérszintű `app/` vagy duplikált főoldal; nincs migráció vagy új környezeti változó.

Korlát: az aktuális folyamat bezárása vagy lapfrissítés nem tart fenn háttérküldési sort. A már naplózott küldések visszatöltődnek; a nyitott folyamatban legfeljebb 23 óráig próbálhatók újra ugyanazzal a szolgáltatói kulccsal. A meglévő mentési RPC-k hálózati bizonytalanságának teljes tranzakciós/idempotens átalakítása nem része ennek a módosításnak. A korábbi Facebook-aktiválási dokumentumok munkapéldány-módosításai külön maradtak.
