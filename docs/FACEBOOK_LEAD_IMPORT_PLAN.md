# Facebook-érdeklődők automatikus importja

## Cél

A KLIMAlin Facebook Lead Ads jelentkezései névvel, telefonnal, emaillel, településsel és a hirdetett klímával jelenjenek meg az AlinFlow-ban. Az új ügyfél visszahívandó; az ismételt érdeklődés külön látható marad. A még elérhető korábbi jelentkezések kézzel indítható beolvasással pótolhatók.

## Jelenlegi működés

Csak CSV-import működik (`lead-import.ts`, `CustomerPanels.tsx`, `src/app/page.tsx`). A négy klíma hirdetése közös, négymezős Meta-űrlapot használ; a klímát ezért pontos hirdetésazonosító alapján kell hozzárendelni. Nincs webhook, tartós Meta-azonosító vagy szerveroldali kapcsolat.

## Megváltoztathatatlan szabályok

- A meglévő ügyfelek mezői, ajánlatai, dokumentumai és időpontjai importkor nem változnak.
- Ugyanaz a Meta-jelentkezés párhuzamos vagy ismételt kézbesítéskor is csak egyszer kerül be.
- Az érdeklődés nem hoz létre ajánlatot vagy készletfoglalást, és nem küld ügyfélnek üzenetet.
- A hirdetéshez nem párosított klímát nem találgatjuk; az érdeklődés ettől még megmarad.
- Token és alkalmazástitok kizárólag a szerveren lehet. A webhook munkaterületét szerverbeállítás határozza meg.

## Adatmodell

Új `facebook_lead_imports` napló tárolja a jelentkezés pillanatképét, Meta-azonosítóit, ügyfélkapcsolatát és feldolgozási állapotát. Az egyedi munkaterület/oldal/lead kulcs és a tranzakciós import-RPC megakadályozza a duplikációt. Csak aktív munkaterületi tag olvashatja; importálni csak a szerver jogosult. Többértelmű ügyfélegyezés kézi ellenőrzésre kerül. Külön, tagságot ellenőrző művelet jelöli feldolgozottnak a beérkezést.

A migráció additív és idempotens. Éles futtatása előtt friss sémaaudit és mentés szükséges. Régi ügyféladatot nem migrálunk és nem írunk felül.

## Implementációs lépések

1. Meta-oldal, űrlap, hirdetésazonosítók és elérhető hozzáférések ellenőrzése.
2. Naplótábla, jogosultságok, tranzakciós import és SQL-regressziós tesztek.
3. Szerveroldali Graph API kliens, mezőleképezés, aláírás-ellenőrzött webhook, hitelesített kapcsolatállapot és korábbi jelentkezések beolvasása.
4. Facebook-beérkezések megjelenítése településsel és klímával, ügyfélmegnyitással és feldolgozás jelölésével.
5. Típusellenőrzés, build, regressziós és mobil/asztali ellenőrzés.
6. Éles sémaaudit/mentés után migráció, szerverbeállítások, Meta-feliratkozás és ellenőrzött tesztkézbesítés, amennyiben az ehhez szükséges hozzáférés rendelkezésre áll.

## Ellenőrzés

- `npx tsc --noEmit`, `npm run build`, teljes meglévő tesztcsomag.
- Hibás aláírás, másik oldal/űrlap, lejárt token, hibás Meta-válasz, lapozás és időkorlát.
- Dupla kézbesítés és párhuzamos import, ismételt érdeklődés, bizonytalan kontakt-egyezés, RLS és tiltott közvetlen írás.
- Klíma és település megjelenése, régi ügyfél változatlansága, mobil és asztali nézet.
- Nincs új gyökérszintű `app/`, duplikált oldal vagy ügyfélnek kiküldött tesztüzenet.

## Visszaállítás

A Meta-oldal feliratkozása és a szerverkapcsolat letiltható. Az új napló és a már importált ügyfelek megmaradnak; a kód visszaállítása nem igényel adattörlést. Migráció közbeni hiba esetén a tranzakció visszagörget.

