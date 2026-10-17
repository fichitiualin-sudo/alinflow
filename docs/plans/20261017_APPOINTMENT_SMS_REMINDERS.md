# Kézi, telefonos SMS-időpontemlékeztetők

## Cél
A naptárból és az adott munka oldaláról ékezetes, személyre szabott telepítési, karbantartási és felmérési SMS nyitható meg a telefon Üzenetek alkalmazásában. A felhasználó küldi el; nincs SMS-szolgáltató, automatikus háttérküldés vagy új email. A naptári lista a holnapi, a két és a három nap múlva esedékes időpontokat külön mutatja.

## Jelenlegi működés
A CalendarPanel az appointments rekordokból összeállított Customer munkapéldányokat kapja. A WorkPagePanel az adott mentett időpontot mutatja. Kézi SMS-folyamat és küldési visszajelzés még nincs. Az eredeti checkout más feladatok módosításait tartalmazza; ez a munka az elkülönített google-contacts checkout aktuális origin/main alapjáról készül.

## Megváltoztathatatlan szabályok
- Egyórás érkezési sáv a kezdésből, a tényleges 1/3/6/9 órás foglalás nem változik.
- Csak az adott időponthoz tartozó klímák darabszáma számít; az egyéb tételek nem.
- Jóváhagyott magyar szöveg, ékezetek és az aktuális munkaterület aláírása; őszinte SMS-részszámlálás.
- Minden hivatkozás pontosan egy ellenőrzött címzettet tartalmaz; nincs csoportos küldés.
- Megnyitás, másolás és kézbesítés nem azonos az explicit felhasználói Elküldtem nyilatkozattal.
- Lemondott, befejezett, múltbeli, hibás vagy nem mentett időpont nem kaphat emlékeztetőt.
- Meglévő időpont, ügyfél, dokumentum, jogosultság és emailfolyamat nem módosul.

## Adatmodell
Új appointment_sms_receipts tábla kizárólag a felhasználó által visszaigazolt kézi küldéshez. Munkaterülethez, ügyfélhez és időponthoz kötött; tartalmi lenyomat, időpont és rögzítő felhasználó, SMS-szöveg és telefonszám nélkül. RLS és mentési ellenőrzés védi a munkaterületek közti elválasztást. A tartalmi lenyomat nem függ attól, hogy a dátum Holnap vagy konkrét nap formában jelenik meg. Az időpont vagy címzett módosítása új emlékeztetőigényt mutat.

## Implementációs lépések
1. Tiszta segédfüggvények: budapesti naptári napok, sablonok, darabszám, egyórás sáv, telefonszám, iOS/Android SMS-link, kódolás és részszám.
2. Idempotens SQL és regresszió a küldési nyilatkozat tárolására; friss mentett időpont és hozzáférés ellenőrzése.
3. Közös reszponzív előnézet és kézi megnyitás/másolás/Elküldtem folyamat. A listán és közvetlen munkaoldalon ugyanaz a komponens.
4. Kis naptári gomb és időpontművelet; megnyitáskor betöltött nyilatkozatok, háttérpolling nélkül.
5. Típusellenőrzés, célzott viselkedési és SQL-tesztek, teljes regresszió és build; asztali/mobil felület ellenőrzése.
6. Migráció alkalmazása, PR és ellenőrzött Vercel-élesítés. Valódi SMS-t nem küldünk; az iPhone natív átadása a felhasználó telefonján ellenőrizhető.

## Ellenőrzés
- npx tsc --noEmit
- npm run build
- npm test
- Célzott SQL: többször futtatható migráció; saját/idegen munkaterület; visszavont tagság; stale időpont; nincs automatikus küldés.
- UI: 1/2/3 nap, típusok és darabszám, invalid telefon, másolási hiba, workspace-váltás, mentési hiba és időpontváltozás.

## Visszaállítás
A frontend változás visszavonható. Az új nyilatkozattábla megmaradhat; meglévő adatok és dokumentumok nem változnak. Új külső környezeti változó nem szükséges.

## Módosított fájlok
- src/lib/alinflow/sms-reminders.ts – üzenetek, dátum, darabszám, telefonszám, SMS-link és hossz.
- src/lib/alinflow/sms-reminders-client.ts – előnézeti válasz típusa.
- src/app/api/sms-reminders/route.ts – hitelesített előnézet és kézi jelölés.
- src/components/alinflow/AppointmentSmsReminders.tsx – közös reszponzív előnézet.
- src/components/alinflow/CalendarPanel.tsx, WorkPagePanel.tsx és src/app/page.tsx – belépési pontok.
- docs/sql/20261017_APPOINTMENT_SMS_RECEIPTS.sql – elkülönített, csak hozzáfűzhető napló.
- tests/sms-reminders.test.cjs, sms-reminders-ui.test.cjs, sms-reminders-api.test.cjs, sms-reminders-sql.test.mjs – viselkedési és SQL-regresszió.
- tests/calendar-status-ui.test.cjs, work-page-extra-items.test.cjs, work-photo-placement.test.cjs – az új gyerekkomponens teszthelyettesítése, változatlan meglévő ellenőrzésekkel.
- docs/EMAILS_AND_CALENDAR.md és ez a terv – működés és üzembe helyezés.

## Elvégzett ellenőrzések
- 32 segédfüggvény/UI-teszt és 13 API-teszt sikeres.
- 17 SQL-ellenőrzés sikeres, beleértve az ismételt migrációt, a tagság visszavonását és a HTTP409-re forduló verzióütközést.
- npx tsc --noEmit sikeres; npm run build sikeres szintetikus publikus Supabase-konfigurációval. Az első helyi build csak a hiányzó Supabase URL miatt állt meg; éles titkot nem másoltunk a munkapéldányba.
- Éles SQL-próba ROLLBACK-kel sikeres; a migráció alkalmazva, RLS aktív, anonim hozzáférés nincs, meglévő adatok nem változtak. Az új napló üres; a jövőbeli időpontoknál nincs hiányzó mentési verzió.
- Nincs gyökér app/ vagy új page.tsx. Nincs valódi SMS-küldés vagy próbajelölés éles ügyfélen.
- A mobil SMS-URI szerkezete és kezelése tesztelt; az iPhone natív Üzenetek alkalmazásának megnyitását a felhasználó készülékén kell véglegesen kipróbálni.
- Teljes npm test: 1288 sikeres, 8 meglévő feltételes kihagyás, 0 hiba (1296 teszt).
