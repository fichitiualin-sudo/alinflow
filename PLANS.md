# AlinFlow végrehajtási tervek

A több órás, adatbázist vagy több fő modult érintő munkák előtt készíts rövid végrehajtási tervet.

## Mikor kötelező terv?

- adatbázis-séma vagy migráció változik;
- háromnál több fő forrásfájl logikája változik;
- dokumentumtár, munkalap vagy karbantartási történet változik;
- autentikáció, jogosultság vagy többcéges működés készül;
- adatvesztés vagy korábbi rekordok felülírásának kockázata van;
- teljesítmény-optimalizálás több lekérdezést érint.

## Tervsablon

```md
# <Feladat neve>

## Cél
Mit kell a felhasználónak látnia vagy elvégeznie?

## Jelenlegi működés
Mely fájlok, adattáblák és folyamatok érintettek?

## Megváltoztathatatlan szabályok
Mely korábbi adatok és funkciók nem sérülhetnek?

## Adatmodell
Kell-e új mező/tábla/index/policy? Hogyan migráljuk a régi adatokat?

## Implementációs lépések
1. ...
2. ...

## Ellenőrzés
- npx tsc --noEmit
- npm run build
- célzott kézi tesztek

## Visszaállítás
Hogyan vonható vissza adatvesztés nélkül?

## Módosított fájlok
Csak a ténylegesen érintett fájlok.
```

## Tervlezárás

A munka végén írd le:

- mi készült el;
- mi maradt ki;
- milyen migrációt kell futtatni;
- milyen környezeti változót kell beállítani;
- milyen teszt futott le;
- van-e ismert kockázat.