## Módosított fájlok

- `src/app/page.tsx`
- `src/components/alinflow/CustomerPanels.tsx`, `LeadPanel.tsx`, `FacebookLeadsPanel.tsx`
- `src/lib/alinflow/facebook-leads.ts`, `facebook-leads-server.ts`, `facebook-leads-auth.ts`, `facebook-leads-client.ts`
- `src/app/api/facebook-leads/webhook/route.ts`, `status/route.ts`, `sync/route.ts`
- `docs/sql/FACEBOOK_LEAD_IMPORT.sql`
- `tests/facebook-leads.test.cjs`, `facebook-leads-api.test.cjs`, `facebook-leads-client.test.cjs`, `facebook-leads-sql.test.cjs`
- `docs/FACEBOOK_LEAD_IMPORT_PLAN.md`, `FACEBOOK_LEAD_IMPORT.md`, `DATA_MODEL.md`, `BUSINESS_LOGIC.md`, `SCREENS_AND_UX.md`

## Tervlezárás

- Elkészült a védett webhook, a Graph API-visszaolvasás, a munkaterülethez kötött importnapló, a duplikációvédelem, a megszakítható korábbi beolvasás és a Facebook-panel. A háttérfrissítés megőrzi a folyamatban lévő szerkesztést.
- Típusellenőrzés és production build sikeres. A teljes tesztcsomag: 414 teszt, 412 sikeres, 2 korábban is kihagyott, 0 hiba. Ebből 17 adatbázis-, 27 backend- és 11 kliensellenőrzés tartozik az új funkcióhoz.
- Helyi, mesterséges adatokkal végzett böngészős ellenőrzés: 390 px mobil és 1366 px asztali nézet; nincs vízszintes túlcsordulás, működik a lapozás, feldolgozásjelölés, beolvasás és munkaterületváltás. Nincs új gyökérszintű `app/` vagy duplikált `page.tsx`.
- 2026-10-06: friss, csak olvasási éles sémaaudit igazolta a szükséges oszlopokat, a nullable `customers.created_by` mezőt és az új tábla hiányát. A 24 publikus tábla teljes adatpillanatképe és a publikus séma leírása letöltve: `Supabase Snippet Untitled query (7).csv`, 15106787 bájt. Minden payload JSON-ként visszaolvasható; SHA256: `2AD2DA96DCBA61E46F2483AA40181652BD6060D774FEA8E8C43B63B00E16555A`. A mentés a helyi Letöltések mappában van, nem a repóban. Nem tartalmaz Storage-fájlmentést vagy auth-séma-exportot; ezekhez a migráció nem nyúl.
- Az éles `FACEBOOK_LEAD_IMPORT.sql` migráció sikeres. Ellenőrzés után is 601 ügyfél, 706 ajánlat, 559 dokumentum, 786 időpont és 122 munkalap van. Az új napló üres; RLS aktív, anonim olvasás és kliensoldali import/írás tiltva, a szűk szerveres azonosító-olvasás és az import-RPC engedélyezett.
- Igazolt Meta-űrlap: `1841834370148047`, oldal: `107990632370445`; a négy hirdetés párosítása az üzemeltetési útmutatóban szerepel.
- Az automatikus éles kézbesítés még nem aktív és nincs igazolva. A Meta meglévő Marketing API alkalmazása további lead-hozzáférést igényel. Az „Add use cases” lépést az automatikus jóváhagyási ellenőrzés új hozzáférés lehetséges létrehozása miatt leállította; az engedélyezéshez felhasználói jóváhagyás szükséges. Titok vagy Page token nem került a repóba vagy klienskódba.
- A szükséges éles környezeti változók, a két Meta-feliratkozás és az aktiválási próba pontos menete: `docs/FACEBOOK_LEAD_IMPORT.md`. App Review és hozzáférési feltételek a Meta-felületen még ellenőrizendők. A PGlite párhuzamossági teszt nem helyettesít két külön PostgreSQL-kapcsolatot; a tranzakció az éles adatbázisban munkaterület-sorzárat használ.
