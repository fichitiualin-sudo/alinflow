# Műveleti visszajelzések és továbbhaladás ellenőrzése

## Cél
Minden mentés és küldés látható folyamat-, siker- vagy hibajelzést adjon; a képernyőváltás csak a szükséges mentés után történjen. Elsődleges hiba az ajánlatküldés láthatatlan eredménye.

## Jelenlegi működés
A központi `page.tsx` üzeneteit csak néhány panel rajzolja ki. Az ajánlat-, ügyfél- és raktárnézetben több eredmény láthatatlan. Az ajánlat megnyitása elküldött státuszt állíthat, újraküldése pedig későbbi munkastátuszt írhat felül. Egyes mentések nem védettek ismételt kattintás ellen.

## Megváltoztathatatlan szabályok
- Korábbi munkák, dokumentumok, időpontok és munkaterületi jogosultságok megmaradnak.
- Ellenőrzés során valódi ügyfélnek nem küldünk levelet, nem állítunk ki számlát.
- Sikeres szolgáltatói levélelfogadás utáni naplózási hibát külön jelzünk; nem állítjuk sikertelennek és nem ismételjük automatikusan a küldést.
- Sikertelen mentés után a szerkesztett adatok és a kiinduló képernyő maradnak.

## Adatmodell
Nincs tervezett adatbázis-módosítás vagy migráció.

## Implementációs lépések
1. Fő és kiegészítő műveletek, visszajelzések és célképernyők feltérképezése.
2. Egységes, minden nézeten látható és akadálymentes visszajelzés; mentési/küldési gombok védelme.
3. Ajánlatküldés, részleges sikerek, státuszmegőrzés és hibás továbbhaladás célzott javítása.
4. Email API-válaszok és időtúllépés ellenőrzése, szimulált szolgáltatóval tesztelve.
5. Regressziós tesztek, típusellenőrzés, build és mobil/asztali felületi ellenőrzés.

## Ellenőrzés
- Mesterséges adatos siker/hiba/részleges siker és ismételt kattintás tesztek.
- `npx tsc --noEmit`
- `npm run build`
- `npm test`
- Nincs gyökér `app/`, új oldalduplikáció, titok vagy személyes tesztadat.

## Visszaállítás
A célzott kódmódosítás visszavonható; nincs adatmigráció vagy üzleti adatot módosító teszt.

## Módosított fájlok és lezárás
A javítás egységes, nézetváltáskor is megmaradó visszajelzést vezet be. Az ajánlat megnyitása nem állít elküldött státuszt; a küldés nem lépteti vissza a lefoglalt vagy lezárt munkát. A mentési és küldési hibák megőrzik a szerkesztést. A visszalépés a helyes előző nézetet nyitja, a kész műveletek lezárják a befejezett űrlapokat.

A szolgáltató által elfogadott email vagy elkészült számla utáni adatbázishiba külön figyelmeztetés. Az adott nyitott alkalmazásban a következő próbálkozás csak a hiányzó naplózást/ellenőrzőlistát fejezi be. A lemondás előbb a tényleges időpontot módosítja, aztán naplóz. A raktári gombok a válaszig nem ismételhetők.

### Tényleges fájlkör

- `docs/ACTION_FEEDBACK_PLAN.md`
- `src/app/api/send-appointment/route.ts`
- `src/app/api/send-quote/route.ts`
- `src/app/api/send-work-report/route.ts`
- `src/app/page.tsx`
- `src/components/alinflow/ActionFeedback.tsx`
- `src/components/alinflow/CustomerPanels.tsx`
- `src/components/alinflow/LayoutPrimitives.tsx`
- `src/components/alinflow/LeadPanel.tsx`
- `src/components/alinflow/QuoteBuilderPanel.tsx`
- `src/components/alinflow/QuotePreviewPanel.tsx`
- `src/components/alinflow/SchedulePanel.tsx`
- `src/components/alinflow/SettingsPanel.tsx`
- `src/components/alinflow/WarehousePanel.tsx`
- `src/components/alinflow/WorkPagePanel.tsx`
- `src/components/alinflow/WorkReportPanel.tsx`
- `src/lib/alinflow/action-feedback.ts`
- `src/lib/alinflow/email-provider.ts`
- `tests/action-cancellation.test.cjs`
- `tests/action-feedback.test.cjs`
- `tests/action-invoice.test.cjs`
- `tests/action-navigation.test.cjs`
- `tests/action-outcomes.test.cjs`
- `tests/action-work-report.test.cjs`
- `tests/api-auth.test.cjs`
- `tests/calendar-email-flow.test.cjs`
- `tests/email-provider.test.cjs`
- `tests/installation-completion.test.cjs`
- `tests/inventory-purchase-prices-panel.test.cjs`
- `tests/regression.test.cjs`
- `tests/warehouse-operations.test.cjs`

