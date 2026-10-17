# Időpontok időtartama és elérhetősége

## Cél
Karbantartás 1 óra; szerelés 1 klíma 3 óra, 2 klíma 6 óra, 3+ klíma 9 óra. Foglalt intervallumba nyúló kezdések ne jelenjenek meg.

## Jelenlegi működés
A közös helper az egyéb munkát kivéve 3 órával számol. Natív időmezők bármilyen kezdést engednek kiválasztani; a mentés ellenőrzi az átfedést. Az email időszámításához nem jutnak el a tételek.

## Megváltoztathatatlan szabályok
Nincs tömeges adatváltozás, valódi tesztidőpont vagy email. Extra tételek nem növelik a klímák számát. Csak a szerkesztett időpont marad ki az ütközésből, más munka ugyanannál az ügyfélnél foglal. Lemondott munka nem foglal.

## Adatmodell
Nincs migráció vagy új mező. Időtartam számítása típusból és mennyiségből. Dokumentált felmérés és egyéb munka 1 órás.

## Implementáció
1. Közös időtartam és 5 perces szabad kezdések, teljes intervallum ellenőrzése.
2. Közös választó normál és naptári időpontfelvételhez; foglalt idő nem opció, érvénytelen kiválasztás nem menthető.
3. Email és Google időtartamok egyezése. Munkaoldali klímamennyiség növelésénél ütközésvédelem.
4. Dokumentáció, célzott és teljes regresszió, TypeScript, build, mobil/asztali ellenőrzés.

## Ellenőrzés
- TypeScript: sikeres (`npx tsc --noEmit`).
- Production build: sikeres szintetikus Supabase buildkörnyezettel; nincs hiányzó változó miatti hiba.
- Teljes tesztsor: 1304 eset, 1302 sikeres, 2 környezetfüggő kihagyás, 0 hiba.
- További 6 valós React-render teszt: sikeres (a teljes futás indítása után készült tesztfájl).
- Nincs gyökér app/ vagy duplikált fő page.tsx. Új adatmező nincs, a meglévő betöltési/persistence regressziók sikeresek.
- Éles kiadás és mobil/asztali böngészős ellenőrzés következik.

## Módosított fájlok
- src/lib/alinflow/appointments.ts, schedule.ts
- src/components/alinflow/AppointmentTimePicker.tsx, SchedulePanel.tsx
- src/app/page.tsx, src/app/api/send-appointment/route.ts
- tests/appointment-availability.test.cjs, appointment-scheduling-flow.test.cjs, appointment-time-picker.test.cjs, appointment-email-duration.test.cjs
- tests/google-calendar-event.test.cjs, google-calendar-sync.test.cjs, other-appointments.test.cjs
- tests/maintenance-map-persistence.test.cjs, new-customer-quote-flow.test.cjs, regression.test.cjs (új közös guard bekötése a meglévő tesztkörnyezetekbe)
- docs/BUSINESS_LOGIC.md, docs/SCREENS_AND_UX.md, ez a terv.

## Korlátok
A betöltött naptárból szűrünk, mentés előtt újra ellenőrzünk. Nincs atomi adatbázis-intervallumzár a külön eszközökön teljesen egyidejű foglalásokra. Meglévő Google események végideje normál szerkesztéskor frissül, tömeges resync nincs.

## Visszaállítás
Commit visszavonása. Nincs migráció vagy új környezeti változó.
