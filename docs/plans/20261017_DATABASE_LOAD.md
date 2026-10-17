# Háttérfolyamatok adatbázis-terhelésének csökkentése

## Cél
A tartós CPU-terhelés csökkentése a névjegy- és naptárszinkron, valamint az ismételt háttérlekérdezések célzott optimalizálásával.

## Jelenlegi működés
A Contacts worker futásonként a teljes munkaterület forrását és összerendeléseit betölti, legfeljebb nyolc névjegyet dolgoz fel, és a sikeres kapcsolatot öt perc múlva újra sorba állítja. A naptár kliens üres sor mellett is worker-hívást indít. A kiinduló élő mérés közel 95–100% CPU; 451 kapcsolt névjegyből 411 esedékes. A kumulatív SQL-statisztika május óta gyűlik, ezért az aktuális okot külön mintavétellel vizsgáljuk.

## Megváltoztathatatlan szabályok
Csak jóváhagyott névjegyek frissülhetnek; csoporttagság, ütközésvizsgálat, workspace-szigetelés, marker, lease és bizonytalan írás egyeztetése marad. Nincs ügyfél-, időpont-, dokumentum- vagy Google-névjegy törlés. A mentett időpont naptárszinkronja azonnal próbálkozik. Titok vagy személyes adat nem kerül a repóba.

## Adatmodell
Először a meglévő változást jelző Contacts trigger és indexek auditja. Csak bizonyítottan szükséges, idempotens SQL-változtatás készül; meglévő üzleti rekordokat nem módosítunk.

## Implementációs lépések
1. Aktuális lekérdezések és hibás ismétlések mérése; forrás és trigger audit.
2. Contacts üresjárati újraolvasás csökkentése, megtartott gyors változáskövetés és biztonságos feldolgozás.
3. Naptár és térkép felesleges ismétléseinek célzott csökkentése.
4. Regressziós tesztek, típusellenőrzés, build, PR, éles kiadás és új mérés.

## Ellenőrzés
Célzott valódi viselkedést tesztelő automatizált tesztek; npx tsc --noEmit; npm run build; teljes regressziós csomag; desktop és mobil betöltés. Éles mérés csak összesített működési adatokat olvas.

## Visszaállítás
Alkalmazáskiadás visszaállítása; esetleges SQL-változáshoz külön visszaállítási leírás. Jóváhagyások és szinkronállapotok megmaradnak.

## Módosított fájlok és lezárás
A megvalósítás végén kitöltendő.
## Bizonyított fő ok és módosított hatókör
15 másodperc alatt 6936 authenticated request-context tranzakció futott; két aktív kérés a save_maintenance_geocode függvényben volt. A függvény üzleti verzióütközésre 40001-et dobott, amely a Supabase által dokumentált végtelen PostgREST-újrapróbálást váltja ki. Célzott PT409 migráció és kompatibilis klienskezelés készül, üzleti adat és jogosultság módosítása nélkül.

A Contacts batch-szűkítést elvetettük: változásjelző nélkül elveszne a jelenlegi hash-alapú előresorolás. Ennek tartós változásjelzőre épülő megoldása lehet későbbi fejlesztés; most a meglévő frissítési sebességet megőrizzük.

## Éles adatbázis-eredmény
2026-10-17 14:23 Europe/Budapest: helyi SQL-regresszió és éles visszagörgetett próba után a migráció alkalmazva. Utána ugyanabban a 15 másodperces mérésben a korábbi 6936 authenticated kontextusbeállítás helyett 0 volt; közben a Contacts worker nyolc normál frissítést végzett. Nincs processzleállítás, újraindítás, csomagváltás vagy üzleti rekordmódosítás.

## Elkészült változások és ellenőrzések
- A térképes verzió/címütközés PT409, a kliens mind az új kódot, mind a régi 40001-et egyszer kezeli és továbblép.
- A Google Naptár üresjárati ciklusa három helyett egy HTTP-kérés; mentés/kapcsolatváltozás továbbra is azonnali, a sorba tett mentés nem veszhet el. Hibás friss státusz alapján nem indul worker.
- Rejtett kezdeti lap nem kér adatot; a 15 másodpercen belüli focus/visibility események összevonva. A térkép perces jogosultságellenőrzése, kézi frissítése és visszavont megosztás eltávolítása megmaradt.
- npx tsc --noEmit: sikeres.
- npm run build: sikeres, szintetikus publikus Supabase buildértékekkel.
- npm test: 1320 teszt, 1318 sikeres, 2 környezeti kihagyás, 0 hiba.
- Külön SQL-regresszió: 8 ellenőrzési csoport sikeres. Legacy migrációból frissítés, ismételhetőség, teljes függvénydefiníció és jogosultság megőrzése, régi cím/verzió tiltása, sikeres mentés, külső workspace/anon tiltása, korábbi munkalap megőrzése.
- Célzott hook- és térképrétegtesztek: 52/52; geokódolási kliens: 9/9.
- Nincs gyökér app könyvtár vagy új page.tsx. A munkapéldány külön, az eredeti felhasználói munkafájlokhoz nem nyúltunk.
- Új környezeti változó nincs. Az éles SQL-migráció már alkalmazva; a Vercel-kiadás és böngészős visszaellenőrzés ezt követi.

## Ténylegesen módosított fájlok
- docs/plans/20261017_DATABASE_LOAD.md
- docs/EMAILS_AND_CALENDAR.md
- docs/sql/20261012_MAINTENANCE_GEOCODE_SAFETY.sql
- docs/sql/20261017_GEOCODE_NON_RETRYABLE_CONFLICT.sql
- src/app/page.tsx
- src/components/alinflow/GoogleCalendarSync.tsx
- src/components/alinflow/useSharedMaintenance.ts
- tests/google-calendar-client.test.cjs
- tests/shared-maintenance-ui.test.cjs
- tests/maintenance-geocoding.test.cjs
- tests/maintenance-geocoding-sql.test.mjs

## Visszaállítás és korlát
A frontend visszaállítható, de a PT409 adatbázis-javítás maradjon: 40001 visszaállítása újra végtelen próbálkozást indíthat. A régi kliens átmenetileg egyszeri hibaüzenetet mutathat, ezért frissítés ajánlott. A Contacts teljes forrásolvasása később optimalizálható változásjelzővel; most a fő CPU-hibát javítottuk és a meglévő szinkronsebességet megtartottuk. A Supabase műszerek késleltetett állapotot mutathatnak; az ismétlési ciklus megszűnését közvetlen SQL-mintavétellel igazoltuk.
