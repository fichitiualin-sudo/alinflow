# Opcionális munkafotók – éles bekapcsolás

## Cél
A kiválasztott munkához telefonról is lehessen opcionálisan fényképet készíteni vagy képet feltölteni. Feltöltés előtt a böngésző legfeljebb 1920 pixeles, 500 kB alatti JPEG-et készít.

## Jelenlegi működés
Az éles verzió már munkaterületet és stabil `activeAppointmentId` munkaazonosítót használ. A korábbi helyi prototípust a `fb1fae9` verzióra célzottan visszük át; a régi főfájlokat nem állítjuk vissza.

## Megváltoztathatatlan szabályok
- A fénykép nem feltétele a dokumentumkészítésnek vagy lezárásnak.
- Meglévő időpont, árajánlat, munkalap és nyilatkozat megmarad.
- Csak az adott munkaterület aktív tagjai férhetnek hozzá a képekhez.
- Minden kép pontosan egy mentett munkához tartozik; dátummódosításkor is annál marad.
- Nem írunk felül vagy törlünk korábbi fényképet.

## Adatmodell
Új `work_photos` tábla: munkaterület, ügyfél, időpont, feltöltő, privát tárhelyútvonal, méret, képméret és történeti dátum/típus. Privát `work-photos` Storage bucket, 500000 bájtos JPEG korláttal. RLS a meglévő tagsági modellre épül. Fényképpel rendelkező ügyfél törlését még a kapcsolódó adatok törlése előtt, tranzakcióban meg kell akadályozni.

## Implementációs lépések
1. Élő séma olvasási auditja és exportált adatmentés a repón kívül.
2. Idempotens, additív SQL és visszaállítási útmutató.
3. Tömörítő, mentés/újrapróbálás és privát képbetöltés; stabil munkahatókör.
4. Mobilbarát opcionális fotópanel és célzott integráció.
5. Automatikus tesztek, típusellenőrzés, build, mobil/asztali próba.
6. Migráció, adatszám-ellenőrzés, Vercel preview és az engedélyezett éles kiadás ellenőrzése.

## Ellenőrzés
- `npx tsc --noEmit`
- `npm run build`
- Meglévő regressziós tesztek, célzott tárolási és SQL jogosultsági tesztek.
- Tömörítés, újrapróbálás, munkaváltás, privát előnézet, hiányzó munkaazonosító.
- Nincs gyökér `app/`, duplikált oldal vagy dokumentumfelülírás.

## Visszaállítás
Vercelben az előző kiadás visszaállítható; az additív fotótábla és bucket marad, így a feltöltött képek nem vesznek el. Élő fotóadatot rollback közben sem törlünk.

## Ellenőrzési eredmények
- Élő sémaaudit és 19 public tábla teljes sorainak exportja elkészült a repón kívül, a Letöltések mappába. Rekordszámok egyeznek: 612 ügyfél, 776 időpont, 504 dokumentum, 111 munkalap, 68 nyilatkozat.
- Adatmentés SHA256: `EF86A0FD4726A28F329391D6D1C1E9EAF00164B11BF04E2E587A9C4182DD962C`.
- `npx tsc --noEmit` és `npm run build`: sikeres. A build a projekt meglévő nyilvános Supabase URL-jével és publishable kulcsával futott, környezeti változóként; új éles változó nem szükséges.
- `npm test` helyi PGlite-tal: 119 sikeres, 0 hibás, 2 korábbi natív PostgreSQL-restaurálási teszt kihagyva (a szükséges helyi szerver nincs telepítve). A teljes natív restaurálási suite-ra nem állítunk sikert.
- `node tests/work-photos-sql.test.mjs`: 42 sikeres SQL/RLS ellenőrzés, aktuális munkaterületi modellel és scope triggerrel. A migráció ismételt futtatása is sikeres.
- Böngésző: munkák/cégek elkülönítése, mentetlen munka tiltása, ugyanazon azonosítójú újrapróbálás, háttérfeltöltés közbeni munkaváltás sikeres.
- Tömörítés: 4000×3000 teszt JPEG 12120970 bájtról 470913 bájtra, 1920×1440 méretre; EXIF-orientáció, metaadateltávolítás és hibás források elutasítása sikeres.
- Teljes munkaoldal 390 és 1366 pixeles szélességen ellenőrizve; nincs vízszintes túlcsordulás. Képelőnézet és Escape utáni fókuszvisszaadás működik.
- Nincs gyökér `app/`, egyetlen főoldal van: `src/app/page.tsx`.

## Módosított fájlok
`.gitignore`, `src/app/page.tsx`, `src/components/alinflow/WorkPagePanel.tsx`,
`src/components/alinflow/WorkPhotosPanel.tsx`, `src/lib/alinflow/types.ts`,
`src/lib/alinflow/photo-compression.ts`, `src/lib/alinflow/work-photos.ts`,
`docs/DATA_MODEL.md`, `docs/WORK_PHOTOS_PLAN.md`, `docs/sql/WORK_PHOTOS.sql`,
`tests/README.md`, `tests/work-photos.test.cjs`, `tests/work-photos-panel.test.cjs`,
`tests/work-photo-deletion.test.cjs`, `tests/work-photos-sql.test.mjs`.

## Kiadás
- A `WORK_PHOTOS.sql` 2026-09-13-án az éles Supabase-projekten kétszer sikeresen lefutott. Az összes korábbi tábla rekordszáma változatlan.
- Ellenőrizve: privát bucket, kizárólag JPEG, 500000 bájtos korlát; metadata RLS bekapcsolva; authenticated SELECT/INSERT engedett, UPDATE/DELETE és anon SELECT tiltott; 11 Storage policy; atomi törlő RPC elérhető.
- GitHub: [PR #94](https://github.com/fichitiualin-sudo/alinflow/pull/94), `codex/work-photos-release`.
- A Vercel preview sikeres (`8ce6ce3`, deployment `2ABzczugN4ww3CtE1nH5vwcsuv33`); bejelentkezés nélkül kizárólag a belépési oldal jelenik meg.
- Éles cél: `https://www.alinflow.hu/`. Az éles kiadás után a meglévő bejelentkezett munkamenettel ellenőrizzük a munkaoldalt és az üres fotógaléria betöltését. Valós ügyfélhez nem töltünk fel mesterséges tesztképet.
