# Második külön készülék- és munkadíj-számlázási kapcsolat

## Cél
Egy további, pontosan megadott munkaterület használhassa a meglévő két számlás folyamatot: a készüléket a közös készülékkibocsátó, a munkadíjat és a karbantartást a munkaterület saját vállalkozása számlázza.

## Jelenlegi működés
A `src/app/api/create-invoice/route.ts` a hitelesített, aktív munkaterületi tagság, a mentett ügyfél és az időpont ellenőrzése után választ számlakibocsátót. Az elsődleges munkaterület és egy külön munkadíjkibocsátóhoz kötött munkaterület támogatott. A kiállítás ismétlését a meglévő számlaküldési napló kezeli.

## Megváltoztathatatlan szabályok
- Az elsődleges és az eredeti külön kapcsolat kulcsai, áfakulcsai, előtagjai és számlatípusai nem változnak.
- Az új kapcsolat kizárólag a szerveren beállított, teljes munkaterület-azonosítóval használható.
- A készülékszámla a meglévő közös készülékkibocsátó beállításait használja; a saját munkadíj és karbantartás csak az új kapcsolat saját kulcsát, áfakulcsát és előtagját használhatja.
- Egy érintett munkaterület több kibocsátói kapcsolathoz kötése minden számlatípusnál hibát ad. Más munkaterületek ettől működőképesek maradnak.
- Hiányzó saját kulcs vagy áfakulcs esetén nincs helyettesítés más kibocsátó beállításaival, számlaküldési foglalás vagy szolgáltatói hívás.
- Külön kapcsolatnál az összevont számla tiltott, korábbi összevont engedélylista esetén is.
- A feladat nem hoz létre automatikus magánszemély-, KATA- vagy jogi megfelelőségi ellenőrzést. A kért magánügyfélre vonatkozó számlázási gyakorlat nem új adatmodell.
- Titok, valódi munkaterület-azonosító, adószám vagy elérhetőség nem kerül a repóba. Az ellenőrzés nem állít ki valódi számlát és nem küld levelet.

## Adatmodell
Nincs új mező, tábla, index, policy vagy migráció. A meglévő számlatípusok és számlaküldési napló változatlanok. A meglévő két számlás felület használható.

## Implementációs lépések
1. Két kifejezett, szerveroldali külön kapcsolat kezelése a kibocsátó kiválasztásában.
2. A kért munkaterülethez tartozó ütközések ellenőrzése a számlaküldés foglalása előtt.
3. Az új kapcsolat saját beállításainak szigorú összetartása, külön visszaesési lehetőség nélkül.
4. A valódi API-kezelő tesztelése mesterséges adatokkal és helyettesített szolgáltatóval; régi kapcsolatok regressziós ellenőrzése.

## Környezeti változók
Csak az új kapcsolat kap új szerveroldali beállításokat:
- `SZAMLAZZ_SPLIT_SECONDARY_WORKSPACE_ID`: egyetlen, pontos munkaterület-azonosító.
- `SZAMLAZZ_SPLIT_SECONDARY_LABOR_AGENT_KEY`: a saját munkadíj- és karbantartásszámlák Agent-kulcsa.
- `SZAMLAZZ_SPLIT_SECONDARY_LABOR_VAT_KEY`: a saját kibocsátó ellenőrzött áfakulcsa; AAM csak igazolt beállításként.
- `SZAMLAZZ_SPLIT_SECONDARY_LABOR_INVOICE_PREFIX`: a saját kibocsátó ellenőrzött számlaelőtagja; üresen nem örököl más előtagot.

A kulcs létrehozása, tartós hozzáférés engedélyezése és éles környezeti változók beállítása külön üzemeltetési lépés. A kód elkészítése nem aktivál éles kapcsolatot.

## Ellenőrzés
- Célzott API-jogosultsági és számlaküldési tesztek, kizárólag helyettesített szolgáltatóval.
- `npx tsc --noEmit` és `npm run build` a fő feladatban.
- Nincs új gyökérszintű `app/` mappa, UI-, időpont-, dokumentum- vagy adatmodell-módosítás.
- Éles számlakiállítás nélkül ellenőrizendő a munkaterületi kötés, az Agent-kulcs fiókja, az áfakulcs és az előtag.

## Visszaállítás
Az új négy környezeti változó eltávolításával és új telepítéssel az új kapcsolat letiltható. A korábbi kapcsolatok beállításai és a korábbi számlák, időpontok, dokumentumok megmaradnak. A kódmódosítás külön visszavonható; migráció-visszaállítás nem kell.

## Módosított fájlok
- `src/app/api/create-invoice/route.ts`
- `tests/api-auth.test.cjs`
- `docs/plans/20261020_ATTILA_SPLIT_INVOICING.md`

## Állapot
Elkészült a második külön kibocsátói kapcsolat, a kért munkaterületre korlátozott ütközésvédelem és a két korábbi kapcsolat regressziós ellenőrzése. Független, csak olvasási kódellenőrzés nem talált lényeges elkülönítési vagy regressziós hibát.

A `node --test tests/api-auth.test.cjs tests/invoice-delivery.test.cjs` ellenőrzés 79/79 tesztje sikeres. A tesztek igazolják a közös készülékkibocsátót, a saját AAM-munkadíj- és karbantartásszámlákat, az előtagok elkülönítését, a hiányzó beállítás és ütközés miatti megállást a számlaküldési foglalás előtt, valamint a korábbi számlázási és ismétlésvédelmi működést. A `git diff --check` nem talált formázási hibát. A típusellenőrzés és build a fő feladat ellenőrzése.

Nem készült migráció, új számlatípus, UI-módosítás vagy új ügyféltípus-ellenőrzés. A fennmaradó üzemeltetési lépés a négy új szerveroldali változó pontos, ellenőrzött beállítása és a telepítés. Kockázat: a valódi kibocsátó fiókját a szerverre rögzített Agent-kulcs határozza meg; a konfiguráció helyességét aktiválás előtt ellenőrizni kell. A tesztek nem kapcsolódnak valódi számlázóhoz.

A fő feladat ellenőrzése: `npx tsc --noEmit` és `npm run build` sikeres, helyi szintetikus publikus Supabase-beállításokkal. A gyökérszintű `app/` mappa nem létezik. A módosítás nem érint felületet, adatbázist vagy dokumentumokat.
