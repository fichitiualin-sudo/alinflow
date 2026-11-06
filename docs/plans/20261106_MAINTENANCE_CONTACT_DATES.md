# Karbantartási elutasítás és telefonhívás dátuma

## Cél
A „Nem kéri a karbantartást” jelölés mellett készülékenként megjelenik a jelölés időpontja. A Telefonos jegyzet részen a hívás dátuma is látható; a hívásgomb megnyomása hívásindításként naplózódik, korábbi hívás kézzel rögzíthető.

## Jelenlegi működés
A karbantartási választások központi, megosztott rekordban vannak, de az updated_at egy másik készülék módosításakor is változik. A hagyományos ügyféloldali hívásgomb dokumentumbejegyzést ír; a térképes és egyeztető hívásgomb még nem naplóz. A telefonos jegyzet szerkeszthető szabad szöveg.

## Megváltoztathatatlan szabályok
- A másik készülék jelölése nem írja át a korábbi jelölés dátumát.
- Ismeretlen régi dátumot nem találunk ki.
- A hívásindítás nem jelent sikeres beszélgetést, megrendelést vagy karbantartást.
- A meglévő jegyzetszöveg, dokumentumok, időpontok és megosztási jogosultságok megmaradnak.
- A partner csak a ténylegesen engedélyezett telepítéshez rögzíthet hívást; a hívás nem hoz létre ügyfélmásolatot.

## Adatmodell
Additív dátummezők a maintenance_contact_preferences táblában: declined_at és declined_device_dates. Szerveroldali trigger őrzi a változatlan készülékek dátumát; a meglévő RPC-k a dátumokat is visszaadják.

Külön, hozzáfűzhető customer_phone_calls napló őrzi a hívások időpontját és az indítás/kézi rögzítés különbségét. Szűkített RPC-k ellenőrzik az ügyfél munkaterületét vagy a pontos partneri megbízást. A Telefonos jegyzeten belül a napló a szerkeszthető szövegtől külön jelenik meg, ezért egy régi jegyzetmentés nem törli a hívásokat.

## Implementációs lépések
1. Jelenlegi séma és függvények csak olvasási ellenőrzése.
2. Idempotens migrációk, célzott SQL-jogosultsági és dátummegőrzési tesztek.
3. Dátumok megjelenítése ügyfélnél és térképen; hívásgombok bekötése, kézi dátumrögzítés.
4. Típusellenőrzés, build, releváns regressziók és mobil/asztali vizuális ellenőrzés.
5. Biztonsági mentés, migrációellenőrzés, szokásos PR/Vercel kiadás, éles csak olvasási ellenőrzés.

## Ellenőrzés
- Készülékenkénti pipa ki/be, másik készülék módosítása, teljes tiltásra összevonás.
- Régi dátum nélküli rekord, örökölt teljes tiltás, partneri egyező dátum.
- Hívásgomb és kézi korábbi dátum, frissítés utáni visszatöltés, ismételt kérés duplikációvédelme.
- Más munkaterület és visszavont/nem megfelelő partner hozzáférésének elutasítása.
- npx tsc --noEmit; npm run build; célzott és teljes automatizált tesztek.

## Visszaállítás
Az előző frontend visszaállítható, az új napló és dátummezők adatvesztés nélkül megmaradnak. Éles adatot nem törlünk. A privát séma/adat mentés és a függvényexport a kiadás előtt elkészül.

## Módosított fájlok és eredmények
- `src/app/page.tsx`: hívásnapló betöltés és mentés, dátum visszatöltés, munkamenetvédelem.
- `src/components/alinflow/LeadPanel.tsx`, `WorkPagePanel.tsx`, `SharedMaintenanceDialog.tsx`: telefonos jegyzetbe illesztett napló.
- `src/components/alinflow/CallbackMapPanel.tsx`, `MaintenanceMapPanel.tsx`, `src/lib/alinflow/map-popup-actions.ts`: térképes Hívás naplózása, eredeti tel link megtartása.
- `src/components/alinflow/MaintenanceChoiceControls.tsx`, `src/lib/alinflow/maintenance-contact-choice.ts`: visszautasítási dátum DTO, megjelenítés és ellenőrzés.
- `src/components/alinflow/PhoneCallNotes.tsx`, `usePhoneCallLog.ts`, `src/lib/alinflow/phone-calls.ts`, `phone-calls-client.ts`: hívásnapló, kézi dátumbevitel, Budapest-időzóna, duplikáció- és munkamenetvédelem.
- `docs/sql/20261106_MAINTENANCE_DECLINE_DATES.sql`, `20261106_CUSTOMER_PHONE_CALLS.sql` és a két `VERIFY_` fájl: idempotens adatbázisváltozás és ellenőrzés.
- `docs/DATA_MODEL.md`, ez a terv: adatmodell és kiadás dokumentálása.
- Új tesztek: `maintenance-decline-dates-sql.test.mjs`, `maintenance-refusal-dates.test.cjs`, `map-phone-call-actions.test.cjs`, `phone-call-log-lifecycle.test.cjs`, `phone-calls-sql.test.mjs`, `phone-calls.test.cjs`.
- Meglévő komponenspróbák illesztése: `maintenance-contact-choice.test.cjs`, `maintenance-device-preferences.test.cjs`, `partial-maintenance-history.test.cjs`, `shared-maintenance-customer-history.test.cjs`.

Ellenőrzés: teljes JavaScript-tesztcsomag 1466 sikeres / 0 hibás / 8 opcionális SQL-próba kihagyva; ezt követően a forrástelepítés-feloldás három új próbája és a hívásnapló célzott 20 tesztje is sikeres. Külön PostgreSQL/PGlite: 12 visszautasítási dátum- és 9 hívásnapló-regressziócsoport sikeres. TypeScript és build sikeres. Asztali és 390×844 mobilnézetben, szintetikus adatokkal ellenőrizve; kézi dátum bekerül, üres dátum nem menthető. Ideiglenes előnézeti útvonal eltávolítva.

Privát adatbázismentés elkészült és visszaolvasási listával ellenőrizve. Az éles sémán mindkét migráció kétszer lefutott egy visszagörgetett próba-tranzakcióban; 13 üzleti tábla régi mezőinek tartalma változatlan. Éles teszthívás, valódi pipaátállítás, számla vagy email nem készült. Új környezeti változó nem szükséges.
