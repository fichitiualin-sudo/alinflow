# Telepítési lezárás, készülékazonosítás és PDF-dokumentumok

## Cél
1. Sikeres teljes telepítési lezárás után automatikusan menjen ki a köszönő email, ismételt kattintáskor ne legyen duplikátum.
2. A Facebook értékelési hivatkozás a KLIMAlin megfelelő oldalára vezessen.
3. Külön adattábla-/sorozatszámfotók legyenek az időponthoz tartozó konkrét készülékekhez; a felismert S/N ellenőrizhető és menthető legyen a készüléknél.
4. A dokumentumok között az érintett elosztó H tarifás nyomtatványa legyen előállítható az ügyfél és az összes készülék mentett adataival.
5. A munkalap és a vásárlási nyilatkozat valódi PDF-csatolmányként legyen elküldhető.

## Jelenlegi működés
A page.tsx kezeli a lezárást és a dokumentumtárat. A köszönő email kézi művelet; az email-route-ok meglévő Supabase tagságot és ügyfél-/időpont-hatókört ellenőriznek. A munkafotók a munkaterülethez, ügyfélhez és időponthoz kötöttek, jelenleg nincs készülékenkénti azonosító vagy sorozatszám. A munkalap és a nyilatkozat aláírása külön rekordban marad.

## Megváltoztathatatlan szabályok
- A korábbi dokumentumok, aláírások, időpontok és fotók megmaradnak.
- Csak a sikeresen mentett telepítési teljes lezárás indít köszönő emailt; karbantartás, felmérés és régi lezárt rekord betöltése nem.
- A sikertelen küldés látható és újrapróbálható; nem jelentünk hamis sikert és nem küldünk tesztemailt valódi ügyfélnek.
- Minden új adat és művelet a meglévő munkaterülethez és pontos időponthoz kötött.
- OCR-eredmény nem írhatja felül észrevétlenül a mentett sorozatszámot; a felhasználó ellenőrzi a javaslatot.
- Műszaki és személyes adatot nem találunk ki. A hiányzó H tarifás mezők egyértelműen javíthatók; szükséges aláírást nem generálunk.
- PDF-ben ténylegesen a megfelelő, mentett és aláírt dokumentum küldhető, magyar ékezetekkel.

## Adatmodell és források
Az `appointment_devices` egyedi `(appointment_id, product_key, unit_number)` kulccsal különíti el az azonos típusú fizikai készülékeket. A fotók kompozit idegen kulcsa ugyanahhoz a munkaterülethez, ügyfélhez és telepítéshez köt. A készülék- és H tarifás adatmentés szerveroldali időbélyeggel ellenőrzi a párhuzamos szerkesztést.

A köszönő email tartós küldési naplója és két szűk RPC-je biztosítja a duplikációvédelmet. Az email tartalma és szolgáltatói kulcsa a bizonytalan eredményű újrapróbálások során változatlan; a Resend megőrzési idején túl kézi ellenőrzés szükséges. A kliens kizárólag a sikeres teljes lezárás után indítja; a szerver maga is ellenőrzi a mentett státuszt.

A H tarifa választható, ellenőrzött E.ON/ELMŰ és MVM Démász hivatalos formát használ. Az elosztó nincs automatikusan előválasztva. Részletes források: [H_TARIFF_FORMS.md](H_TARIFF_FORMS.md). A PDF-küldés mentett munkalap- és nyilatkozat-azonosítókra támaszkodik, a megfelelő saját aláírással.

## Implementációs lépések
1. Párhuzamos, célzott feltárás: email/értékelési link; PDF-csatolmány; H tarifa; készülékfotó és OCR.
2. Az új adatkapcsolatok és szükséges migrációk véglegesítése, mentési/betöltési útvonalak kialakítása.
3. Email-automatizálás, ellenőrzött értékelési link és PDF-csatolmányok.
4. Készülékenkénti azonosítás, adattábla-fotók és javítható OCR-javaslat.
5. H tarifás generálás a dokumentumtárban, hiányzó adatok szerkesztésével.
6. Integráció, regressziós tesztek, PDF vizuális ellenőrzés, mobil/asztali próba, mentés, migráció és éles kiadás.

