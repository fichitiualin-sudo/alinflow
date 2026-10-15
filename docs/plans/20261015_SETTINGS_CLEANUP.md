# Beállítások áttekinthető rendezése

## Cél
Egyetlen, mobilon is használható beállításoldal, témák szerint lenyitható részekkel és egyszer megjelenő szerkesztőkkel.

## Jelenlegi működés
A hosszú oldal elején két naptárblokk, később cím nélküli cégadatok, szétszórt email- és láblécmezők látszanak. A külön jogi szerepek teljes űrlapjai egymás alatt ismétlődnek. A jobb oldali magyarázat fejlesztői részleteket tartalmaz.

## Megváltoztathatatlan szabályok
- Minden mentett mező, lábléc és külön vállalkozás megmarad; nincs automatikus adatösszevonás.
- A tájékoztató, a partner kiválasztása és a tényleges hozzáférés külön művelet marad.
- Megosztáshoz kizárólag a mentett partner használható; partnercsere után új megerősítés szükséges.
- A korábbi aláírt dokumentumok, kapcsolatok, számlázók és naptáresemények változatlanok.

## Adatmodell
Nincs új mező, migráció vagy környezeti változó. A felhasználó külön kérésére Attila meglévő tájékoztató-beállítása kitöltendő és aktiválandó, privát mentéssel és a karbantartási dokumentum ellenőrzésével.

## Implementációs lépések
1. Cégadatok, naptár, ajánlat, email/dokumentum, számlázás és adatkezelés egységes szakaszokban.
2. Naptármódok egy helyen; emailfeladó és láblécek logikus csoportosítása.
3. Jogi vállalkozások és hosszú adatkezelési szövegek összecsukható szerkesztői.
4. Egy mentési sáv, látható validáció, partnerhez kötött megerősítési állapot.
5. Célzott regressziók, mobil/asztali ellenőrzés, típusellenőrzés és build, ellenőrzött kiadás.

## Ellenőrzés
- Minden szerkesztő egyszer szerepel; nyitás/csukás nem módosít adatot.
- Egy mező mentése megőrzi az összes többit, beleértve a korábbi ajánlatláblécet.
- Mentetlen partner nem használható megosztáshoz; mentett partner cseréje törli az előző megerősítést.
- `npx tsc --noEmit`, `npm run build`, célzott tesztek, mobil és asztali megjelenítés.

### Elvégzett ellenőrzések
- Típusellenőrzés és helyi production build sikeres; a helyi build kizárólag fordítási Supabase-helyőrzőkkel futott.
- 58 célzott beállítás-, adatkezelési, megosztási és naptárteszt sikeres.
- Az önálló böngészőpróba szintetikus adatokon igazolja a lenyitást és a mentést, a külön jogi szerepek és a korábbi ajánlatlábléc megőrzésével.
- Nincs gyökérszintű `app/` és nincs új `page.tsx`; a három UI-fájl whitespace-ellenőrzése sikeres.
- A külön kért munkaterületi tájékoztató hiányzó szövegeinek mentése és aktiválása privát biztonsági mentés után megtörtént. A karbantartási dokumentum validációja és a szerver hozzáférési előfeltétele is sikeres; tényleges megosztási jogosultságot ez nem változtatott.

## Visszaállítás
Az előző alkalmazáskiadás visszaállítható adatmigráció nélkül. Attila konfigurációjának előző állapota privát mentésből célzottan helyreállítható.

## Módosított fájlok
- `src/components/alinflow/SettingsPanel.tsx`
- `src/components/alinflow/PrivacyNoticeSettings.tsx`
- `src/components/alinflow/GoogleCalendarSettingsPanel.tsx`
- `tests/settings-layout.test.cjs`
- Ez a végrehajtási terv.
