# Urbán Klíma – AMOVA összevont számlázás

## Cél

Az Urbán Klíma munkaterületén a meglévő, egy számlás telepítési folyamat AMOVA-s Számla Agent-kapcsolattal működjön. A felhasználó ezt kifejezetten kérte; a bemutatott művelet készüléket, anyagot és munkadíjat tartalmazó `combined` számla.

## Jelenlegi működés

A `src/app/api/create-invoice/route.ts` minden számlatípust a szerveroldali `SZAMLAZZ_WORKSPACE_ID` egyetlen munkaterületére korlátoz. Az éles érték a KLIMAlin munkaterülete, ezért az Urbán kérése még a Számlázz.hu meghívása előtt 403 hibát kap. A `combined` típus a `SZAMLAZZ_COMBINED_AGENT_KEY`, ennek hiányában a `SZAMLAZZ_DEVICE_AGENT_KEY` kulcsot használja. A munkadíj és karbantartás másik kulcsot használ.

## Megváltoztathatatlan szabályok

- A KLIMAlin meglévő beállítása és számlázása marad.
- Az Urbán engedélye csak a meglévő összevont telepítési számlára terjed ki. Nem kap hozzáférést a külön munkadíj- és karbantartási kibocsátóhoz.
- Bejelentkezés, aktív munkaterületi tagság, mentett ügyfél és időpont ellenőrzése változatlanul kötelező.
- Nincs kulcs a böngészőben, adatbázisban, repóban vagy naplóban; nincs új kulcs és nincs kulcscsere.
- Az ellenőrzés nem állít ki és nem küld el valódi számlát vagy emailt.
- A hiba a szolgáltató meghívása előtt történt, ezért ez a visszautasított kérés nem készíthetett számlát.

## Adatmodell

Nem változik. Nincs migráció vagy korábbi számla-/ügyféladat-módosítás.

## Implementációs lépések

1. A meglévő egy-munkaterületes beállítás megtartása mellett külön `SZAMLAZZ_COMBINED_WORKSPACE_IDS` engedélylista csak a `combined` típushoz. Vesszővel elválasztott teljes munkaterület-azonosítók; üres érték vagy részleges egyezés nem ad hozzáférést.
2. A konfiguráció hiányának hibaüzenete érthető legyen a felhasználónak, belső változónév nélkül.
3. Helyettesített hálózattal tesztek: KLIMAlin változatlan; Urbán összevont számla engedélyezett, többi típus tiltott; más munkaterület és hibás azonosító tiltott; hitelesítési védelem megmarad; kulcs- és áfakezelés változatlan.
4. Típusellenőrzés, build és Vercel-előnézet; ezt követően az éles engedélylista az Urbán munkaterületét kapja. A régi `SZAMLAZZ_WORKSPACE_ID` értékét nem írjuk át.
5. Az éles alkalmazás telepítésének és a beállításnak ellenőrzése számlakiállítás nélkül.

## Ellenőrzés

- Célzott számlázási és API-jogosultsági regressziós tesztek, valódi hálózat nélkül.
- `npx tsc --noEmit`
- `npm run build`; hiányzó helyi Supabase-beállítás esetén a korlát külön rögzítendő, a Vercel build ellenőrizendő.
- Kizárólag a kért munkaterület és számlatípus kapjon új engedélyt.

## Visszaállítás

Az új engedélylista eltávolítása és újratelepítés visszaállítja a korábbi hozzáférést. Nem szabad átírni a KLIMAlin régi munkaterület-azonosítóját, kulcsokat vagy már kiállított számlákat.

## Módosított fájlok

- `src/app/api/create-invoice/route.ts`
- Célzott számlázási jogosultsági tesztek a `tests/` alatt.
- Ez a terv és az élesítési eredmény.

## Állapot

A célzott kódjavítás elkészült. A számlázási/API-hitelesítési/adatvédelmi tesztek 45/45 sikeresek, a TypeScript-ellenőrzés sikeres. A helyi build fordítása és TypeScript-lépése sikeres, az oldaladatok gyűjtése hiányzó Supabase-környezet miatt leállt. A Vercel Preview build sikeres. Nincs adatbázis-migráció. Új számla vagy email nem készült.

Az éles konfiguráció meglévő `SZAMLAZZ_WORKSPACE_ID`, `SZAMLAZZ_DEVICE_AGENT_KEY` és `SZAMLAZZ_LABOR_AGENT_KEY` értékei változatlanok. Külön combined kulcs-, áfa- vagy előtagfelülírás nincs; a combined típus a meglévő készülék-kibocsátót és annak áfabeállítását használja.

2026-10-11: a felhasználó kifejezetten jóváhagyta az éles aktiválást. A `SZAMLAZZ_COMBINED_WORKSPACE_IDS` kizárólag Production környezetben, az Urbán munkaterület azonosítójával mentve és visszaellenőrizve. Az aktiváláshoz a javítást tartalmazó új éles telepítés szükséges; annak végső eredménye a [128. PR](https://github.com/fichitiualin-sudo/alinflow/pull/128) telepítési állapotában követhető.
