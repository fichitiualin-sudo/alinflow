# H tarifás dokumentumok

Hivatalos források ellenőrizve: 2026-09-14. A funkció nem állít be elosztót az ügyfél címe vagy kereskedője alapján. Jelenleg az alábbi három ellenőrzött formát lehet kiválasztani.

| Elosztó | Hivatalos nyomtatvány | Több készülék |
|---|---|---|
| E.ON / ELMŰ Hálózati | [25_HTB_1-2_DIGIT](https://www.eon.hu/content/dam/eon/eon-hungary/documents/Lakossagi/aram/letltheto-nyomtatvanyok/25_HTB_1-2_DIGIT.pdf) | Azonos pontos típust és műszaki adatokat egy lapon, darabszámmal; eltérő típust külön lapon. |
| MVM Démász | [Á-SZAB-10-NY03, 2025.05.16.](https://mvmhalozat.hu/attachments/40414), a [hivatalos nyomtatványlistán](https://mvmhalozat.hu/aram/oldalak/1803) | Minden fizikai készülékre külön lap, azonos típus esetén is. |
| MVM Émász | [M_050_01 – Hőszivattyúk jogosultságának vizsgálata kedvezményes tarifára](https://mvmemaszhalozat.hu/elmu/file/downloadfile?id=6d2b087e-92d7-40fc-a8b9-9db2b7a19677), a [Teljesítmény módosítás oldal kapcsolódó dokumentumai között](https://mvmemaszhalozat.hu/ugyintezesek/muszaki_ugyintezes/teljesitmenymodositas) | Önálló beltéri–kültéri páronként külön lap. Közös kültéri egységű multi rendszer kitöltése külön szükséges; lásd lent. |

Az E.ON 2025. novemberi módosítása miatt a korábbi 20-HTB betétlap nem sablonja ennek a funkciónak. Az Émász forrás-PDF-en hatálybalépési dátum nincs, az ellenőrzéskor a hivatalos ügyintézési oldal ezt a változatot linkelte. Más elosztó nyomtatványát nem helyettesítjük automatikusan a támogatott lapokkal.

## Forrásmegőrzés és PDF

A `public/forms/h-tariff` eredeti PDF-jei változtatás nélkül kerültek a hivatalos honlapokról a repóba. SHA-256:

- `eon-25-htb-1-2.pdf`: `8fe2323df2f4635cf0cc194dc2ca23af06ca8557deccc4e72d5f80b422a2e945`
- `mvm-aszab-10-ny03.pdf`: `c8756b5b3311d113fdc3efa3a7c4169ada99a52c5b3c85192d835b578d829048`
- `mvm-emasz-m050-01.pdf`: `d4e12a798a491041bf77058d6ceab5c37a466eea13f65071674205b029a4a16b`

Mindhárom teljes, kétoldalas forrás vizuálisan ellenőrizve. E.ON: eredeti AcroForm és oldali widgetek vizsgálva, a 28 karakteres szerkeszthető POD-mező elé nyomtatott `HU000` prefix tartozik. Démász: nincs eredeti AcroForm. Émász: 16 üres szövegmező, a logikai mezők és widgetek egyeznek; nincs választási lista vagy alapérték. A kivitelező nevének eredeti téglalapjában fordított Y-koordinátákat a generátor helyesen normalizálja.

A generátor az adott nyomtatvány mindkét eredeti oldalát megtartja háttérként. Külön, laponként egyedi nevű szerkeszthető AcroForm-mezőket hoz létre, magyar ékezeteket támogató beágyazott fonttal; így több lap másolásakor nem lesz azonos nevű mezőütközés vagy a mezőfából kimaradó widget. Az eredeti tájékoztató és nyilatkozatszöveg változatlan. A Démász rendszerjelölése a megadott rendszer bekarikázása. A túl hosszú mezőre a generálás hibát ad; nem vágjuk le a nyomtatott értéket.

## Adatok és aláírás

- A készülékek műszaki adatai az `appointment_devices.data` rekordban maradnak. A mentés optimista `updated_at` verzióellenőrzést használ.
- Az elosztó és a nyomtatvány további szerkeszthető adatai az `h_tariff_requests.data` rekordban vannak, pontos munkaterület/ügyfél/telepítési időpont hatókörrel és verzióellenőrzéssel.
- Marketingnévből nem következtetünk teljesítményre, SCOP-ra, áramerősségre, modellre, sorozatszámra vagy fűtési fogyasztásra. A hiányzó adatokat a szerelő ellenőrzi és kitölti a gyártói forrásból.
- A PDF API a hitelesített tagság és ügyfél/időpont ellenőrzése után csak a mentett adatokat olvassa. Az `appointments.quote_id` aktuális készüléktételeihez minden készülékadatnak rendelkezésre kell állnia. A korábbi ajánlattételből megmaradt, már nem érintett készüléksorok és fotóik megmaradnak, de nem kerülnek a mostani PDF-be.
- A nyomtatvány aláírási helyei üresek maradnak. Nem másolunk rá munkalap- vagy vásárlásinyilatkozat-aláírást. Generálás nem jelent tarifajóváhagyást vagy benyújtást.
- E.ON esetén műszaki adatlapot és energiacímkét is csatolni kell; a készülék kivitelezője és a regisztrált villanyszerelő a saját nyilatkozatát írja alá.

## MVM Émász mezők és rendszerkorlát

Az Émász nyomtatványhoz az igénylő neve, a teljes telepítési cím, az Émász felhasználási hely azonosítója, a keltezés, az F-gázos kivitelező neve, hatósági ügyfélazonosítója, telefonszáma és email címe szükséges. Az ügyiratszám az első igénybejelentés előtt elhagyható; hiánypótlásnál a felhasználó feltünteti. A választott tarifa `H`. A `Típusa` szabad szöveges mezőbe a két mentett pontos modellazonosító kerül, amelyek a külön beltéri/kültéri mezőkben is megjelennek. Mindkét egység teljes gyári száma kötelező és külön mezőbe kerül; marketingnév nem helyettesíti.

Az Émász a többi elosztóhoz eltérő felhasználásihely-azonosítót használhat, ezért ez külön `emaszConsumptionPlaceIdentifier` JSON-mezőben marad. A `caseNumber` és `installerFgasIdentifier` szintén a meglévő `h_tariff_requests.data` része; nincs új adatbázisoszlop. A műszaki adatok a meglévő készülékmezőket használják. Az Émász forma nem kér SCOP-ot, teljesítményt vagy fázisszámot, ezért ezeket a panel nem kéri, és esetleges korábbi értékük nem akadályozza az Émász PDF-et. Ez nem minősül a jogosultság vagy szükséges mellékletek automatikus ellenőrzésének.

A forrás útmutatója rendszerenként egy nyilatkozatot ír elő. Multi rendszerben kültérinként egy lap szükséges az összes beltéri adataival; ha nem férnek el, külön táblázat és bekötési blokkvázlat is megengedett. A jelenlegi AlinFlow-készülékmodell egy beltéri–kültéri párt tárol, nem ismeri a multi rendszer hierarchiáját. Ha több aktuális készüléksorban azonos kültéri S/N szerepel, a generálás megáll és egyértelmű javítási/különkitöltési üzenetet ad. Az összevetés a kis-/nagybetűt és szóközöket egységesíti, a mentett és nyomtatott sorozatszámot nem módosítja. Multi rendszerből nem hoz létre megtévesztő, különálló nyilatkozatokat. Az önálló párok azonos modell esetén is külön nyilatkozatot kapnak.

## Ellenőrzés

`node --test tests/h-tariff.test.cjs` ellenőrzi az adatérvényesítést, egységek csoportosítását, forrásfájlok hashét, kész PDF-ek teljes oldalszámát és logikai mezőit, a scope- és verzióellenőrzést, valamint az API mentett készülékekre korlátozott működését.

Teszt-PDF-ekhez a `H_TARIFF_RENDER_DIR` környezeti változó helyi, kizárt mappára állítható. A QA fiktív adatokkal történik. A PDFium renderhez az interaktív mezők megjelenítésére `PdfDocument.init_forms()` szükséges. A logikai mezőfa/widget/AP ellenőrzést a render nem helyettesíti.

A kiadás `outputFileTracingIncludes` beállítása tartalmazza a hivatalos sablonokat és a PDF fontfájlt. A Supabase additív migrációját a szülő telepítési terv kezeli; ez a modul közvetlenül nem futtat migrációt.
