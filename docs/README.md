# AlinFlow dokumentáció

Ez a mappa az AlinFlow üzleti és technikai működésének forrása. A kód és a dokumentáció eltérése hibának számít.

## Olvasási sorrend

1. [`PRODUCT_OVERVIEW.md`](PRODUCT_OVERVIEW.md)
2. [`BUSINESS_LOGIC.md`](BUSINESS_LOGIC.md)
3. [`ARCHITECTURE.md`](ARCHITECTURE.md)
4. Adatbázis-munka előtt: [`DATA_MODEL.md`](DATA_MODEL.md) és [`SUPABASE_SCHEMA_AUDIT.md`](SUPABASE_SCHEMA_AUDIT.md)
5. Az adott feladathoz tartozó témadokumentum
6. [`TEST_CHECKLIST.md`](TEST_CHECKLIST.md)

## Dokumentációs elv

- Az `AGENTS.md` csak térkép és kötelező szabálylista.
- A részletes tudás itt található.
- Minden üzleti logika módosításakor a kapcsolódó dokumentumot is frissíteni kell.
- Bizonytalan vagy még nem végleges működést `NYITOTT` jelöléssel kell megadni; nem szabad találgatással véglegesíteni.

## Aktuális állapot

Az AlinFlow 1.0 véglegesítése folyamatban van. A többcéges működés külön jövőbeli projekt, amelyet csak a jelenlegi egycéges rendszer stabilizálása és teljes mentése után szabad elkezdeni.

Az élő Supabase-séma 2026-06-14-én, csak olvasási lekérdezésekkel fel lett mérve. Az audit pillanatképe és az újrafuttatható ellenőrző SQL a [`SUPABASE_SCHEMA_AUDIT.md`](SUPABASE_SCHEMA_AUDIT.md) dokumentumban található.