## Ellenőrzés
- npx tsc --noEmit és npm run build.
- Célzott tesztek lezárás/küldés/duplikáció/hiba, scope-védelem, fotókapcsolat, OCR-feldolgozás, PDF-tartalom és aláírásmegőrzés.
- Idempotens migrációk helyi SQL-próbája és meglévő rekordok megőrzése.
- Több azonos típusú klíma és ismétlődő karbantartás nem keveredik.
- A PDF-ek vizuális ellenőrzése, több készülék és hosszú szöveg esetén is.
- Valódi címzettnek próbaüzenet nem megy ki; éles adatot nem törlünk a tesztekhez.

## Visszaállítás
A kód az előző kiadásra visszaállítható. Az additív adatokat visszaállítás közben megőrizzük; kiküldött emailt és aláírt dokumentumot nem módosítunk utólag.

## Módosított fájlok, eredmények és nyitott kérdések

- Implementáció és független review elkészült mind az öt részhez.
- `npx tsc --noEmit`: sikeres. `npm run build`: sikeres, a font és a két hivatalos sablon a szerver deployment trace-ben ellenőrizve.
- `npm test`: 225 sikeres, 2 korábbi natív PostgreSQL-restore ellenőrzés környezeti okból kihagyva; nincs bukás. A PGlite útvonala a helyi tesztfuttatásban megadva.
- Új külön SQL-próbák: 18 készülék-/fotó-/H tarifa- és 17 köszönőemail-ellenőrzés sikeres. LF/CRLF ismételhetőség, régi adatmegőrzés, aktív tagság, pontos scope, fotótörlés és bizonytalan email-újrapróbálás lefedve.
- Böngészőben 390 és 1366 képpontos nézet ellenőrizve, nincs vízszintes túlcsordulás. Szintetikus adattáblán valódi OCR: `TESTABC012345`; kiválasztás, mentés és újratöltés a megfelelő beltéri készülékhez tartotta a számot. H tarifa hiányzóadat-jelzése és a PDF emailgombok ellenőrizve.
- Magyar ékezetes, külön aláírású munkalap/nyilatkozat és hosszú munkalap PDF renderelve. Mindkét H formán több készülék, összes eredeti oldal, mezőfa, widgetek és látható kitöltés ellenőrizve.
- Élő migráció előtt 20 public tábla 3981 sorának és a Storage metaadatainak mentése: Downloads `Supabase Snippet Untitled query (3).csv`, SHA256 `C6DE15CD9F04240E9EC75814743013885A2DA75B86A8CC1AB095CCE4B1C5E20C`. Nem tartalmazza a Storage képfájlok bináris másolatát; ezeket a migráció nem módosítja.
- Teljes sémaaudit függvény-/triggerdefiníciókkal: Downloads `Supabase Snippet Untitled query (4).csv`, SHA256 `9BD3BDF8CFEA99AB411411A0EBF4B5DC00774DAEAFB6017E6E0EF9AEE7F7536E`. A két mentés személyes adatai a repón kívül maradnak.
- Kiadás előtti alapállapot: 598 ügyfél, 781 időpont, 513 dokumentum, 113 munkalap, 70 vásárlási nyilatkozat, 7 munkafotó és 7 Storage objektum. A három új tábla és három új függvénynév szabad.
- Éles migráció: mindkét új SQL sikeresen lefutott, majd másodszor is. Az utóellenőrzésben minden fenti régi sorszám változatlan; a három új tábla üres. RLS és scope-triggerek aktívak, a kompozit fotó-FK érvényes. Anonim készülékolvasás/email-RPC és közvetlen küldésinapló-olvasás tiltott. Próbaemail nem ment ki.
- Kiadás: `codex/installation-documents-and-device-photos` ág. A merge és az éles Vercel-készültség a GitHub PR ellenőrzéseiben követhető; a kész éles felületet a kiadás után csak olvasással ellenőrizzük.
- Korábbi fotó-SQL regressziók: 42 alap- és 20 törlési próba is sikeres.

Más elosztó (például MVM Émász) nyomtatványának támogatásához annak pontos formája szükséges. A felhasználó elosztóválasztását a felület kezeli; ellenőrizetlen nyomtatványt nem nevez át megfelelőnek.

## Fájljegyzék

