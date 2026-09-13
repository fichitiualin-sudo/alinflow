# Munkafotók törlése és egyszerűbb képkiválasztás

## Cél
A feltöltött képek mellett legyen Törlés gomb. Egyetlen Képek kiválasztása gomb maradjon; a külön fényképezőgomb és a tömörítési magyarázat eltűnik.

## Jelenlegi működés
A WorkPhotosPanel a work-photos tárhely és a work_photos metaadatok alapján mutatja a képeket. A jelenlegi jogosultságok csak a még nem mentett, saját feltöltés takarítását engedik.

## Megváltoztathatatlan szabályok
- Kizárólag a kiválasztott munkaterület, ügyfél és időpont adott képe törölhető.
- Más képek, dokumentumok és időpontok változatlanok maradnak.
- Először a Storage API távolítja el a fájlt; a metaadat csak igazolt fájleltávolítás után törölhető.
- Sikertelen vagy bizonytalan törlés újrapróbálható. A felület nem jelenthet hamis sikert.
- A felhasználó a konkrét kép törlését a felületen megerősíti.

## Adatmodell
Új mező nem szükséges. A WORK_PHOTOS.sql utáni idempotens migráció kiegészíti a munkafotók törlési jogosultságát és ellenőrzött metaadat-törlő függvényt biztosít. Csak az adott munkaterület aktív tagjai használhatják.

## Implementációs lépések
1. Célzott jogosultság-migráció és adattörlési segédfüggvény.
2. Képenkénti Törlés/Mégse megerősítés, várakozó és hibaállapot, galéria újratöltése.
3. Külön kameraelem és magyarázó mondat eltávolítása.
4. Típusellenőrzés, build, célzott adattárolási/jogosultsági tesztek és mobil/asztali böngészős ellenőrzés.
5. Ellenőrzött migráció és kód kiadása; éles felület ellenőrzése valódi képek törlése nélkül.

## Ellenőrzés
- npx tsc --noEmit
- npm run build
- Törlés csak helyes munkakörnyezetben, Storage-hiba, RPC-hiba, elveszett válasz és újrapróbálás.
- SQL jogosultságok, másik munkaterület, anon/inaktív tag, még létező objektum, ismételt migráció.
- Mobil/asztali nézet, megerősítés megszakítása, törlés utáni lapozás.

## Visszaállítás
A kód visszaállítható az előző kiadásra; a migráció meglévő adatokat nem töröl. A felhasználó által később megerősített képtörlés végleges.

## Módosított fájlok és lezárás
- Elkészült a képenkénti megerősített törlés, a megmaradó munkamenetben tárolt törlési zárolás, hibák után az újrapróbálás és törlés után a galéria/lapozás frissítése. Egyetlen képkiválasztó maradt, a külön kamera és a magyarázó mondat kikerült.
- Módosított termékfájlok: `src/components/alinflow/WorkPhotosPanel.tsx`, `src/lib/alinflow/work-photos.ts`.
- Migráció és dokumentáció: `docs/sql/WORK_PHOTO_DELETION.sql`, `docs/DATA_MODEL.md`, ez a terv.
- Tesztek: `tests/work-photos.test.cjs`, `tests/work-photos-panel.test.cjs`, `tests/work-photo-remove-sql.test.mjs`, `tests/README.md`.
- `npx tsc --noEmit` és `npm run build`: sikeres. `npm test`: 152 sikeres, 0 hibás; 2 korábbi natív PostgreSQL-restaurálási teszt kimaradt, mert a helyi szerver nincs telepítve.
- Új SQL/RLS suite: 20/20 sikeres, ismételt és CRLF-migrációval, másik munkaterülettel, inaktív/anon felhasználóval és még létező fájllal.
- Mobil (390 px) és asztali (1366 px) nézetben megerősítés/Mégse, törlés és az utolsó galériaoldal kiürülése ellenőrizve. Egyetlen file input, nincs capture input és nincs vízszintes túlcsordulás.
- Friss metaadat- és jogosultságmentés: a Letöltések mappában, a repón kívül. SHA256: `AE3802AA85FAF47EDF9ABB29635F7E8BC6545C14805FB30F80F5064069270343`.
- Az éles migráció 2026-09-13-án kétszer sikeresen lefutott. Ellenőrzött, változatlan darabszámok: 612 ügyfél, 776 időpont, 504 dokumentum, 111 munkalap, 3 munkafotó és 3 fotófájl. Privát bucket és RLS maradt; csak authenticated hívhatja a befejező RPC-t, közvetlen metadata DELETE továbbra is tiltott.
- Új környezeti változó nem szükséges. A törlési zárolás az adott böngésző munkamenetére vonatkozik; külön böngészőfülek feltöltési sorai egymástól függetlenek.
