# Automatikus Google Naptár-kapcsolat

## Cél

A munkaterülethez kapcsolt Google-fiók elsődleges naptárába automatikusan kerüljön be minden új AlinFlow-időpont. Az időpont módosítása ugyanazt az eseményt frissítse; lemondása csak a hozzá kapcsolt eseményt távolítsa el. Szerelés, felmérés és karbantartás egyaránt támogatott.

## Jelenlegi működés

A `CalendarPanel` kézi `+ Naptár` hivatkozást használ, a `calendar.ts` előre kitöltött Google-űrlapot készít. A `page.tsx` központi mentése a `save_appointment_with_resources`, a lemondás a `cancel_appointment_with_job_mirror` RPC-n keresztül történik. Az időpontoknak stabil, munkaterülethez kötött azonosítójuk van.

## Megváltoztathatatlan szabályok

- A Google hibája nem vonhatja vissza az AlinFlow-időpont mentését vagy az emailküldést.
- Csak a kapcsolt munkaterület és a jóváhagyott Google-fiók érintett.
- Meglévő, kézzel létrehozott Google-eseményhez nem nyúlunk; korábbi időpontokat nem töltünk át automatikusan.
- Az ügyfél nem kap újabb Google-meghívót; a munkatárs saját naptárbejegyzése készül, vendégek nélkül.
- Google-hitelesítési adat csak titkosítva, szerveroldalon tárolható, és soha nem szerepelhet a repóban vagy a böngészőnek visszaadott állapotban.
- Az összekapcsolás külön Google-jóváhagyást igényel. A saját naptár és az automatikus újrapróbálás csak az engedélyezett kapcsolat létrejötte után működik.

## Adatmodell

Idempotens migráció külön kapcsolattáblával, rövid életű OAuth-állapottal és tartós szinkronizálási sorral. Az időpont-triggerek tranzakcióban jelzik a szükséges frissítést. Egy munkaterület/időpont egy stabil Google-eseményazonosítót kap. A sor megőrzi a törölt időpont azonosítóját is, személyes tartalom nélkül. A feldolgozás foglalással, verzióellenőrzéssel és újrapróbálással védett.

## Implementációs lépések

1. Google eseményadatok és dátumkezelés közös, tesztelhető előállítása.
2. Kapcsolat, szinkronizálási sor és jogosultságok SQL-migrációja.
3. Szerveroldali Google OAuth, titkosított tokenkezelés és azonosítóval védett szinkronizálás.
4. Beállításokban kapcsolat és állapotjelzés; mentés után feldolgozásindítás, megnyitott alkalmazásban újrapróbálás.
5. Háttérfeldolgozás beállítása, hogy átmeneti hiba után bezárt alkalmazásnál is folytatódjon.
6. Tesztek, típusellenőrzés, build, mobil/asztali ellenőrzés, telepítés.
7. Google-hozzáférés konkrét jóváhagyása és a kapcsolat ellenőrzése.

## Ellenőrzés

- Esemény időzónája Europe/Budapest; helyes kezdés/vég és nyári/téli időszámítás.
- Újrapróbálás és párhuzamos feldolgozás nem dupláz; módosítás és lemondás azonos eseményt céloz.
- Más munkaterület/felhasználó nem olvashat tokent és nem változtathat kapcsolatot.
- Hiányzó/lejárt Google-jogosultság jól látható állapotot ad, az időpont megmarad.
- `npx tsc --noEmit`, `npm run build`, célzott tesztek.
- Valódi ügyfélnek tesztemailt vagy tesztmeghívót nem küldünk.

## Visszaállítás

A kapcsolat szüneteltetésével leállítható a szinkronizálás; az AlinFlow-időpontok és dokumentumok változatlanul megmaradnak. Az új táblák additívak. A korábbi kézi naptárgomb megmarad, amíg nincs aktív automatikus kapcsolat.

## Állapot

A kód éles kiadásban van, az idempotens migráció lefutott, a percenkénti háttérfeldolgozó aktív. A Google Cloud projekt/API/OAuth-kliens és a Vercel Production titkos változói elkészültek. A cron sikeresen futott; a Vaultból hitelesített éles HTTP-próba 200 választ és üres feldolgozást adott. A nyilvános adatkezelési tájékoztató közzétételét a felhasználó jóváhagyta. A Google Production állapot és a munkaterületi OAuth-összekapcsolás még hátravan. Beállított kapcsolat nélkül az új funkció inaktív, a kézi naptárgomb megmarad.

Ellenőrzések: a teljes tesztfutás 699 tesztből 697 sikeres és két korábban is kihagyott helyi SQL-teszt; hiba nincs. Az aktiválási javítások után a 71 naptárteszt külön is sikeres, az SQL-tesztek PGlite-on futottak. `npx tsc --noEmit` és `npm run build` sikeres (a helyi buildhez nem éles Supabase publikus helyőrző változókkal). A valódi beállítókomponens 390×844 és 1440×900 előnézete rendben. Nincs gyökérszintű `app/` vagy ütköző oldalútvonal.

Az éles Google-esemény létrehozása/módosítása/lemondása csak az összekapcsolás után ellenőrizhető. Telepítési lépések és környezeti változók: `docs/GOOGLE_CALENDAR_SETUP.md`.

## Módosított fájlok

- `src/app/page.tsx`
- `src/components/alinflow/CalendarPanel.tsx`
- `src/components/alinflow/SettingsPanel.tsx`
- `src/components/alinflow/LoginScreen.tsx`
- `src/components/alinflow/GoogleCalendarSettingsPanel.tsx`
- `src/components/alinflow/GoogleCalendarSync.tsx`
- `src/lib/alinflow/calendar.ts`
- `src/lib/alinflow/google-calendar-auth.ts`
- `src/lib/alinflow/google-calendar-event.ts`
- `src/lib/alinflow/google-calendar-sync.ts`
- `src/app/api/google-calendar/{connect,callback,status,disconnect,sync,cron}/route.ts`
- `src/app/adatvedelem/google-naptar/page.tsx`
- `docs/sql/GOOGLE_CALENDAR_SYNC.sql`
- `docs/sql/GOOGLE_CALENDAR_CRON.sql`
- `docs/GOOGLE_CALENDAR_SETUP.md`
- `docs/GOOGLE_CALENDAR_PRIVACY_REVIEW.md`
- `docs/GOOGLE_CALENDAR_SYNC_PLAN.md`
- `docs/EMAILS_AND_CALENDAR.md`
- `docs/SCREENS_AND_UX.md`
- `tests/google-calendar-{auth,client,event,routes,sql,sync}.test.cjs`
- `tests/action-cancellation.test.cjs`
- `tests/new-customer-quote-flow.test.cjs`
- `tests/regression.test.cjs`
