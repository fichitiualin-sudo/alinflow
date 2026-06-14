# AlinFlow – Codex útmutató

> Ez a fájl rövid térkép. A részletes üzleti és technikai szabályok a `docs/` mappában vannak.
> Utolsó felülvizsgálat: 2026-06-14.

## 1. A projekt célja

Az AlinFlow egy Next.js + TypeScript + Supabase alapú, klímaszerelési munkafolyamatra készült CRM.
A fő folyamat:

`érdeklődő → opcionális felmérés → árajánlat → szerelési időpont → telepítés → adminisztratív lezárás → ismétlődő karbantartások`

A rendszer elsődleges használója terepen és mobilon dolgozik. Minden változtatásnál az egyszerűség, gyorsaság és adatbiztonság az első.

## 2. Kötelező projekt-szabályok

1. A projekt **`src/app` struktúrát használ**.
2. **Soha ne hozz létre gyökérszintű `app/` mappát vagy `app/page.tsx` fájlt.**
3. Csak a feladathoz szükséges fájlokat módosítsd.
4. Ne formázd újra és ne írd át a nem érintett fájlokat.
5. Ne törölj meglévő működést vagy adatot külön kérés nélkül.
6. Ne cserélj le teljes fájlt régebbi változatra.
7. Módosítás előtt olvasd el az érintett fájlt és a kapcsolódó típusokat.
8. Új mezőnél ellenőrizd a TypeScript típust, Supabase leképezést, mentést, visszatöltést és UI-megjelenítést.
9. Adatbázis-migráció legyen idempotens: többször futtatva se okozzon hibát.
10. Ne tegyél titkot, jelszót, Supabase service-role kulcsot vagy személyes adatot a repóba.

## 3. Minden módosítás után

Futtasd:

```bash
npx tsc --noEmit
npm run build
```

Ha a build csak hiányzó környezeti változó miatt áll meg, ezt külön jelezd; ne állítsd, hogy a teljes build sikeres volt.

Ellenőrizd továbbá:

- nincs-e új gyökér `app/` mappa;
- nincs-e duplikált `page.tsx`;
- a meglévő Supabase adatok visszatöltődnek-e;
- mobilon és asztali nézetben nem csúszott-e szét a felület;
- az új funkció nem írja-e felül a korábbi dokumentumokat vagy időpontokat.

## 4. Üzleti szabályok – röviden

- A felmérés opcionális és az árajánlat előtt történik.
- Felmérés után a következő lépés az árajánlat.
- A karbantartás csak telepítés után értelmezhető, és lezárt ügyfélnél is elérhető.
- Egy ügyfélhez korlátlan számú karbantartás és karbantartási munkalap tartozhat.
- A karbantartás nem írhatja felül a szerelési időpontot, árajánlatot, szerelési munkalapot vagy nyilatkozatot.
- Karbantartási időpont lemondása csak az adott karbantartást mondja le; az ügyfél és a telepítés marad.
- Munkalap és vásárlási nyilatkozat csak tényleges aláírás után számít elkészültnek.
- Alternatív árajánlatnál a tételek nem adódnak össze.
- Listák alapértelmezett oldalmérete 10 tétel.

Részletek: [`docs/BUSINESS_LOGIC.md`](docs/BUSINESS_LOGIC.md)

## 5. Fő forrásfájlok

- `src/app/page.tsx` – központi állapot, Supabase betöltés/mentés, nézetváltás és folyamat-orchestration.
- `src/components/alinflow/LeadPanel.tsx` – ügyféladatok, státuszkezelés, fő műveletek.
- `src/components/alinflow/QuoteBuilderPanel.tsx` – ajánlat összeállítása.
- `src/components/alinflow/QuotePreviewPanel.tsx` – ajánlat előnézete.
- `src/components/alinflow/SchedulePanel.tsx` – időponttípus, dátum és idő kiválasztása.
- `src/components/alinflow/WorkPagePanel.tsx` – telepítési/karbantartási munkaoldal, dokumentumok, lezárás.
- `src/components/alinflow/WorkReportPanel.tsx` – szerelési vagy karbantartási munkalap.
- `src/components/alinflow/CalendarPanel.tsx` – naptár.
- `src/components/alinflow/WarehousePanel.tsx` – raktár.
- `src/lib/alinflow/types.ts` – közös TypeScript típusok.
- `src/lib/alinflow/constants.ts` – státuszok, alapértékek.
- `src/lib/alinflow/appointments.ts` – időponttípusok, időtartamok és ütközés.
- `src/lib/alinflow/products.ts` – ajánlati tételek és árlogika.
- `src/lib/alinflow/work-report.ts` – munkalap-segédfüggvények.
- `src/app/api/` – emailküldő route-ok.

Részletes térkép: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## 6. Dokumentációs térkép

- [`docs/README.md`](docs/README.md) – dokumentációs kezdőlap.
- [`docs/PRODUCT_OVERVIEW.md`](docs/PRODUCT_OVERVIEW.md) – termékcél és alapelvek.
- [`docs/BUSINESS_LOGIC.md`](docs/BUSINESS_LOGIC.md) – teljes ügyfél-életút.
- [`docs/SCREENS_AND_UX.md`](docs/SCREENS_AND_UX.md) – képernyők és mobil sorrend.
- [`docs/DOCUMENTS.md`](docs/DOCUMENTS.md) – dokumentumtár, munkalapok, lezárás.
- [`docs/EMAILS_AND_CALENDAR.md`](docs/EMAILS_AND_CALENDAR.md) – email- és Google Naptár-szabályok.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) – jelenlegi adattípusok és táblák.
- [`docs/TEST_CHECKLIST.md`](docs/TEST_CHECKLIST.md) – kötelező regressziós ellenőrzés.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) – elfogadott termékdöntések.
- [`docs/MULTICOMPANY_PLAN.md`](docs/MULTICOMPANY_PLAN.md) – későbbi többcéges terv; jelenleg nem megvalósítandó.
- [`PLANS.md`](PLANS.md) – nagyobb fejlesztések végrehajtási tervének sablonja.

## 7. Codex munkamód

Kis módosításnál:

1. azonosítsd a legkisebb érintett fájlkört;
2. olvasd el a kapcsolódó dokumentációt;
3. implementálj célzottan;
4. futtasd a típusellenőrzést és buildet;
5. sorold fel kizárólag a módosított fájlokat és az ellenőrzések eredményét.

Nagy vagy adatmodellt érintő módosításnál előbb készíts végrehajtási tervet a `PLANS.md` szerint. Ne kezdj többcéges átalakításba külön jóváhagyás nélkül.
