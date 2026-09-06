# AlinFlow auditjavítások

2026. szeptember 6. | Ág: `codex/fix-audit-findings`

## Eredmény

A korábbi ellenőrzésben reprodukált 15 hiba javítása elkészült a helyi kódban.
Az adatbázist érintő részekhez új migráció is készült.
Az élesítési lépések aktuális állapota: `docs/plans/20260906_AUDIT_RELEASE.md`.
Az ellenőrzött mentés után az éles migráció sikeresen lefutott.
Valódi számla- vagy emailküldés a tesztek során nem történt.
A javítás nem állítja helyre találgatás alapján a korábban esetleg sérült adatokat.

| Azonosító | Javítás |
| --- | --- |
| A01 | Mind az öt számlázási/email API ellenőrzi a bejelentkezést, aktív munkaterületi tagságot, ügyfelet és a megadott időpontot. A címzett a mentett ügyfélből származik; eltérő, el nem mentett email-címnél megáll a küldés. |
| A02 | Munkalapbetöltés és mentés pontos munkához kötve; másik munka régi aláírására nincs visszaesés. Betöltési hiba vagy többértelmű találat esetén a mentés tiltott. Adatbázis-trigger is védi a kapcsolatot. |
| A03 | Archivált klíma neve, termékazonosítója és mentett ára megmarad az ajánlatban. Mindhárom szerkesztő látható archivált opciót mutat. |
| A04 | Új termék sikeres mentés után megmarad a listában; sikertelen mentés nem üríti ki a beviteli mezőket. |
| A05 | A térképes esedékességbe csak lezárt, nem jövőbeli karbantartás számít bele. |
| A06 | Az ajánlat és tételeinek cseréje egy SQL-tranzakció. Beszúrási hiba esetén az eredeti tételek visszaállnak. |
| A07 | Klíma- és anyagkészlet, lezárási státusz és lezárási dokumentum közös tranzakcióban változik. Nincs részleges készletlevonás vagy abszolút pillanatképes visszaírás. |
| A08 | Lemondás után az eredeti időpontazonosítóval frissül az előzmény, így az időpont azonnal felszabadul a felületen. |
| A09 | A pipák és dokumentumállapotok mentési hibái láthatók. Sikertelen kézi számlázás nem jelenik meg sikeresnek. A régi ügyfélszintű felülírási fallback megszűnt. |
| A10 | Az anyaglista és felülírt mennyiségek időpontonként mentődnek és töltődnek. Másik munkánál külön állapot, érvénytelen mennyiségnél mentési hiba. |
| A11 | A mentett 0 Ft-os árat nem helyettesíti a katalógusár. |
| A12 | Tartós készletlevonási időbélyeg és ismételt levonás elleni SQL-védelem. Kész munka átütemezése megőrzi ezt és a kész státuszt. |
| A13 | Felmérésből telepítés indítása új időpontot hoz létre; a régi munkatípus átírását adatbázis-védelem tiltja. |
| A14 | Részletes betöltési hiba megőrzi a korábbi adatokat és engedi az újrapróbálást. |
| A15 | Új időpontnál ugyanannak az ügyfélnek a többi munkája is részt vesz az ütközésvizsgálatban. |

R01: a fő betöltés, részletes adatok, termékek, készlet és export lapozva olvas.
A lapozás alacsonyabb szerveroldali sorlimitet is kezel; ez nem adatbázis-pillanatkép.

R02: a jelenlegi globális Számla Agent-kulcsok csak az explicit
`SZAMLAZZ_WORKSPACE_ID` munkaterületről használhatók. Másik munkaterület vagy
hiányzó beállítás esetén a számlázás tiltott. Ez nem többcéges kulcstároló:
továbbra is tisztázni kell, mely munkaterületek mely számlakibocsátóhoz tartoznak.

R03: a kiadási mobilpróba során talált mentetlen karbantartási visszalépési hiba
javítva: Vissza esetén az eredeti telepítés és annak tételei állnak vissza.
Ez nem hoz létre vagy töröl adatbázisrekordot.

## Élesítési Sorrend

1. Először külön tesztkörnyezetben, a telepített sémával egyező adatbázison próbáld ki a kiadást. A helyi tesztadatbázis szintetikus sémát használ.
2. Élesítés előtt készüljön ellenőrzött adatbázis-mentés. Rövid karbantartási ablakban szüneteljen a mentés, készletmódosítás, számlázás és import minden felhasználónál.
3. Futtasd a `docs/sql/20260906_PREFLIGHT_AUDIT_DATA_SAFETY.sql` csak olvasó ellenőrzést adatbázis-adminisztrátorként. Minden `passed` legyen `true`. A kiírt RLS-szabályokat, egyedi indexeket és idegenkulcs-függőségeket külön is át kell nézni. Ez nem helyettesíthető pusztán az RLS bekapcsolt állapotával.
4. Vercelben állítsd be a `SZAMLAZZ_WORKSPACE_ID` értékét a jelenlegi számlázási kulcsokhoz tartozó AlinFlow-munkaterület pontos UUID-jére, a megfelelő Production és Preview környezetben. Nem cégnév, felhasználóazonosító vagy Google-projektazonosító kell. A meglévő számlázási kulcsok maradnak szerveroldalon.
5. Futtasd teljes egészében a `docs/sql/20260906_AUDIT_DATA_SAFETY.sql` migrációt. A munkaterületi és többmunkás korábbi migrációkat feltételezi, PostgreSQL 15 vagy újabb szükséges.
6. Futtasd a `docs/sql/20260906_VERIFY_AUDIT_DATA_SAFETY.sql` fájlt. Minden `passed=true`, minden `count_value=0` legyen. Eltérésnél állj meg, és vizsgáld meg az érintett rekordokat; ne töröld automatikusan a duplikációkat.
7. Csak ezután telepítsd az új alkalmazást. Minden nyitott AlinFlow-lapot frissíteni kell, a telefonon is. Régi klienssel ne folytatódjon készletmódosítás.
8. Ellenőrizd a bejelentkezett asztali és mobil folyamatokat a tesztkörnyezetben: két telepítés ugyanannál az ügyfélnél, új karbantartás, aláírás, lemondás, átütemezés, kézi számlázás, elégtelen készlet, archivált termék és export.