### Ellenőrzési eredmények és korlátok

- Teljes tesztcsomag: 594 esetből 590 sikeres, 0 hibás, 4 kihagyott. A négy adatbázis-integrációs csoport külön helyi PostgreSQL/PGlite környezetet igényel, amely ezen a gépen nincs megadva.
- TypeScript-ellenőrzés sikeres.
- A normál helyi build a hiányzó Supabase URL miatt állt meg. Nem titkos, kizárólag build-ellenőrzésre szolgáló Supabase tesztértékekkel a production build sikeres; ez nem igazol élő Supabase-kapcsolatot.
- A tényleges visszajelző és ajánlatszerkesztő komponensek helyi böngészős ellenőrzése sikeres asztali és 390×844 mobilnézetben: folyamatjelzés, tiltott küldés/szerkesztés/Vissza, siker, hiba, részleges siker, nézetváltáskor megmaradó üzenet és bezárás. A mobilnézet nem lóg ki vízszintesen. A kizárólag szintetikus adatot használó ideiglenes próbaoldal eltávolítva.
- Nincs új gyökérszintű app mappa vagy duplikált oldal. Nincs adatbázis-migráció, titok vagy valós személyes tesztadat.
- A kézi email- és számlanyugták memóriában élnek: oldalfrissítés vagy kijelentkezés után az újrapróbálás előtt a szolgáltatói/alkalmazási naplót kell ellenőrizni. Bizonytalan hálózati eredménynél nincs automatikus újraküldés.
- Valódi emailküldés, számlakiállítás és ügyféladat-módosítás nem történt tesztelésként. A tényleges postaládába érkezést és a külső szolgáltatók teljes élő folyamatát ez az ellenőrzés nem igazolja.

## Műveleti és navigációs mátrix

Az alábbi táblázatok a forráskód átnézése alapján rögzítik az ellenőrzendő szerződést. A központi műveleti visszajelzés minden nézeten megjelenik; a fotók, készülékadatok, H tarifa, beszerzési árak és importok részletes állapotai helyben is láthatók. A „marad” azt jelenti, hogy az adott művelet nem vált másik alkalmazásnézetre. A részleges siker nem azonos a teljes mentési vagy küldési hibával, és nem indokol automatikus újraküldést.

### Ügyfél, ajánlat és időpont

