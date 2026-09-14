# Képernyők és UX-szabályok

## Általános vizuális elvek

- sötét AlinFlow arculat;
- kevés, jól elkülönülő kártya;
- ne legyen felesleges nagy fejléc/modal az egyes panelek tetején;
- azonos funkció csak egyszer jelenjen meg;
- fő műveletek színei különüljenek el;
- gombok ne érjenek össze;
- hosszú magyarázó szövegek helyett rövid címke és egyértelmű művelet.

## Dashboard – mobil sorrend

1. AlinFlow fejléc és `+ ügyfél` műveletek
2. Mai munkák és fő gyorsgombok
3. Naptár
4. Ügyfélkereső
5. Új érdeklődők
6. Raktár gyorsnézet
7. Meta/CSV import

## Dashboard – asztali elrendezés

A Raktár gyorsnézet a jobb oldali oszlop tetejére igazodjon. Ne csússzon az Új érdeklődők aljához. A fő tartalom használja ki a széles képernyőt, de ne nyúljon olvashatatlanul szélesre.

## Ügyféladatok

- a nagy felső ügyfél-fejléc/modal ne jelenjen meg;
- a telefonszám mellett legyen az egyetlen hívásgomb;
- az `Ajánlat / Időpont` legyen a fő továbbhaladási művelet;
- a státusz mellett vagy a kapcsolódó műveleteknél jelenjen meg a dátum;
- külön, állandó ügyfél-idővonal blokk nem szükséges.

## Irányítószám és település

- külön mezők;
- irányítószám beírásakor automatikusan töltse a települést;
- település beírásakor automatikusan töltse az irányítószámot, ha egyértelmű;
- ne jelenjen meg legördülő vagy sötét találati panel;
- a felhasználó felülírhatja a kitöltött értéket.

## Listák

- 10 tétel oldalanként;
- legfrissebb rekordok elöl, ahol időrendi lista indokolt;
- lapozáskor ne töltse újra az egész alkalmazást;
- dokumentumoknál csak az aktuális oldal részletes adatai töltődjenek.

### Raktár (2026-09-14)

A klíma- és anyagkészlet kivétel az általános lapozás alól: minden készlettétel egy folyamatos oldalon jelenik meg, közös név szerinti keresővel. A beszerzési egységár külön belső blokk, nettó/bruttó jelöléssel; üresen „Nincs megadva”, a mentett nulla „0 Ft”. Szerkesztése nem módosít készletet vagy eladási árat. A teljes beszerzésiár-blokk nyomtatáskor rejtett.

## Naptár

- az aznapi események kezdési idő szerint rendezve;
- az eseményen látszódjon a típus: Szerelés, Felmérés vagy Karbantartás;
- a rövid időpontok valós 1 órás tartományként jelenjenek meg;
- egyedi kezdési idő is megengedett;
- ütközést a mentés előtt jelezni kell.

## Dokumentumok és karbantartási napló

A karbantartási napló legyen minimális:

- dátum;
- `Megtekintés` gomb;
- egyetlen `Új karbantartás` gomb a napló fejlécében.

A dokumentumok ne tűnjenek el attól, hogy más időponttípust választunk.
