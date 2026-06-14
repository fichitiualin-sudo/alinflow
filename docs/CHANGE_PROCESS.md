# Fejlesztési és kiadási folyamat

## Kis módosítás

1. pontos felhasználói cél;
2. érintett fájlok azonosítása;
3. célzott módosítás;
4. `npx tsc --noEmit`;
5. `npm run build`;
6. kézi teszt;
7. csak módosított fájlok felsorolása.

## Nagy módosítás

1. backup;
2. végrehajtási terv a `PLANS.md` alapján;
3. külön branch;
4. migráció és rollback terv;
5. implementáció;
6. teljes regressziós teszt;
7. preview deployment;
8. csak jóváhagyás után merge.

## Commit-szabályok

Javasolt commitüzenetek:

```text
fix: prevent maintenance cancellation from cancelling customer
feat: add maintenance work report history
docs: add AlinFlow Codex documentation
perf: lazy-load customer documents
```

## Pull request leírás

Tartalmazza:

- felhasználói probléma;
- megoldás;
- módosított fájlok;
- SQL migráció;
- teszteredmények;
- kézi ellenőrzési lépések;
- ismert korlátok.

## Visszaállítás

- kód: előző működő commit/branch;
- adatbázis: idempotens rollback vagy backupból visszaállítás;
- migráció után rekord- és dokumentumszám ellenőrzése;
- soha ne törölj tömegesen éles adatot egyetlen ellenőrizetlen SQL-lel.
