# SMS sikertelen karbantartási telefonhívás után

## Cél
A telepített klímák térképén, az ügyfél telefonos jegyzeténél és a megosztott karbantartás egyeztetésénél „Nem vette fel – SMS” művelet nyissa meg az előnézetet, majd a telefon Üzenetek alkalmazását.

## Jelenlegi működés
Az időpont-emlékeztetők már használják a telefonszám-normalizálást, az iOS/Android SMS-linket, a másolást és a GSM-7/UCS-2 részszámlálást. A megkeresésnek még nincs időpontja; az emlékeztető jövőbeli időponthoz kötött naplója erre nem használható. A megosztott egyeztetés natív dialógusban történik.

## Megváltoztathatatlan szabályok
- Egy címzett; a küldést a felhasználó hagyja jóvá a telefonon.
- A megnyitás/másolás nem jelent elküldést, és nem rögzít új telefonhívást.
- Mentett munkaterületi feladó és elérhetőség; megosztott ügyfélnél az átadó nevében történő egyeztetés egyértelmű.
- A címzettet és a hozzáférést minden előnézetnél a szerver ellenőrzi. Munkaterület- vagy ügyfélváltáskor a korábbi előnézet lezárul.
- Korábbi időpont, dokumentum, karbantartási és hívásnapló nem változik.

## Adatmodell
Nincs új tábla, mező, migráció vagy küldési napló. Az új végpont csak olvas. Tartós „Elküldtem” jelölés nem része ennek a megkeresési funkciónak.

## Implementációs lépések
1. Külön megkeresési sablon és hitelesített, csak olvasó előnézeti végpont saját és megosztott telepítéshez.
2. Natív, mobilon is használható SMS-dialógus; a meglévő SMS-segédek újrahasználata.
3. Belépési pontok a térkép gombostűjén/listáján és a telefonos jegyzeteknél.
4. Jogosultsági, szövegezési, állapotváltási és meglévő SMS/hívás/térkép regressziós tesztek, típusellenőrzés, build és vizuális ellenőrzés.

## Ellenőrzés
`npx tsc --noEmit`, `npm run build`, célzott Node-tesztek, mobil/asztali előnézet szintetikus adatokkal. Éles ügyfélnek teszt-SMS nem megy.

## Visszaállítás
A célzott forrásváltozás visszavonható; nincs visszaállítandó adatbázis-módosítás.

## Módosított fájlok
- `src/lib/alinflow/maintenance-contact-sms.ts`
- `src/app/api/maintenance-contact-sms/route.ts`
- `src/components/alinflow/MaintenanceContactSms.tsx`
- `src/app/page.tsx`
- `src/components/alinflow/MaintenanceMapPanel.tsx`
- `src/lib/alinflow/map-popup-actions.ts`
- `tests/maintenance-contact-sms.test.cjs`
- `tests/maintenance-contact-sms-ui.test.cjs`
- `tests/maintenance-contact-sms-integration.test.cjs`
- `docs/EMAILS_AND_CALENDAR.md`
- ez a terv.

## Ellenőrzés eredménye
139 célzott SMS-, hívásnapló-, megosztási és térképteszt sikeres; a végső olvashatósági javítás után a 16 SMS-felületi teszt ismét sikeres. Típusellenőrzés és production build sikeres. A build kizárólag a folyamatban megadott szintetikus Supabase URL/kulcs segítségével futott; a tesztek nem értek élő adatbázishoz.

375 és 390 px mobil-, valamint 1440 px asztali előnézet ellenőrizve, világos/sötét témával. A megosztott egyeztetés natív dialógusa fölött is működik. A telefonos hivatkozás iOS/iPad/Android formátuma tesztelt; a tényleges natív Üzenetek-átadás végső ellenőrzése a felhasználó telefonján történik. Éles ügyfélnek teszt-SMS nem ment.

Nincs migráció, új környezeti változó, időpont-/dokumentummódosítás, új gyökér `app/` vagy `page.tsx`.
