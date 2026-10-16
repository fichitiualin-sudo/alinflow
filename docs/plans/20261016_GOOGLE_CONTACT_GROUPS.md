# Kifejezetten jóváhagyott közös Google-névjegyek

## Cél
Több, a felhasználó által ugyanahhoz a személyhez tartozónak megerősített AlinFlow-ügyféladatlap egy Google-névjegyet frissíthessen. Minden ügyféladatlap, dokumentum, időpont és teljes telepítési előzmény megmarad.

## Jelenlegi működés
A google_contacts_links egy ügyfél-azonosítót köt egy stabil Google resourceName-hez. A helyi közös elérhetőségek új összekapcsolását az ellenőrzés megállítja. A meglévő névjegyek v1 pillanatképpel és változatlan markerrel működnek.

## Megváltoztathatatlan szabályok
- Nincs CRM-összevonás, törlés, munkadátum-/klímamennyiség-deduplikálás vagy Google-névjegy-összevonás.
- Csak kifejezetten kijelölt, még nem kapcsolt, saját tényleges telepítéses ügyfelek alkothatnak új csoportot; nincs név alapján automatikus csoportosítás.
- A teljes tagság és a teljes forrás az előnézetben látható és jóváhagyott. Hiányzó tag, külső ütközés vagy később kieső jogosult tag megállítja a csoport írását.
- Minden külön telefonszám, e-mail, cím és minden tag teljes munkajegyzete megmarad. Érvénytelen nem üres elérhetőség külön ellenőrzést kér.
- A korábbi v1 linkek és marker-azonosítók változatlanok. A Google egyedi célazonosítójának korlátja megmarad.
- A bizonytalan create/PATCH helyreállítása, ETag, privát mezők, pause és a munkaterületi/fiókhatár megmarad.

## Adatmodell
Additív, idempotens GOOGLE_CONTACTS_GROUPS.sql: privát google_contacts_link_members(workspace_id, customer_id, anchor_customer_id), egyedi tag és FK az anchor linkre. Nincs korábbi link-backfill. Tagságot és anchor linket kizárólag ellenőrzött előnézet alapján, egy tranzakcióban hoz létre a csoportokra kibővített jóváhagyó RPC. A singleton jóváhagyó RPC a lefoglalt tagokat elutasítja. RLS, böngésző-grant nélkül; service_role olvasás és szerver-only RPC. A v2 kezelt pillanatkép több kezelt kontaktértéket és rögzített tagazonosítókat tartalmaz.

## Implementációs lépések
1. Tiszta, determinisztikus csoportos forrásprojekció; a korábbi projektor változatlan.
2. Külön v2 model/merge/recovery, több elérhetőséget vizsgáló egyezés; v1 regresszióvédelem.
3. Csoportjavaslatot fogadó hitelesített előnézet, teljes tagságot tartalmazó szerverproof; atomi jóváhagyás.
4. Worker és normál előnézet a tartós tagság alapján egy effektív forrást kezel; kieső tag review.
5. Felületen explicit kijelölés, fő név és csoportelőnézet; külön névjegy- és lefedett ügyfélszám.
6. Célzott modell/forrás/worker/API és SQL-ellenőrzés, tsc/build, majd külön ellenőrzött kiadás. E munkafázis nem futtat éles migrációt és nem ír Google-t.

## Ellenőrzés
- 2–10 tag; átfedés, más workspace, már kapcsolt ügyfél és hiányzó forrás elutasítása.
- Minden munka és több telefon megmarad, még egyező napok/munkák esetén is.
- Friss előnézet, tagság/hash/remote változás, dupla jóváhagyás és egyedi Google-cél védelme.
- v1 változatlan; v2 no-op; kézi Google-mező és jegyzet megmarad; bizonytalan írás nem hoz létre másolatot.
- npx tsc --noEmit; npm run build; mobil/asztali csoportelőnézet. Csak szintetikus tesztadat kerül repóba.

## Visszaállítás
Visszaállítás előtt a Contacts-kapcsolat szüneteltetendő. Az új tagság és v2 pillanatképek megmaradnak; nem konvertáljuk vissza csonka singleton forrásra és nem törlünk Google-névjegyet. Az additív séma megtartható.

## Módosított fájlok és eredmények
- Elkészült a csoportos forrásprojekció, a külön v2 mezőmegőrző modell, az explicit csoportelőnézet és a tartós tagságot követő worker. A korábbi v1 működés és marker megmarad.
- Additív migráció: `docs/sql/GOOGLE_CONTACTS_GROUPS.sql`; meglévő kapcsolatoknál az alkalmazáskiadás előtt alkalmazandó. Új környezeti változó vagy Google-engedély nem szükséges.
- Érintett backend: `src/lib/alinflow/google-contacts-source.ts`, `google-contacts-model.ts`, `google-contacts-sync.ts`, `src/app/api/google-contacts/status/route.ts`; új route: `src/app/api/google-contacts/groups/preview/route.ts`.
- Érintett felület: `src/components/alinflow/GoogleContactsSettingsPanel.tsx`, `GoogleContactsSync.tsx`; célzott model/source/sync/UI/route tesztek; a status hitelesítési tesztje a privát tagságolvasást és a lefedett ügyfélszámot is ellenőrzi (`tests/google-contacts-auth.test.cjs`).
- Üzemeltetési leírás: `docs/GOOGLE_CONTACTS_SETUP.md`.
- 79 célzott model/source/sync teszt sikeres; a meglévő singleton tesztek is zöldek. A kiadásért felelős szál végső `npx tsc --noEmit` és `npm run build` futása sikeres, szintetikus publikus Supabase buildértékekkel. A status-auth fixture tagsági lekérdezését célzottan frissítettük; 4/4 auth teszt sikeres. A teljes tesztcsomag végső futása: 1078 teszt, 1072 sikeres, 6 kihagyott, 0 hiba.
- Natív PostgreSQL-teszt visszagörgetett tranzakcióban: migráció kétszer, privát jogosultság, atomi kéttagú jóváhagyás, proof-visszajátszás, részleges batch visszagörgetése, lefoglalt tag, egyedi Google-cél, átfedés és hiányzó saját forrás sikeres.
- Korlát: már kapcsolt névjegyek átcsoportosítása és tagok utólagos szerkesztése nem készült. Google-oldali manuális mezőváltozás és párhuzamos CRM-változás esetén a konzervatív összeolvasztás ellenőrzést kér.
- Ebben a fejlesztési munkafázisban éles migráció és Google-adatírás nem történt.