| Művelet / fő függvény | Siker után | Hiba esetén | Részleges siker kezelése |
| --- | --- | --- | --- |
| Ügyfél mentése (`saveCustomerOnly`) | Vissza a megnyitás előtti menübe; a feladatszűrő megmarad. | Az ügyfélűrlap és a beírt értékek maradnak. | A már elmentett ügyféladat és a későbbi kapcsolt rekord hibája különbözzön a teljes mentési hibától. |
| Ügyfél mentése, Ajánlat / Időpont (`saveCustomer`) | Ajánlatszerkesztő; az ajánlat megnyitása önmagában nem jelent emailküldést. | Ügyfélűrlap marad. | Korábban sikeres rekordmentést ne mutasson elküldött ajánlatként. |
| Ügyfél mentése, felmérési időpont (`saveCustomerAndScheduleSurvey`) | Időpontválasztó, felmérés típussal. | Ügyfélűrlap marad. | A felméréshez nem szükséges klímatétel és nem szabad meglévő telepítési dokumentumot felülírni. |
| Munkaoldali ügyféladatok mentése (`saveCustomerData`) | Munkaoldal, a szerkesztés bezárul. | A szerkesztő marad nyitva, az értékek megmaradnak. | Más munkához tartozó ajánlat és dokumentum nem változhat. |
| Ügyfél törlése (`deleteCustomer`) | Megnyitott ügyfélnél vissza az előző menübe; listaműveletnél ugyanaz a lista. | A rekord és az aktuális nézet marad; a törlési ok látható. | A törlés fotómegőrzést ellenőrző tranzakció; elutasításkor nem törölhető előre a dokumentumtár. |
| Telefonhívás indításának naplózása (`recordCustomerPhoneCall`) | Az alkalmazásnézet marad, külső telefonkezelő nyílik. | A hívás és a naplózás eredményét külön kell kezelni. | A napló nem igazolja a hívás létrejöttét vagy befejezését. |
| Ajánlat email (`sendQuoteEmail`) | Ajánlatszerkesztő / előnézet marad, látható küldési eredménnyel. | Ugyanott marad, az ajánlat szerkeszthető és újrapróbálható. | Szolgáltatói elfogadás után naplózási hiba: „elküldve, állapot mentése nem sikerült”; a levelet nem küldi újra automatikusan. Meglévő időpont / lezárt munka státusza megmarad. |
| Új időpont (`saveSchedule`) | Főoldal; az időpont a naptárban megjelenik. | Időpontválasztó és kitöltött adatok maradnak. | A mentett időpontot megtartja, ha csak a napló / karbantartási kapcsolat / email hibázik; pontosan jelzi a sikertelen második lépést. |
| Időpont módosítása (`saveSchedule`) | A módosított munka oldala. | Időpontválasztó marad. | Az email hibája nem változtatja vissza a sikeresen elmentett időpontot. |
| Naptár gyors időpont (`saveQuickAppointment`) | A naptár marad; sikeres mentés után a létrehozó űrlap bezárul és az emaileredmény jelenik meg. | Mentés előtt az űrlap marad. | Már mentett időpont után nem nyithat újra létrehozást; a későbbi hibát a mentett időponthoz kapcsolva jelzi. |
| Naptár ajánlat + időpont email / újrapróbálás (`sendQuickAppointmentEmail`) | Naptár és a levelek külön eredménye marad. | Levelekre bontott hibajelzés marad. | A sikeres levelet nem küldi újra; külön megmarad a küldési és a naplózási állapot. |
| Időpont email külön küldése (`sendAppointmentEmailFor`) | Az indító nézet marad. | Az indító nézet marad, érthető küldési hibával. | Elküldött, de nem naplózott levél figyelmeztetés; nem teljes küldési hiba. |
| Archivált ügyfél visszaállítása (`restoreArchivedCustomer`) | Időpontos ügyfél: munkaoldal; időpont nélküli: ügyfélűrlap. | Archív lista marad, látható hibával. | Csak sikeres mentés után kerülhet ki az archív listából. |

### Munkavégzés és dokumentumok

