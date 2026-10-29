# Karbantartási választás: eredeti szerelő vagy teljes visszautasítás

## Cél
Két egymást kizáró jelölés: „Az eredeti szerelőtől kéri” és „Nem kéri a karbantartást”. Az előbbi az eredeti szerelőnél és a partnernél is látszik, az eredeti szerelő esedékességét nem szünteti meg. Az utóbbi új, kifejezett választásként minden jogosult résztvevőnél teljes visszautasítás. Egyik választás kikapcsolása a karbantartási figyelést visszaállítja.

## Jelenlegi működés
A saját appointments.maintenance_opt_out és a shared_maintenance_preferences partnerenkénti jelölések. A térkép, az átvett példány és a munkaoldal külön adatutakon kapja ezeket. Korábbi helyi visszautasítás nem minősíthető automatikusan teljes elutasításnak.

## Megváltoztathatatlan szabályok
- Migrációkor korábbi üzleti rekord, partnerjelölés, dokumentum, aláírás és időpont nem változik.
- Nincs új megosztás vagy tagság. Csak meglévő saját hozzáférés vagy a konkrét aktív megosztás alapján lehet olvasni/menteni.
- Megmarad az előző javítás: a partner karbantartása az ügyfél előzményeiben látszik.
- A jelölés nem ad megrendelést, nem küld értesítést és nem készít karbantartási időpontot.

## Adatmodell
Új, eredeti telepítéshez kulcsolt maintenance_contact_preferences tábla: source_workspace_id, source_installation_id, choice (open/original_installer/declined), updated_at, updated_by, updated_workspace_id. Nincs közvetlen kliensoldali táblajog; idempotens migráció és szűk security-definer RPC-k.
Az explicit open rekord megmarad és elsőbbséget élvez a régi helyi jelöléssel szemben. A régi boolean RPC változatlan. Az új setter a saját forrás régi kizárását kizárólag az eredeti munkaterület felhasználójának kifejezett open/original_installer mentésekor kapcsolhatja vissza. A meglévő megosztási olvasási feltételeket nem tágítjuk.
Elfogadott példány forrását a szerver a saját handoffból oldja fel. Mentéskor az előző updated_at ellenőrzése véd az észrevétlen felülírástól.

## Implementációs lépések
1. Szűk adatbázis-migráció, RPC és jogosultsági/adatmegőrzési tesztek.
2. Típusok, kliens, identitáshoz kötött betöltés és mentési visszajelzés.
3. Térképes és ügyféloldali jelölések, új választás elsődleges olvasott megjelenítése. A partnernél az eredeti szerelőhöz visszakért tételek külön állapotban szerepelnek; az eredeti szerelőnél a normál esedékesség megmarad.
4. Célzott regresszió, típusellenőrzés, build, mobil/asztali megjelenés.
5. Védett sémaellenőrzés/mentés, migráció, külön PR és éles ellenőrzés.

## Ellenőrzés
- Régi adatok változatlanok és a migráció ismételhető.
- Idegen munkaterület, visszavont megosztás, hibás handoff, stale mentés tiltva.
- Saját, egyeztetésre megosztott és elfogadott példány egy döntést mutat; az open és a két kiválasztott állapot váltása helyes.
- Korábbi dokumentumok/időpontok és a partnerelőzmények megmaradnak.
- npx tsc --noEmit; npm run build; célzott tesztek; nincs új gyökér app vagy duplikált page.

## Visszaállítás
A kliensjavítás visszavonható; az új táblát és beállításokat megtartjuk. A migráció előtt mentett függvények visszaállíthatók. Nincs adatot törlő visszaállítás.

## Módosított fájlok / lezárás
Elkészült a közös választás mentése, verzióellenőrzése, identitáshoz kötött betöltése és megjelenítése. Az eredeti szerelő szűrője a saját munkaterületen is megtalálja a visszakért telepítéseket, a normál esedékesség megtartásával.

Érintett fájlok:
- `src/app/page.tsx`
- `src/components/alinflow/MaintenanceChoiceControls.tsx`
- `src/components/alinflow/MaintenanceMapPanel.tsx`
- `src/components/alinflow/WorkPagePanel.tsx`
- `src/components/alinflow/useSharedMaintenance.ts`
- `src/lib/alinflow/maintenance-contact-choice.ts`
- `src/lib/alinflow/maintenance-map.ts`
- `src/lib/alinflow/shared-maintenance-client.ts`
- `src/lib/alinflow/shared-maintenance.ts`
- `docs/sql/20261029_MAINTENANCE_CONTACT_CHOICE.sql`
- `docs/sql/VERIFY_20261029_MAINTENANCE_CONTACT_CHOICE.sql`
- `tests/maintenance-contact-choice.test.cjs`
- `tests/maintenance-contact-choice-sql.test.mjs`
- `tests/shared-maintenance-ui.test.cjs`
- `tests/map-marker-layer.test.cjs`
- ez a végrehajtási terv.

Ellenőrzések (2026-10-29):
- 145/145 célzott felületi, térképes, előzmény- és identitáskezelési teszt sikeres.
- 17/17 új és 19/19 meglévő PostgreSQL-jogosultsági/adatmegőrzési teszt sikeres; a migráció ismételt futtatása is ellenőrzött.
- `npx tsc --noEmit` sikeres. A helyi `npm run build` sikeres, kizárólag fordításhoz használt nyilvános Supabase-helyettesítő értékekkel; az éles környezettel a Vercel ellenőrzése szükséges.
- Asztali és 390 px mobilos előnézet: kizáró jelölések, várakozás alatti tiltás, szerepek közötti egyezés és az eredeti szerelő szűrője ellenőrizve. Mobilon nincs vízszintes túlcsordulás.
- Éles migráció friss privát sémamentés után sikeres; tranzakciós ellenőrzés igazolta a meglévő üzleti sorok, függvények és jogosultságok változatlanságát. Az olvasási utóellenőrzés sikeres. Valódi ügyfél választása nem lett teszt céljából átállítva.
- Az alkalmazás kiadása külön PR-rel, Vercel-build és olvasási ellenőrzés után történik.
