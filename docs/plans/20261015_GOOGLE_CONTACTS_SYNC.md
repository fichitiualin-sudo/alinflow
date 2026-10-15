# Google Névjegyek összekapcsolása

## Cél
Saját, tényleges telepítéssel rendelkező ügyfelek iPhone-on is elérhető Google-névjegyei. Első alkalommal egyezések és új névjegyek előnézete; kizárólag jóváhagyott összerendelések egyirányú frissítése. Egy ügyfél egy névjegy, több telepítés a megjegyzésben.

## Jelenlegi működés
Nincs névjegyexport vagy People API-kapcsolat. A Google Naptár szerveroldali OAuth-, titkosítási és munkaterületi jogosultsági megoldásai újrahasználhatók, a naptárkapcsolat és engedély változatlan marad. Elkülönített checkout a main aktuális állapotán; a fő munkakönyvtár változásai megmaradnak.

## Megváltoztathatatlan szabályok
- Csak saját munkaterület és tényleges telepítések; megosztásból látható vagy külső karbantartásra átvett adatok nem kerülnek át automatikusan.
- Nincs Google-névjegytörlés, nincs visszaírás a CRM-be, nincs számlaár, belső jegyzet, fotó vagy aláírás az exportban.
- Fiókazonosság ellenőrzött; külön Contacts-hozzájárulás; tokenek csak szerveren, titkosítva, RLS-védelemmel.
- Előnézet és jóváhagyás a kapcsolat után is kötelező az új összerendeléshez. Névazonosság önmagában nem egyezés.
- Frissítés stabil Google-azonosítóval, a nem kezelt mezők és személyes megjegyzések megtartásával. Etagekkel védett összeolvasztás.
- Bizonytalan Google-létrehozási eredmény nem indíthat újabb vak létrehozást: tartós bizonytalan állapot, marker-alapú felderítés, szükség esetén kézi ellenőrzés.
- Az AlinFlow mentését a Google hibája nem akadályozza; a szinkronizálás szüneteltethető.

## Adatmodell
Additív, idempotens migráció: külön névjegykapcsolat/OAuth-állapot és ügyfél-névjegy összerendelés, korábbi kezelt mezők pillanatképe, feldolgozási állapot és konkurens feldolgozást kizáró foglalás. Meglévő időpont/dokumentum és naptárkapcsolat nem módosul.

## Implementációs lépések
1. Adatforrás, telefonszám-normalizálás, egyezések, személyes mezőket megőrző Google-payload.
2. Privát adatmodell, előnézet/jóváhagyás, biztonságos háttérfeldolgozás és szerver API-k.
3. Elkülönített Contacts OAuth a meglévő Google-klienssel; fiók- és engedélyellenőrzés.
4. Beállításokban kapcsolat és lapozott előnézet, állapotok, hibák, szüneteltetés; ismételt futás adatduplikáció nélkül.
5. Célzott tesztek, típusellenőrzés, build, mobil/asztali vizuális próba, független ellenőrzés.
6. Ellenőrzött kiadás és migráció. Google People API, callback és adatkezelési információk előkészítése; a felhasználó Google-jóváhagyása csak a kész funkcióhoz, tényleges áttöltés előtt előnézet.

## Ellenőrzés
- Workspace- és fiókhatár, lejárt/hiányzó engedély, OAuth visszajátszás.
- Nem telepített/külső/megosztott ügyfelek kizárása, több telepítés összesítése.
- Dupla kattintás, párhuzamos futás, időtúllépés és bizonytalan létrehozás.
- Meglévő személyes mezők, kézi Google-szerkesztés és régi AlinFlow-megjegyzés egyeztetése.
- npx tsc --noEmit; npm run build; célzott regressziók; mobil/asztali próba.

## Visszaállítás
Kapcsolat szüneteltetése leállítja a további írásokat. Az alkalmazáskiadás visszaállítható; az additív táblák megtarthatók. Google-névjegyet automatikusan nem törlünk. Éles beállítások módosítása előtt privát mentés.

## Módosított fájlok és eredmények
- Elkészült: külön Contacts OAuth/tokenkezelés és nyolc API route, saját telepítések adatforrása, egyezés/összeolvasztás, jóváhagyás és háttérfeldolgozás, két idempotens SQL telepítési fájl.
- Felület: összecsukható Google Névjegyek beállítás, tízes előnézet, állapotok, szüneteltetés és iPhone útmutató. A központi oldal csak az OAuth-visszatérést kezeli.
- Dokumentáció: Google-névjegyek adatkezelési oldala, kereszthivatkozás a naptár tájékoztatójában, telepítési/üzemeltetési útmutató.
- 2026-10-15: teljes `npm test` 1036 tesztből 1030 sikeres, 0 hibás, 6 meglévő környezetfüggő teszt kihagyva (2 éles séma-visszaállítás, 4 PGlite). Minden Contacts-teszt lefutott.
- `npx tsc --noEmit` sikeres. `npm run build` sikeres szintetikus publikus Supabase buildváltozókkal; az első, változók nélküli futás a meglévő Supabase URL hiányán állt meg. Éles Vercel-build külön ellenőrzendő.
- Mobil (390 px) és asztali nézet ellenőrizve világos/sötét témában a valódi komponens szintetikus adatos előnézetén; hosszú nevek/címek nem okoznak vízszintes túlcsordulást. A próba nem hív Google-t vagy adatbázist.
- Éles séma és szerepkörök olvasási auditja, migráció kétszeri futtatása visszagörgetett tranzakcióban sikeres. Fiókazonosság, szolgáltatói jogosultság, előnézeti jóváhagyás és feldolgozási foglalás ellenőrizve.
- Független backend/modell-ellenőrzés után megmarad a Google elsődleges elérhetősége, a kézi mezők és a személyes jegyzet; a bizonytalan írások műveleti bizonyítéka tartós.
- Hátralévő éles aktiválás: kiadás, additív migráció és cron, People API/callback/szerverkapcsoló, külön Google Contacts-hozzájárulás, majd valódi előnézet. Valódi névjegyírás még nem történt.
