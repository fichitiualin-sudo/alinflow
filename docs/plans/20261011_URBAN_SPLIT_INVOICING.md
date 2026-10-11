# Urbán Klíma – külön készülék- és munkadíjkibocsátó

## Cél

A felhasználó pontosította az Urbán számlázását: készülék és anyag a meglévő közös készülékkibocsátótól, munkadíj a saját vállalkozás Számlázz.hu-fiókjából. A kézi naptármentés fejlécében megjelenő magyarázó mondat törlendő.

## Jelenlegi működés

A fő munkaterület két meglévő kulccsal számláz. A másodlagos munkaterület korábban csak összevont számlára kapott engedélyt. A globális munkadíjkulcs, áfakulcs és számlaelőtag nem osztható meg az új munkaterülettel.

## Megváltoztathatatlan szabályok

- A fő munkaterület kulcsai, áfája és előtagjai változatlanok.
- A másodlagos munkaterület munkadíja és karbantartása csak a saját kulcsát használhatja; nincs visszaesés más vállalkozás kulcsára vagy előtagjára.
- A külön számlázásra konfigurált munkaterület összevont számlája akkor is tiltott, ha még szerepel a régi összevont engedélylistában.
- A hitelesítés, tagság, ügyfél- és időpontellenőrzés változatlan.
- Titok nem kerül kódba, dokumentációba, naplóba vagy ügyféloldali beállításba.
- Próba során nem készül valódi számla és nem indul email.

## Adatmodell és konfiguráció

Nincs adatbázis-migráció. A meglévő számlázási mód `split`. Új szerveroldali beállítások: `SZAMLAZZ_SPLIT_WORKSPACE_ID`, `SZAMLAZZ_SPLIT_LABOR_AGENT_KEY`, `SZAMLAZZ_SPLIT_LABOR_VAT_KEY`, opcionálisan `SZAMLAZZ_SPLIT_LABOR_INVOICE_PREFIX`. A készülék a meglévő készülékkibocsátó beállításait használja.

A vállalkozás megnyitott Számlázz.hu alapbeállításában az alapértelmezett áfakulcs AAM; ezt ellenőriztük, nem a KATA megnevezésből következtettük.

## Implementációs lépések

1. Szerveroldali kibocsátóprofil feloldása egyszer, majd kulcs, áfa és előtag átadása az XML-generálásnak.
2. Célzott regressziós tesztek: fő munkaterület változatlan, másodlagos készülék közös, munkadíj saját, hiányos konfiguráció és összevont számla tiltott.
3. A kért naptárfejléc-mondat eltávolítása, kézi hivatkozás megtartása.
4. TypeScript és build, Vercel-előnézet. Csak elkészült javítás után a szükséges új hozzáférés jóváhagyása és titkos éles beállítása.
5. Éles telepítés, munkaterületi számlázási mód és visszatöltés ellenőrzése valódi számla nélkül.

## Ellenőrzés

- Hálózat nélküli számlázási/API-hitelesítési/adatvédelmi tesztek.
- `npx tsc --noEmit`, `npm run build`; hiányzó helyi környezet külön jelzendő.
- Naptár mobilon és asztalon, meglévő ügyfelek/időpontok változatlanok.

## Visszaállítás

A másodlagos profil engedélyének kikapcsolása és újratelepítés. Nem írjuk át a fő kibocsátó kulcsait vagy már kiállított számlákat.

## Módosított fájlok

- `src/app/api/create-invoice/route.ts`
- `src/components/alinflow/CalendarPanel.tsx`
- Célzott számlázási tesztek és ez a terv.

## Elkészült ellenőrzések

A kibocsátóprofil és a naptármondat eltávolítása elkészült. 59/59 célzott számlázási/API-hitelesítési/adatvédelmi teszt sikeres; a TypeScript-ellenőrzés sikeres. A helyi build fordítása és TypeScript-lépése sikeres, az oldaladatok gyűjtése hiányzó helyi Supabase-környezet miatt leállt. A végső Vercel-telepítés és az éles aktiválás állapota a kapcsolódó PR-ban követhető.

A megnyitott másodlagos számlázói fiókhoz jelenleg nincs Agent-kulcs. A forrás és az előnézeti build ellenőrzése után külön jóváhagyandó az új kulcs létrehozása és titkos szerveroldali tárolása. A kulcs nem jár le automatikusan és teljes Számla Agent-jogosultságot ad. A szolgáltató használati díjat a ténylegesen létrehozott bizonylatok alapján számít fel; kulcsgeneráláskor nem választunk előfizetést és tesztbizonylatot nem készítünk.

Források: [Agent-hitelesítés](https://docs.szamlazz.hu/hu/agent/basics/authentication), [használati díjazás](https://tudastar.szamlazz.hu/gyik/szamla-agent-automatikus-szamlazas-koltsege).