| Művelet / fő függvény | Siker után | Hiba esetén | Részleges siker kezelése |
| --- | --- | --- | --- |
| Időponthoz tartozó klímák és anyagok mentése (`saveWorkChanges`) | Munkaoldal; az engedélyezett módosítási mód bezárul. | Munkaoldal és a szerkesztett tételek maradnak. | A korábbi készletlevonás és a kapcsolt dokumentumok nem írhatók felül véletlenül. |
| Ellenőrzőlista / NKVH jelölés (`toggleChecklist`, `setChecklistItem`) | Munkaoldal; mentett jelölés és dátum látszik. | Munkaoldal és korábbi mentett pipa marad. | Sikertelen mentést nem szabad kész jelölésként megjeleníteni. |
| Kézi számlázás készre jelölése (`markManualInvoice`) | Munkaoldal, ellenőrzőlista frissítve. | Munkaoldal marad. | A jelölés nem állít ki számlát és nem igazol emailküldést. |
| Számla létrehozása (`createInvoice`) | Munkaoldal; számlaszám és emaileredmény látható. | Munkaoldal marad, a szolgáltatói hiba elkülönül. | Kiállított számla után checklist-hiba: a számla elkészült; nem szabad új kiállítást javasolni. |
| Felmérés kész (`markInstallationDone`, felmérés) | Ajánlatszerkesztő. | Munkaoldal marad. | A mentett befejezést és a naplózási hibát külön kell jelezni. |
| Szerelés kész (`markInstallationDone`, telepítés) | Munkaoldal, adminisztrációs lezárás folytatható. | Munkaoldal marad. | Készletlevonás csak egyszer történhet; ismételt kattintás nem indíthat párhuzamos lezárást. |
| Karbantartás lezárása (`markInstallationDone`, karbantartás) | Az adott munka oldala, lezárt állapottal. | Munkaoldal marad; aláírt munkalap hiánya külön jelzés. | Az eredeti telepítés, korábbi karbantartások és dokumentumok megmaradnak. |
| Teljes telepítési lezárás (`closeWork`) | Vissza a megnyitás előtti menübe; automatikus köszönő email indul. | Lezárási hiba esetén munkaoldal marad. | A lezárt telepítés emailhiba esetén is lezárt marad; a köszönő levél újrapróbálása a Dokumentumokból elérhető. |
| Szerelési / felmérési időpont lemondása (`cancelAppointment`) | Vissza a megnyitás előtti menübe. | Munkaoldal marad, a foglalás csak igazolt lemondás után szabadul fel. | A lemondási állapot és a kapcsolt rekordok eltérő eredményét külön kell jelezni. |
| Karbantartási időpont lemondása (`cancelAppointment`) | A korábbi telepítés munkaoldala, ha elérhető; az ügyfél megmarad. | Az adott munka oldala marad. | A lemondási napló nem készülhet sikeresként a lemondási tranzakció előtt; csak az adott karbantartás mondható le. |
| Munkalap / vásárlási nyilatkozat mentése (`saveWorkReport`) | Munkaoldal, a lezárási műveletekhez görgetve. | A dokumentumszerkesztő és az aláírás marad. | A mentett dokumentumot nem kell újra létrehozni csak a későbbi napló / checklist hibája miatt. |
| Munkalap mentése és PDF-email (`saveWorkReport(true)`) | Siker esetén munkaoldal, a küldés eredményével. | Mentési hiba: dokumentumszerkesztő; küldési hiba: a mentett dokumentum megmarad. | Mentett, de el nem küldött; elküldött, de nem naplózott állapotok különüljenek el. |
| Mentett munkalap / nyilatkozat PDF-email (`sendSavedWorkDocuments`) | Az indító dokumentum- vagy munkaoldal marad. | Ugyanott marad. | Elfogadott levél után állapotmentési hiba külön figyelmeztetés, automatikus újraküldés nélkül. |
| Köszönő email (`sendThankYouEmailFor`) | Az indító nézet marad; automatikus futásnál a lezárás utáni menü. | A telepítés lezárását nem vonja vissza. | A már elküldött levél külön jelzést kap; a szerver egyszeri kézbesítést kezel. |
| Eladó cég mentése (`addSellerCompany`) | Dokumentumszerkesztő marad, mentett eladó kiválasztható. | Dokumentumszerkesztő marad, kitöltés nem vész el. | A céglista mentése nem készít automatikusan aláírt nyilatkozatot. |
| Munkafotó feltöltése / újrapróbálása | Munkaoldal marad; képenként tömörítés, feltöltés és mentett állapot. | Sikertelen képenként hiba és újrapróbálás. | Sikeres képek megmaradnak; csak sikertelen tételek próbálhatók újra. Galériabetöltési hiba nem minősíti hibásnak a feltöltést. |
| Munkafotó törlése | Munkaoldal marad; törölt kép eltűnik, galéria frissül. | A kép és a törlési megerősítés marad, helyi hibával. | A sikeres törlés utáni galériafrissítési hiba külön betöltési hiba. |
| Adattábla felismerése / javaslat választása | Készülékszerkesztő marad; felismerési eredmény ellenőrizhető. | Helyi letöltési / felismerési hiba; kézi kitöltés lehetséges. | Ez csak szerkesztési javaslat; nem szabad elmentett adatnak jelezni a külön mentés előtt. |
| Készülékadatok mentése | Munkaoldal és a készülék marad, helyi mentési eredménnyel. | A szerkesztett adatok maradnak. | Felismerés és mentés nem futhat párhuzamosan ugyanazon készüléken. |
| H tarifás adatok mentése / PDF | Munkaoldal marad; PDF a böngésző letöltésében nyílik. | Helyi hiba, a megadott adatok maradnak. | Mentett adatok mellett hiányos PDF-mezők: „adatok elmentve, a PDF-hez pótold”; nem teljes mentési hiba. |

### Raktár, beállítások, importok és kiegészítő műveletek