- [docs/DATA_MODEL.md](../docs/DATA_MODEL.md)
- [docs/DOCUMENTS.md](../docs/DOCUMENTS.md)
- [docs/EMAILS_AND_CALENDAR.md](../docs/EMAILS_AND_CALENDAR.md)
- [docs/H_TARIFF_FORMS.md](../docs/H_TARIFF_FORMS.md)
- [docs/INSTALLATION_COMPLETION_PLAN.md](../docs/INSTALLATION_COMPLETION_PLAN.md)
- [docs/sql/APPOINTMENT_DEVICES.sql](../docs/sql/APPOINTMENT_DEVICES.sql)
- [docs/sql/INSTALLATION_THANK_YOU.sql](../docs/sql/INSTALLATION_THANK_YOU.sql)
- [next.config.ts](../next.config.ts)
- [package-lock.json](../package-lock.json)
- [package.json](../package.json)
- [public/forms/h-tariff/eon-25-htb-1-2.pdf](../public/forms/h-tariff/eon-25-htb-1-2.pdf)
- [public/forms/h-tariff/mvm-aszab-10-ny03.pdf](../public/forms/h-tariff/mvm-aszab-10-ny03.pdf)
- [src/app/api/h-tariff/pdf/route.ts](../src/app/api/h-tariff/pdf/route.ts)
- [src/app/api/send-thank-you/route.ts](../src/app/api/send-thank-you/route.ts)
- [src/app/api/send-work-report/route.ts](../src/app/api/send-work-report/route.ts)
- [src/app/page.tsx](../src/app/page.tsx)
- [src/components/alinflow/AppointmentDevicesPanel.tsx](../src/components/alinflow/AppointmentDevicesPanel.tsx)
- [src/components/alinflow/DocumentCards.tsx](../src/components/alinflow/DocumentCards.tsx)
- [src/components/alinflow/HTariffPanel.tsx](../src/components/alinflow/HTariffPanel.tsx)
- [src/components/alinflow/WorkPagePanel.tsx](../src/components/alinflow/WorkPagePanel.tsx)
- [src/components/alinflow/WorkPhotosPanel.tsx](../src/components/alinflow/WorkPhotosPanel.tsx)
- [src/components/alinflow/WorkReportPanel.tsx](../src/components/alinflow/WorkReportPanel.tsx)
- [src/lib/alinflow/appointment-devices.ts](../src/lib/alinflow/appointment-devices.ts)
- [src/lib/alinflow/document-pdf-data.ts](../src/lib/alinflow/document-pdf-data.ts)
- [src/lib/alinflow/document-pdf-render.ts](../src/lib/alinflow/document-pdf-render.ts)
- [src/lib/alinflow/document-pdf.ts](../src/lib/alinflow/document-pdf.ts)
- [src/lib/alinflow/h-tariff-pdf.ts](../src/lib/alinflow/h-tariff-pdf.ts)
- [src/lib/alinflow/h-tariff-store.ts](../src/lib/alinflow/h-tariff-store.ts)
- [src/lib/alinflow/h-tariff.ts](../src/lib/alinflow/h-tariff.ts)
- [src/lib/alinflow/pdf-fonts/DejaVuSans.ttf](../src/lib/alinflow/pdf-fonts/DejaVuSans.ttf)
- [src/lib/alinflow/pdf-fonts/LICENSE.txt](../src/lib/alinflow/pdf-fonts/LICENSE.txt)
- [src/lib/alinflow/pdf-fonts/README.md](../src/lib/alinflow/pdf-fonts/README.md)
- [src/lib/alinflow/serial-recognition.ts](../src/lib/alinflow/serial-recognition.ts)
- [src/lib/alinflow/thank-you-delivery.ts](../src/lib/alinflow/thank-you-delivery.ts)
- [src/lib/alinflow/types.ts](../src/lib/alinflow/types.ts)
- [src/lib/alinflow/work-photos.ts](../src/lib/alinflow/work-photos.ts)
- [tests/api-auth.test.cjs](../tests/api-auth.test.cjs)
- [tests/appointment-devices-sql.test.mjs](../tests/appointment-devices-sql.test.mjs)
- [tests/appointment-devices.test.cjs](../tests/appointment-devices.test.cjs)
- [tests/document-pdf-fixtures.cjs](../tests/document-pdf-fixtures.cjs)
- [tests/document-pdf.test.cjs](../tests/document-pdf.test.cjs)
- [tests/h-tariff.test.cjs](../tests/h-tariff.test.cjs)
- [tests/installation-completion.test.cjs](../tests/installation-completion.test.cjs)
- [tests/installation-thank-you-sql.test.mjs](../tests/installation-thank-you-sql.test.mjs)
- [tests/serial-recognition.test.cjs](../tests/serial-recognition.test.cjs)
- [tests/thank-you-delivery.test.cjs](../tests/thank-you-delivery.test.cjs)
- [tests/work-photos.test.cjs](../tests/work-photos.test.cjs)
