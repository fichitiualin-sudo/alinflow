# Google Naptár – üzemeltetés és aktiválás

## Aktiválási állapot

2026-10-08-án a funkció kódja éles kiadásba került. A Google Cloud projekt, a Calendar API, az OAuth-kliens és a kizárólag Production környezetben tárolt öt Vercel-változó beállítva; az új kiadás Ready. Az éles Supabase-migráció lefutott, a három új tábla RLS- és böngészős olvasási tiltása ellenőrizve. A percenkénti cron aktív és sikeresen futott. A Vaultból hitelesített éles HTTP-próba 200 választ és nulla feldolgozott tételt adott; a kapcsolati tábla és a sor ekkor üres volt.

A nyilvános naptár-adatkezelési tájékoztató szövegét az üzemeltető jóváhagyta. Közzététele, a Google alkalmazás Production állapotba kapcsolása és a munkaterületi OAuth-összekapcsolás még hátravan. Az éles Google-esemény létrehozása/módosítása/lemondása még nincs igazolva; a sikeres üres háttérhívás önmagában nem naptárkapcsolat.

## Működés

- Egy munkaterület egy Google-fiók elsődleges naptárához kapcsolható. A szerver a Google által igazolt email-címet használja naptárazonosítóként, és mentés előtt ellenőrzi az adott naptárhoz tartozó `owner` hozzáférést. A kapcsolat nem irányítható át másik fiókra vagy naptárra egyszerű újraengedélyezéssel.
- Csak az első sikeres összekapcsolás időpontja után létrehozott AlinFlow-időpontok kerülnek a szinkronizálási sorba. A határ a rekord létrehozási ideje, nem a munkavégzés napja. Egy korábban felvett, de későbbre szóló időpont sem kerül át visszamenőleg.
- Szerelés, felmérés és karbantartás is támogatott. Módosításkor ugyanaz a kezelt Google-esemény frissül; lemondáskor vagy az időpont törlésekor a hozzá tartozó esemény törlődik. A feldolgozási sor a törölt időpont azonosítóját is megőrzi.
- A kézzel készített Google-eseményekhez a szinkronizálás nem nyúl. A Google oldalon végzett módosítások nem kerülnek vissza az AlinFlow-ba; a kapcsolat egyirányú. A már kezelt időpont kézi `+ Naptár` gombját a felület elrejti a duplázás megelőzésére.
- Az esemény időzónája `Europe/Budapest`. A dátum, kezdési idő és munkatípus szerinti időtartam az AlinFlow mentett adataiból származik.
- Nincsenek meghívottak az eseményben. A módosító Google-kérések `sendUpdates=none` paramétert használnak, az esemény pedig nem örökli a naptár alapértelmezett emlékeztetőit (`reminders.useDefault=false`). Az AlinFlow saját ügyféllevelei ettől függetlenül működnek.
- A Google hibája nem vonja vissza az AlinFlow-időpont mentését. Az átmeneti hibák után a tartós sor újrapróbálkozik; a Beállítások és a Naptár jelzik az elmaradt frissítést.

## Google Cloud és környezeti változók