| Művelet | Siker után | Hiba esetén | Részleges siker / védelem |
| --- | --- | --- | --- |
| Klíma hozzáadása / ár és név mentése / archiválása | Raktár marad, terméklista és visszajelzés frissül. | Raktár és szerkesztett értékek maradnak. | Archiválás csak az aktív kínálatot módosítja, korábbi ajánlatokat nem. |
| KLIMAlin-katalógus szinkronizálása | Raktár marad, frissített tételek száma látszik. | Raktár marad, pontos hiba jelenik meg. | Kézi termékek és raktárkészlet megmaradnak. |
| Klíma- / anyagkészlet módosítása | Raktár marad, friss készletszám és központi eredmény látszik. | Raktár marad; hibás / nulla bevitelnél nincs kérés. | Egy gombnyomás alatt egy delta; a mező és gomb a válaszig tiltott. |
| Új szerelési anyag | Raktár marad, új tétel megjelenik; űrlap csak siker után ürül. | A kitöltött űrlap marad. | Elutasított vagy hibás mentés nem jeleníthet „hozzáadva” üzenetet. |
| Beszerzési ár mentése | Raktár marad, adott szerkesztő bezárul és bruttó ár frissül. | Szerkesztő marad; betöltési hiba mellett mentés tiltott. | Belső ár nem kerülhet ügyféldokumentumba; munkaterületváltás utáni késői válasz nem alkalmazható. |
| Munkaterületi beállítások mentése | Beállítások marad, látható sikerüzenettel. | Beállítások és szerkesztett értékek maradnak; a gomb újra használható. | Mentés közben új mezőmódosítást a késői válasz nem írhat felül. |
| CSV-import | Főoldal marad; importált darabszám és friss ügyféllista. | Előnézet marad, látható hiba. | Import közben új fájl kiválasztása tiltott; többszörös kattintás nem hozhat duplikált ügyfelet. |
| Facebook korábbi leadek beolvasása / folytatása | Főoldal és napló marad; új, ismételt és ellenőrizendő darabszám külön látszik. | Napló marad, hiba vagy megállítási állapot. | A már beolvasott oldalak megmaradnak; folytatható állapot és ügyféllista-frissítési hiba külön jelzés. |
| Facebook érdeklődés feldolgozottnak jelölése | Napló marad; feldolgozandó szűrőnél a sor eltűnik. | Sor marad, helyi hiba látható. | Csak a naplósor változik, az ügyfél munkastátusza nem. |
| Hiányzó térképkoordináták keresése | Térkép marad; mentett / sikertelen címek száma látszik. | Térkép és ügyféllista használható marad. | A korábban sikeresen mentett koordináták egy későbbi cím hibája miatt nem vesznek el. |
| „Nem kéri a karbantartást” jelölés | Térkép / munkaoldal marad, mentett jelöléssel. | Korábbi jelölés marad, központi hiba látható. | Csak az érintett telepítési időpont változik. |
| Excel-export / aláírt dokumentumok ZIP | Dokumentumtár marad; fájl a böngésző letöltésében. | Dokumentumtár marad, exporthiba látható. | Üres aláírt dokumentumtár külön eredmény, nem sikeres ZIP-készítés. |
| Piszkozat folytatása / elvetése | Folytatás: mentett szerkesztőnézet; elvetés: aktuális menü. | Nincs adatbázis-módosítás. | Elvetés kizárólag a helyi piszkozatot törli, ügyfelet / munkát nem. |

Az előnézet, nyomtatás, keresés, lapozás, térképválasztás, menüváltás és lenyíló rész nyitása önmagában nem üzleti adatmentés. Az „Új karbantartás” először piszkozatot és időpontválasztót nyit; adatbázisban csak a mentés hoz létre időpontot.

### Visszalépés és megszakítás – feltárt javítandó esetek

- Munkalap mentése után a `replaceView("work")` mellett a történet tetején maradhat ugyanaz a `work` nézet. A következő Vissza ekkor látszólag semmit nem csinál. Ellenőrzési példa: főoldal → munka → munkalap → mentés → Vissza; az utolsó lépésnek az előző menüre kell vinnie.
- A `returnToLastMenu` és az új időpont után végzett főoldalváltás nem hagyhatja a már befejezett űrlapokat aktív visszalépési célként. A menübe visszatérésnél a történet célhoz tartozó része lezárandó.
- Mentetlen új karbantartásból visszalépve a korábbi telepítés állapota és készülék-/anyagadatai állnak vissza; nem készül időpont és nem megy email. Ezt a `maintenanceReturnRef` külön kezeli.
- A munkaoldali ügyféladat-szerkesztés Mégse gombja a szerkesztés előtti mezőértékeket állítsa vissza. A szerkesztő puszta elrejtése nem elvetés: a `selected` állapotban maradt módosítás később más művelettel véletlenül elmentődhet.
- Karbantartás lemondásakor a lemondási dokumentum nem menthető a lemondási tranzakció előtt. Sikeres lemondás után naplózási hiba külön figyelmeztetés; sikertelen lemondás nem hagyhat kész lemondási dokumentumot.
- A nem karbantartási lemondás több mentési lépése miatt az ügyfélstátusz és az időpont eredménye eltérhet. Az ellenőrzésnek az időpont tényleges lemondását kell alapul vennie; pusztán az ügyfélsor mentése után nem mutatható teljes siker.