Ha a migráció egy régi egyedi kulcs függősége vagy duplikáció miatt hibázik,
az egész tranzakció visszagördül. Ne használj `CASCADE`-ot és ne törölj ügyféladatot
a hiba elhallgattatásához. A megadott ellenőrző SQL-ek nem módosítanak adatot.

A kész szerelések új időbélyegének visszatöltése a korábbi státuszt őrzi meg,
nem történeti készletmozgás-rekonstrukció. A régebbi hibás részlevonásokat,
átkötött munkalapokat vagy ismételt számlákat külön, bizonyíték alapján kell rendezni.

## Ellenőrzések

- 70 sikeres Node-teszt, 0 sikertelen, 0 kihagyott a teljes futásban.
- Az éles public/auth sémák és adatok helyi visszaállításán is sikeres migráció és 10 regressziós eset; külön natív PostgreSQL-másolaton kétkapcsolatos készletütközési teszt.
- Valódi PostgreSQL-motoron, helyi PGlite-adatbázisban futtatott migráció és SQL-függvények. A migráció kétszer lefutott, idempotens volt a tesztsémán.
- Szándékosan hibára futtatott tételbeszúrás és anyaglevonás igazolja a visszagördülést. Ismételt lezárás nem von le ismét készletet.
- API-hívások és Supabase-kliens helyettesítve: a tesztek nem küldenek valódi számlát vagy levelet.
- Archivált termékek szerkesztői React szerveroldali rendereléssel is ellenőrizve.
- `tsc --noEmit --incremental false`: sikeres.
- `npm run build -- --webpack`: sikeres, szintetikus Supabase-környezeti változókkal.

A helyi `node_modules` a másik, azonos lockfájlt használó munkakönyvtárra mutat.
Emiatt a build webpackkel futott; Turbopack ezt a könyvtárkapcsolatot nem kezeli.
Normál kiadásnál a projekt saját függőségtelepítését kell használni.

## Határok

- A valódi Supabase-séma és érintett RLS-szabályok ellenőrizve, a public/auth visszaállítás kipróbálva. A felhős tárhely és hitelesítési szolgáltatás nem része a helyi PostgreSQL-szimulációnak. A bejelentkezett mobil ellenőrzés állapota az élesítési naplóban szerepel.
- A PGlite sorosítja a kéréseket; ezt kiegészíti a sikeres, két valódi PostgreSQL-kapcsolatos készletütközési és ismételt lezárási teszt. A SQL stabil sorrendű sorzárakat és relatív készletmódosítást használ.
- A teljes ügyfél, ajánlat és időpont mentése továbbra sem egyetlen tranzakció; a javítás az ajánlati tételcserét, az időpont erőforrás-kapcsolatait és a készletlezárást védi.
- A számlázási hitelesítés nem számlaszolgáltatói idempotenciamegoldás. Bizonytalan szolgáltatóválasz után ellenőrizni kell a számla létrejöttét az ismétlés előtt.
- Az npm sérülékenységi audit a korábbi hálózati/jóváhagyási korlátozás miatt nem teljes. Nincs sérülékenységmentességi állítás.
- A külön fejlesztési ágon lévő Google Naptár-import nem része ennek a main-alapú javításnak.

Visszaállításkor az új adatmezőket és dokumentumokat meg kell tartani.
Készletet nem szabad régi, abszolút számokra visszaírni. A régi, hitelesítés
nélküli API-változat visszatelepítése helyett javító kiadás vagy ideiglenes
művelet-tiltás javasolt.

## Fájlok

A központi változások: `src/app/page.tsx`; az öt érintett email/számla route;
`DocumentCards`, `QuoteBuilderPanel`, `SchedulePanel`, `WorkPagePanel`;
`products`, `schedule`, `maintenance-map`, `types`, `work-report` segédmodulok.
Új modulok: `server-auth.ts`, `pagination.ts`, `materials.ts`, `report-scope.ts`.
Új SQL-ek: a fenti három 20260906-fájl. Tesztek és futtatás: `tests/`,
`package.json`; generált fájlok kizárása: `.gitignore`.