1. A megfelelő Google Cloud projektben legyen engedélyezve a **Google Calendar API**.
2. Készüljön **Web application** típusú OAuth-kliens. A jóváhagyott visszatérési cím pontosan a `GOOGLE_CALENDAR_APP_URL` eredetéhez tartozó `/api/google-calendar/callback` legyen. Az alkalmazást is ezen a kanonikus HTTPS-címen kell megnyitni; más hosztnévről indított folyamatnál a hosthoz kötött OAuth-cookie nem érkezik meg.
3. A Google hozzájárulási képernyőjén a kért jogosultságok: `openid`, `email`, `https://www.googleapis.com/auth/calendar.events.owned`. Az utóbbi a felhasználó saját naptárainak eseményeire ad Google-jogosultságot; az AlinFlow ezen belül kizárólag a kapcsolt naptár saját, azonosított eseményeit kezeli. Nincs szükség Gmail- vagy teljes Google-fiók-hozzáférésre.
4. A felhasználói kör és a Google által kért alkalmazásellenőrzés legyen megfelelően beállítva. Külső, **Testing** állapotú OAuth-alkalmazásnál a Calendar-jogosultsággal kiadott frissítési token **7 nap után lejár**; ez nem állandó háttérkapcsolat. A korlátozást a [Google OAuth-dokumentációja](https://developers.google.com/identity/protocols/oauth2#expiration) ismerteti. Tesztüzemben a kapcsolódó fióknak a tesztfelhasználók között is szerepelnie kell.
5. A Vercel megfelelő környezetében add meg a szerveroldali változókat, majd készüljön új kiadás. Éles hitelesítési adatokat ne másolj ellenőrizetlen előnézeti környezetbe.

| Változó | Tartalom |
| --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID` | A Google webes OAuth-kliens azonosítója. |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Az OAuth-kliens titka; csak szerveroldali változó. |
| `GOOGLE_CALENDAR_TOKEN_KEY` | Biztonságosan generált, pontosan 32 véletlen bájt szabványos Base64-kódolással. A titkosított adatbázistól külön tárolandó. |
| `GOOGLE_CALENDAR_APP_URL` | Az alkalmazás kanonikus HTTPS-eredete. Nincs alútvonal, query, fragment vagy felhasználónév/jelszó. |
| `GOOGLE_CALENDAR_CRON_SECRET` | A háttérhívás önálló, véletlen titka, legalább 32 karakterrel. A Vault-sablonhoz 32–512 karakteres Base64/Base64url vagy hex érték megfelelő. |
| `NEXT_PUBLIC_SUPABASE_URL` | A meglévő Supabase projekt URL-je. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | A meglévő klienskulcs a bejelentkezés és tagság ellenőrzéséhez. |
| `SUPABASE_SERVICE_ROLE_KEY` | A meglévő szerveroldali Supabase-kulcs a privát kapcsolati adatokhoz és RPC-khez. |

A `GOOGLE_CALENDAR_*` titkok és a service-role kulcs nem kaphatnak `NEXT_PUBLIC_` előtagot. Titkot, felhasználói email-címet vagy hozzáférési tokent nem szabad a repóba, kiadási leírásba vagy naplóba másolni. A `GOOGLE_CALENDAR_TOKEN_KEY` cseréje a régi kulccsal titkosított tokeneket olvashatatlanná teszi; kulcscserét csak megtervezett újratitkosítással vagy újraengedélyezéssel végezz.

## Adatbázis és hozzáférés

A munkaterület-elkülönítés migrációja után alkalmazd a [GOOGLE_CALENDAR_SYNC.sql](sql/GOOGLE_CALENDAR_SYNC.sql) fájlt az éles sémához tartozó szokásos mentési és migrációs ellenőrzésekkel. A migráció additív és ismételhető, nem küld Google-kérést, nem tölti át a régi időpontokat.

A három új tábla:

| Tábla | Szerep |
| --- | --- |
| `google_calendar_connections` | Munkaterületenként a kapcsolt fiók, naptár, állapot, első kapcsolódási határ és titkosított frissítési token. |
| `google_calendar_oauth_states` | Tízperces, egyszer használható OAuth-állapot, tulajdonosi kötés és titkosított PKCE-ellenőrző. |
| `google_calendar_sync_queue` | Időpontonkénti kívánt/szinkronizált verzió, távoli eseményazonosító, foglalás és újrapróbálás. |

Az új táblákon RLS van, böngészőből olvasható szabály nincs; az `anon` és `authenticated` szerepek nem olvashatnak tokent vagy közvetlenül kezelhető sort. A frissítési token AES-256-GCM titkosítást és munkaterülethez kötött hitelesítést kap. A titkosított PKCE-adat az OAuth-állapothoz kötött. Az állapotválasz csak a kapcsolódási állapotot, fiókcímet, várakozó darabszámot, kezelt időpontazonosítókat és rövid hibát adja vissza.

A kapcsolat létrehozásához és szüneteltetéséhez aktív munkaterületi `owner` vagy `admin` tagság kell. Az OAuth-visszatérés ismét ellenőrzi ezt, az atomi kapcsolati RPC pedig az adatbázisban is elvégzi a jogosultsági és fiókazonossági ellenőrzést. A szinkronizálást aktív munkaterületi tag is kezdeményezheti, de kizárólag a saját munkaterületére; az időpontazonosítókat a mentési triggerek adják a sorhoz.

## Felhasználói összekapcsolás és szüneteltetés

A **Beállítások → Google Naptár** részben a tulajdonos vagy adminisztrátor megadja a kapcsolni kívánt Google-fiók email-címét, majd a **Google Naptár összekapcsolása** gombbal elvégzi a Google jóváhagyását. Más fiók kiválasztását a visszatérés elutasítja. A mentés előtt az alkalmazás a Calendar API tulajdonosi hozzáférését is ellenőrzi, meglévő események tartalmának lekérése nélkül.

A **Szinkronizálás szüneteltetése** a kapcsolatot `paused` állapotba teszi. Megmaradnak a Google-események, a titkosított token és a feldolgozási sor. A szünet alatt létrejövő, egyébként jogosult időpontok és módosítások is várakoznak; újraengedélyezés után az eredeti első kapcsolódási határt megtartva feldolgozhatók. Ez a művelet nem vonja vissza a Google oldalán kiadott engedélyt.

Lejárt vagy visszavont Google-hozzáférésnél az állapot `reauth_required`. Ugyanazzal a Google-fiókkal lehet újraengedélyezni. Az alkalmazás nem kínál másik fiókra átállítást vagy a teljes Google-adatállomány törlését.

## Háttérfeldolgozás

A megnyitott alkalmazás időpontmentés után, előtérbe kerüléskor és látható állapotban percenként kezdeményez feldolgozást. **Bezárt böngésző mellett ez önmagában nem fut**; folyamatos háttér-újrapróbáláshoz külön időzítés szükséges.

Az opcionális [GOOGLE_CALENDAR_CRON.sql](sql/GOOGLE_CALENDAR_CRON.sql) Supabase `pg_cron` + `pg_net` feladatot állít be. Előbb a kész API-kiadásnak és a Vercelben beállított `GOOGLE_CALENDAR_CRON_SECRET` értéknek kell elérhetőnek lennie. Ezután:

1. Engedélyezd a `pg_cron`, `pg_net` bővítményeket és a Vault használatát. A már telepített bővítményeket megtartó parancsok:

   ```sql
   create schema if not exists extensions;
   create extension if not exists pg_net with schema extensions;
   create extension if not exists pg_cron;
   ```

   A `pg_cron` maga készíti el a `cron` sémát; a fenti telepítési sorrendet a [Supabase példája](https://supabase.com/docs/guides/ai/automatic-embeddings) is használja. Nincs szükség bővítmény törlésére vagy újralétrehozására.
2. A Supabase Vault felületén add hozzá az `alinflow_app_url` nevű értéket: ugyanaz a kanonikus HTTPS-eredet, mint a Vercelben, záró perjel nélkül.
3. Az `alinflow_google_calendar_cron_secret` nevű Vault-titok pontosan egyezzen a Vercel `GOOGLE_CALENDAR_CRON_SECRET` értékével.
4. Ellenőrizd, hogy a `net` és `vault` séma nincs kitéve a Data API-n. A sablon elsőként az `authenticator` szerep katalógusban mentett `pgrst.db_schemas` értékét olvassa; az adott adatbázisra érvényes beállítás elsőbbséget kap. Az SQL Editor saját `current_setting('pgrst.db_schemas',true)` értéke nem igazolja a PostgREST konfigurációját. Ismert, veszélyes vagy nem értelmezhető beállításnál a sablon megáll.
5. Ha nincs katalógusban mentett sémaérték, ellenőrizd a **Project Settings → Data API → Exposed schemas** listát. A hiányzó SQL-beállítás önmagában nem bizonyítja a védelmet. Csak a tényleges felületi ellenőrzés után illeszd a futtatási példány `begin;` sora után ezt az egyszeri, tranzakcióra érvényes megerősítést:

   ```sql
   set local alinflow.calendar_net_schema_not_exposed='confirmed';
   ```

   Ez nem állít át platformkonfigurációt. A repóban tárolt sablon nem adja meg automatikusan a megerősítést, és a jelzés nem írhat felül egy katalógusból ismert veszélyes sémalistát. A [Supabase leírja](https://supabase.com/docs/guides/troubleshooting/pgrst106-the-schema-must-be-one-of-the-following-error-when-querying-an-exposed-schema), hogy a szerepszintű felülbírálás és a Dashboard beállítása eltérhet.
6. `postgres` szerepkörrel alkalmazd a cron SQL-sablont. Ez aktiválja az `alinflow-google-calendar-sync` nevű, percenkénti feladatot. Az ismételt futtatás ezt az azonos feladatot állítja be; másik feladatot nem töröl.

A Supabase `pg_net` tábláinak megosztott jogait a platform kezeli. A `PUBLIC` táblaengedély önmagában nem jelent böngészős hozzáférést: az alkalmazásszerepek `NOLOGIN` állapota és a `net` séma Data API-ból való kizárása adja az elkülönítést. A sablon ezeket és az `anon`/`authenticated` Vault-olvasási jogának hiányát ellenőrzi; a közös `net` jogosultságokat nem módosítja. A [platform dokumentációja](https://supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16) szerint ezek visszavonása hatástalan lehet, illetve a működő pg_net hívásokat is megszakíthatja.

A Vault a titkot tároláskor titkosítja, de elküldés előtt a Bearer-érték rövid ideig a `net.http_request_queue` fejlécében is szerepel. Ezért minden, közvetlen adatbázis-bejelentkezésre jogosult szerepet megbízhatónak kell tekinteni; az új login szerepeket és a Data API sémakitettségének változását ismét át kell nézni. A cron önálló titka csak a szinkronizálás elindítására szolgál. [Supabase: a pg_net kérésekben tárolt fejlécek](https://supabase.com/docs/guides/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357)

A kizárólag postgres által futtatható `dispatch_google_calendar_sync()` csak akkor indít HTTP-kérést, ha van esedékes, szabadon feldolgozható sor aktív munkaterülethez és `connected` kapcsolathoz. A kérés `POST /api/google-calendar/cron`, külön Bearer-titokkal; sem Google-token, sem Supabase service-role kulcs nincs a cron parancsában. Üres sor miatt nincs percenkénti Vercel-hívás.

A cron SQL-futtatás sikere a HTTP-kérés sorba állítását jelenti. A tényleges HTTP-eredményt a `net._http_response` `status_code`, `timed_out`, `error_msg` mezői, a feldolgozási eredményt pedig az AlinFlow kapcsolati állapota mutatja. A kimenő `Authorization` fejléceket és Vault-értékeket ne másold ki hibakereséskor. A cronfeladat a Supabase Cron felületén külön szüneteltethető.

## API-térkép

| Végpont | Hitelesítés és szerep |
| --- | --- |
| `GET /api/google-calendar/status?workspaceId=…` | Supabase Bearer token; aktív munkaterületi tag állapotlekérdezése. |
| `POST /api/google-calendar/connect` | Supabase Bearer token; owner/admin; JSON: `workspaceId`, `email`. |
| `GET /api/google-calendar/callback` | Google-visszatérés; egyszer használható állapot, hosthoz kötött HttpOnly/Secure cookie és PKCE. |
| `POST /api/google-calendar/disconnect` | Supabase Bearer token; owner/admin; JSON: `workspaceId`; szüneteltetés. |
| `POST /api/google-calendar/sync` | Supabase Bearer token; aktív tag; JSON: `workspaceId`; a saját munkaterület feldolgozása. |
| `POST /api/google-calendar/cron` | Külön `GOOGLE_CALENDAR_CRON_SECRET` Bearer token; több munkaterület esedékes sorainak korlátozott feldolgozása. |

## Éles ellenőrzés

- Az OAuth-kliens visszatérési címe, a Vercel környezete, a kanonikus alkalmazáscím és a Vault-cím egyezik; a Calendar API engedélyezve van. A Google hozzájárulási állapota alkalmas a tervezett tartós használatra.
- A migráció után régi időpontok miatt nem jött létre szinkronizálási sor. Az új privát táblák és RPC-k böngészőből nem hozzáférhetők.
- A jóváhagyott fiókkal végzett összekapcsolás után a megfelelő munkaterület és naptár látszik. A próbához külön, nem valódi ügyfélnek küldő tesztrekord használható; a naptárteszt nem indíthat ügyfél-emailt.
- Egy új tesztidőpont egyszer jelenik meg, jó címmel és magyar helyi idővel. Módosítása ugyanazt az eseményt frissíti, lemondása/törlése csak azt távolítja el. Nincs meghívó vagy második visszaigazoló levél.
- Egy régebbi kézi esemény változatlan marad. Az újrapróbálás és az alkalmazás frissítése nem dupláz.
- Szüneteltetés alatt a sor várakozik; újraengedélyezés után feldolgozódik. Jogosultsághiba látható, az AlinFlow-időpont megmarad.
- Cron aktiválásakor bezárt AlinFlow mellett is feldolgozódik egy esedékes tesztsor. A cron és a HTTP-kérés eredményét külön ellenőrizni kell; üres sornál nem keletkezik új HTTP-kérés.
