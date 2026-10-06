# Visszahívandó érdeklődők térképe

## Cél
A visszahívandók földrajzi áttekintése településenként, névvel és érdeklődési klímával, közvetlen ügyfélmegnyitással. Elérés a Visszahívandó listából és a meglévő Térkép nézetből.

## Jelenlegi működés
A TaskPanel az időpont nélküli, Visszahívandó státuszú ügyfeleket mutatja. A meglévő MaintenanceMapPanel telepítési időpontok koordinátáit használja; ezek nem helyettesítik az érdeklődő települését. A Facebook-import várost és igényt ment, koordinátát nem.

## Megváltoztathatatlan szabályok
- Ugyanazok az ügyfelek legyenek a listában és a térképen; a térkép nem módosít ügyfelet, státuszt, dokumentumot vagy időpontot.
- A településszintű jelölő nem állíthat pontos lakcímet. Ismeretlen/hiányzó település külön, javítható listában marad.
- Egy településen több ügyfél nem takarhatja el egymást. A térképen minden szűrt település szerepel, a kapcsolódó lista tízesével lapozható.
- A meglévő karbantartási térkép és a főoldal betöltési sorrendje megmarad.

## Adatmodell
Nincs adatbázis-módosítás. A meglévő Customer.city/postalCode/need mezőkből olvasunk. A nyilvános magyar település-koordináták GeoNames-adatokból helyi, forrásmegjelöléssel ellátott állományba kerülnek. Az ügyféladatok helyben kapcsolódnak a térképhez; a térképszolgáltató csak szokásos térképcsempéket szolgál ki.

## Implementációs lépések
1. GeoNames magyar településadatok ellenőrzése és helyi kereshető index; biztonságos pontos név/irányítószám feloldás, csoportosítás és tesztek.
2. Elkülönített, csak megnyitáskor betöltődő Leaflet/OpenStreetMap térképpanel, keresés, településválasztás, hiányzó helyek, ügyfélmegnyitás.
3. Belépési pontok a meglévő Térkép nézetben és a visszahívandók listájában.
4. Típusellenőrzés, build, célzott regressziók, mobil/asztali próba és éles kiadás ellenőrzése.

## Ellenőrzés
- Visszahívandó, időponttal rendelkező, lezárt és lemondott ügyfelek helyes szűrése.
- Ékezetek/kisbetűk, azonos település több érdeklődővel, hibás vagy hiányzó település, változó státusz.
- Jelölőről ügyfélmegnyitás, lista lapozása, keresés, visszalépés, meglévő karbantartási térkép.
- npx tsc --noEmit; npm run build; szükséges tesztek; 390px és asztali elrendezés.

## Visszaállítás
A felületi változás visszavonható adatbázis-visszaállítás nélkül; a tárolt ügyféladatok változatlanok.

## Módosított fájlok
- `src/app/page.tsx` – lusta térképbetöltés és térképfülek, ügyfélmegnyitás/visszalépés.
- `src/components/alinflow/TaskPanel.tsx` – Térképen belépési pont.
- `src/components/alinflow/CallbackMapPanel.tsx`, `CallbackMapPanel.css` – térkép, keresés, településszűrő, számozott jelölők és lapozott ügyféllista.
- `src/lib/alinflow/callback-map.ts`, `callback-town-data.ts` – pontos névegyezésen alapuló csoportosítás és nyilvános településadatok.
- `scripts/generate-callback-towns.cjs` – megismételhető nyilvánosadat-generálás, forrás-/licencellenőrzés.
- `tests/callback-map.test.cjs` – szűrés, településfeloldás, csoportosítás, keresés és bemeneti adatok megőrzése.
- `package.json`, `package-lock.json` – Leaflet 1.9.4 és típusai.
- `docs/SCREENS_AND_UX.md`, ez a terv – működés és ellenőrzések.

## Eredmény és ellenőrzés – 2026-10-07
- Elkészült a kért nézet, mindkét belépési ponttal. Nincs migráció vagy új környezeti változó.
- 3131 magyar település helyi koordinátája: [GeoNames HU](https://download.geonames.org/export/zip/HU.zip), CC BY 4.0, 2026-10-07-i letöltés. A generált fájl tartalmazza az archívum és a szöveg SHA-256 lenyomatát. A 24, csak alacsony pontosságú forrással rendelkező település az ismeretlen helyek között marad; nem találgatjuk a címet.
- A 20, postai forrásban azonos pontra került település helyét a [GeoNames településjegyzék](https://download.geonames.org/export/dump/HU.zip) egyértelmű, pontos névegyezésű lakotthely-rekordjai pontosítják; az azonosítók és forráslenyomatok szintén az adatfájlban vannak. A helyes ékezetes nevek elsőbbséget kapnak, így például Komló és Kömlő külön település marad.
- [OpenStreetMap térképcsempék](https://operations.osmfoundation.org/policies/tiles/): normál böngészős gyorsítótár és Referer, látható forrásmegjelölés, csak megnyitott nézet, nincs tömeges/előzetes letöltés. Az ügyfél neve, igénye és címe nem kerül térképszolgáltatói keresésbe.
- `npx tsc --noEmit`: sikeres. `npm run build`: sikeres, a projekt meglévő nyilvános Supabase-beállításaival.
- Teljes tesztcsomag, SQL-tesztekhez PGlite-tal: 426 sikeres, 2 meglévő kihagyott teszt, 0 hiba. Ebből 10 új térképes eset.
- Valódi Home komponens mesterséges ügyféladatokkal, 390 és 1366 px széles böngészős keretben: nincs vízszintes túlcsordulás, térképcsempék és jelölők betöltődnek. 16 visszahívandó, 3 település, 2 nem jelölhető ügyfél; 12 azonos településű ügyfél közös jelölőn.
- Kézzel ellenőrizve: jelölő kiválasztása, név/település/klíma keresése és üres találat, 10 soros lapozás, ismeretlen helyek, ügyfél megnyitása és visszalépés. A Telepített klímák fül a korábbi panelt nyitja. A betöltési próba egyetlen kezdő betöltést és 0 futási hibát jelzett.
- A térkép hozzávetőleges településhelyet ad; utcaszintű geokódolás nem része ennek a módosításnak. Helyi CSP-vel tiltott térképcsempéknél külön ellenőrizve: érthető hibajelzés, újrapróbálás és ügyfélmegnyitás működik, 0 futási hiba.
