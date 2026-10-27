# Karbantartási pipa a megosztott telepítéseken

## Cél
A „Nem kéri a karbantartást” jelölőnégyzet a még csak egyeztetésre megosztott telepítéseken is látszódjon, menthető és visszakapcsolható legyen. Új felhasználói állapot vagy külön partner-választó nem készül.

## Jelenlegi működés
A térkép elrejti a pipát a megosztott, szintetikus azonosítójú sorokon. Ezekhez nem tartozik saját időpont, ezért a normál appointments-frissítés nem használható. A már átvett telepítés saját munkaterületi jelöléssel rendelkezik.

## Megváltoztathatatlan szabályok
- A fogadó munkaterület jelölése a fogadó karbantartási követésére vonatkozik, az átadó és más partnerek beállításait nem írja felül.
- A jelölt sor a fogadónál a „Nem kéri” és „Összes” nézetben megmarad, így visszakapcsolható.
- A hozzáférés feltételei és az átadó saját kizárása változatlanok; visszavont vagy jogosulatlan megbízással nincs olvasás/írás.
- A pipa nem hoz létre ügyfelet, megrendelést, időpontot, aláírást vagy dokumentumot.

## Adatmodell
Elkülönített fogadói preferencia a megosztott telepítéshez, szerveroldali rögzítővel és időponttal. Zárt RLS, kizárólag szűk, jogosultságot ellenőrző RPC. A már átvett saját telepítés jelölése marad elsődleges; az átvételi átmenet megőrzi a korábbi jelölést. Régi rekordok nem módosulnak migrációkor.

## Implementációs lépések
1. Idempotens migráció és célzott jogosultsági/adatmegőrzési PostgreSQL-tesztek.
2. Típus, lekérdezés, mentés és térképi állapot kiegészítése.
3. Pipa minden kártyán; mentés alatt letiltás, siker/hiba visszajelzés, identitásváltás és párhuzamos frissítés kezelése.
4. Célzott tesztek, TypeScript, build, mobil/asztali ellenőrzés.
5. Éles környezethez elérhető kiadási út ellenőrzése; csak a feladathoz tartozó változások kiadása.

## Ellenőrzés
- Be- és kikapcsolás, újratöltés, „Nem kéri” szűrő és jelölőszín.
- Másik felhasználó/munkaterület, visszavont megbízás, idegen telepítés elutasítása.
- Migráció ismételhető; forrásügyfél, telepítés, dokumentum és naptár változatlan.
- `npx tsc --noEmit`, `npm run build`, célzott CJS és izolált PostgreSQL tesztek.

## Visszaállítás
A felület korábbi verziójára visszaállítható; az új preferencia megőrizhető. Korábbi üzleti adat vagy dokumentum visszaírására nincs szükség.

## Állapot
Implementáció és helyi ellenőrzés kész. A célzott kliens/UI regressziók 30/30, az izolált PostgreSQL-ellenőrzések 19/19 esetben sikeresek. A migráció ismételhető, a jogosulatlan és visszavont hozzáférést elutasítja, és a forrásadatokat megőrzi.

A `npx tsc --noEmit` sikeres. A `npm run build` a titkok nélküli kiadási munkakönyvtárban először hiányzó Supabase URL miatt megállt; szintetikus, csak buildhez használt publikus beállításokkal a teljes build sikeres. A valódi környezettel a Vercel kiadási buildje ellenőrizendő.

A valódi térképpanelt szintetikus adatokkal, külső térképhívás nélkül ellenőriztük asztalon és 390 px széles mobilnézetben: minden kártyán látszik a pipa, a mentési állapot és a szűrők követik a változást, a kikapcsolás visszaállítja az esedékességet, vízszintes kilógás nincs. Régi dokumentumhoz, időponthoz vagy valódi ügyféljelöléshez a teszt nem nyúlt.

Kiadási lépés: friss éles sémaaudit és mentés, kizárólag a mellékelt migráció alkalmazása adatmegőrzési és jogosultsági ellenőrzéssel, majd a feladat fájljainak külön kiadása a legfrissebb főágra. A változatlan üzleti táblák ellenőrzése és a `VERIFY_20261027_SHARED_MAINTENANCE_OPT_OUT.sql` futtatása a telepítés feltétele.