### Célzott másodlagos ellenőrzés eredménye

- Raktári ismételt kattintás, sikertelen mentés utáni adatmegőrzés, elutasított új anyag és újrapróbálás: 6 új regressziós eset a `tests/warehouse-operations.test.cjs` fájlban.
- A raktári műveleti, árérték- és adatvédelmi tesztek együtt: 28 sikeres eset.
- A másodlagos panelmódosítások után a TypeScript-ellenőrzés sikeres; az összesített build és a teljes tesztfuttatás a központi változtatások lezárása után szükséges.

## Kiegészítés: új ügyfél ajánlata és az első időpont

### Feltárt ok és javítás

Az új ügyfélnek még időpont nélkül küldött ajánlat naplóbejegyzése ügyfélszintű. Az első telepítési időpont létrehozása után az időpontra szűkített dokumentumlista ezt elrejtette, miközben a levél küldése és naplózása sikeres volt. A korábbi mentési útvonal külön, korábbi ajánlatpiszkozatot is hátrahagyhatott.

1. Az ajánlatszerkesztő és előnézet küldési gombja mellett az utolsó igazolt emailküldés dátuma tartósan látszik. Küldési bizonyíték nélkül nem jelenik meg elküldött állapot.
2. Új időpont mentésekor az ismert, azonos ajánlathoz tartozó küldési bejegyzés az eredeti dátummal az időpont dokumentumai közé is bekerül. Az eredeti ügyfélszintű bejegyzés megmarad; újabb ajánlatlevél nem indul.
3. A régebbi első telepítések visszatöltése kizárólag egyértelmű kapcsolat esetén jeleníti meg az eredeti ügyfélszintű küldést: pontos ajánlat/időpont-egyezés, egyetlen telepítési időpont, legfrissebb ajánlat, a küldés az ajánlat és az időpont létrehozása közötti időablakban. Korábbi, más időponthoz nem kapcsolt piszkozat megengedett; másik munka vagy bizonytalan időrend kizárja a társítást.
4. Az ajánlat létrehozási és módosítási dátuma nem helyettesíti az emailküldési dátumot. A többi dokumentumtípus időpontszűrése változatlan.

### Adatkezelés és fájlkör

A `Customer.quoteReceiptScope` kizárólag a felület által használt, visszatöltéskor újraszámított kapcsolati bizonyíték. Nincs új adatbázismező vagy migráció. A meglévő történeti eset megjelenítési javítása nem írja át az adatbázist.

- `src/app/page.tsx`
- `src/lib/alinflow/types.ts`
- `src/components/alinflow/QuoteBuilderPanel.tsx`
- `src/components/alinflow/QuotePreviewPanel.tsx`
- `src/components/alinflow/QuoteEmailStatus.tsx`
- `tests/new-customer-quote-flow.test.cjs`
- `tests/quote-email-status.test.cjs`
- `tests/calendar-email-flow.test.cjs`
- `tests/facebook-leads-client.test.cjs`
- `docs/ACTION_FEEDBACK_PLAN.md`

### Ellenőrzés

- A tényleges mentési, küldési és dokumentum-visszatöltési függvények szintetikus adatú regressziója: új ügyfél → ajánlat → küldés → friss visszatöltés → időpont → friss visszatöltés; eredeti dátum és mindkét dokumentumbejegyzés megmarad, egyszeri emailküldés.
- Külön siker, szolgáltatói hiba, küldés utáni naplózási hiba, csak naplózást újrapróbáló útvonal és történeti kettős piszkozat. Téves munkatársítás elleni negatív esetek is szerepelnek.
- A dátumjelző tényleges komponensének ellenőrzése 390×844 mobil- és asztali nézetben: olvasható, vízszintesen nem lóg ki. Hibás vagy hiányzó dátum nem jelenik meg küldési bizonyítékként.
- TypeScript és production build sikeres. A build a fent leírt nem titkos helyi Supabase tesztértékeket használta; élő adatbáziskapcsolatot nem igazol.
- Teljes tesztcsomag: 614 esetből 610 sikeres, 0 hibás, 4 kihagyott. A négy adatbázis-integrációs csoporthoz szükséges helyi környezet továbbra sincs megadva. Éles ügyfélnek tesztlevél nem ment ki, valós ügyféladatot az ellenőrzés nem módosított.
