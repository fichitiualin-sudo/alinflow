# Adatkezelési tájékoztató és karbantartási partner-hozzájárulás

## Cél
A munkalap mellé saját munkaterületi adatkezelési tájékoztató készül, amelyben a készülék értékesítője és a munkát végző EV külön szerepel. A név, munkacím, telefon és email karbantartó partnernek történő átadásához külön, alapból üres, konkrét partnerhez kötött hozzájárulás rögzíthető. Ebben a fejlesztésben partneri adathozzáférés nem létesül.

## Jelenlegi működés
A work_reports mentett, aláírt munkalapokból készül előnézet, HTML-export és email-PDF. A vásárlási nyilatkozat külön rekord. Céges beállításokat a workspace_settings JSON mezői tárolnak.

## Megváltoztathatatlan szabályok
- Régi dokumentumhoz nem állítható utólag tájékoztatás vagy hozzájárulás.
- A hozzájárulás önkéntes; elutasítása nem akadályozhatja a munkát.
- Csak a megjelenített, konkrét partnerre vonatkozhat; partnercsere törli a még alá nem írt választást.
- A nyilatkozat önmagában nem ad munkaterületi vagy partneri hozzáférést.
- A korábbi mentett dokumentumok és időpontok megmaradnak.
- Valós ügyfélemail tesztelés céljából nem küldhető.

## Adatmodell
Új nullable privacy_notice JSONB pillanatkép és privacy_consent_revoked_at a work_reports táblán. Saját verzió, tartalom, céges adatok, partner, opcionális döntés és a valódi aláírás időpontjához kötött nyilvántartás. A korábbi nyilatkozatot és visszavonást a work_report_privacy_history őrzi meg módosítás vagy törlés után is; ezt csak a saját munkaterület aktív tagjai olvashatják. Nincs régi rekordok visszatöltésből következtetett hozzájárulása. A céges és partneradatok a meglévő document_settings JSON-ba kerülnek. A migráció idempotens, futtatása előtt mentés és állapotellenőrzés szükséges.

## Implementációs lépések
1. Cégadatok és felhasználói pontosítás ellenőrzése; rövid tájékoztató és verziózott modell.
2. Beállítások, munkalap előnézet és önkéntes hozzájárulás.
3. Pillanatkép mentése/visszatöltése, archivált előnézet és PDF-melléklet.
4. Adatizoláció, régi dokumentumok, friss aláírás és céges különbségek ellenőrzése.
5. Vizuális ellenőrzés, típusellenőrzés/build, éles konfigurálás és kiadás.

## Ellenőrzés
- npx tsc --noEmit; npm run build
- Célzott tesztek: hozzájárulás nélkül/aláírás nélkül nincs engedély; régi pillanatkép megmarad; partnercsere nem örököl engedélyt; munkaterületek adatai nem keverednek.
- PDF és mobil/asztali előnézet ellenőrzése szintetikus adatokkal.

## Visszaállítás
Az alkalmazáskiadás visszaállítható. Az új nullable mező és az abba mentett ügyféldöntések nem törlendők.

## Módosított fájlok és lezárás
- Elkészült: domainmodell, céges beállítások, önkéntes pipa, friss aláírás, visszavonás, előnézet/HTML-export/PDF-csatolmány és adatbázis-védelem.
- Mentés előtt az aláírást külön rögzíteni kell. Szöveg vagy partneri választás módosításakor új aláírás szükséges. A céges beállítás és munkalap késői válasza nem írhat másik munkaterület állapotába.
- 2026-10-11: védett, adatbázison belüli másolat az érintett work_reports/workspace_settings adatokról és eredeti report-policyról az alinflow_backup_20261011_privacy sémában. Ez célzott migrációs visszaállítási másolat, nem külső katasztrófa-mentés.
- Éles additív migráció lefutott. Mind a 132 korábbi munkalap változatlan: fingerprint 6819d314e6be120307f89381e9dd2ec8. A 2 beállításrekord és a munkalap-jogosultságok változatlanok. Mind a 15 utóellenőrzés sikeres, beleértve a tesztelt trigger törzsének egyezését, az üres induló nyilatkozatokat és az előzménytábla védelmét.
- Típusellenőrzés sikeres. A teljes helyi build fordítása és TypeScript lépése sikeres; page-data gyűjtéskor a helyi Supabase URL hiánya miatt leáll (/api/h-tariff/pdf). A kiadáshoz Vercel-build ellenőrzés szükséges.
- 54 célzott alkalmazás/PDF/izolációs teszt és 21 PGlite integrációs ellenőrzés sikeres. Korábbi teljes tesztfutás: 765 sikeres, 5 kihagyott, 0 hibás.
- PDF mindkét oldalának vizuális ellenőrzése, asztali és mobilos felület, többvonásos és teljes képernyős aláírás, partner nélküli döntés és visszavonás helyi, szintetikus próbája megtörtént; valódi email nem ment ki.
- Hátralévő: céges konfiguráció aktiválása, Vercel-kiadás és éles beállítások ellenőrzése.
