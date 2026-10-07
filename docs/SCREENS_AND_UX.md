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
7. Facebook-érdeklődők
8. Meta/CSV import

## Dashboard – asztali elrendezés

A Raktár gyorsnézet a jobb oldali oszlop tetejére igazodjon. Ne csússzon az Új érdeklődők aljához. A fő tartalom használja ki a széles képernyőt, de ne nyúljon olvashatatlanul szélesre.

## Facebook-érdeklődők

A Facebook-panel a Dashboard fő blokkjai után jelenik meg, asztalon a CSV-import mellett, mobilon előtte. A kapcsolat hiányát vagy a beolvasás elérhetőségét jelzi. A „Beolvasás elérhető” csak a szerverbeállítás meglétét jelenti, nem igazolt automatikus Meta-kézbesítést.

Alapértelmezett szűrő „Feldolgozandó”, mellette „Összes”; 10 sor/oldal, legutóbbi beérkezés elöl. Soronként látható a név, település, klíma, elérhetőség, eredeti jelentkezési idő és az „Új érdeklődés”, „Ismételt érdeklődés” vagy „Ellenőrizendő” címke. Hiányzó adatoknál „Település nincs megadva”, illetve „Klíma nincs azonosítva” jelenik meg. Az ellenőrizendő sor rövid okot is mutat.

Az „Ügyfél megnyitása” csak kapcsolt ügyfélnél látható. A „Feldolgozva” gomb a naplósort jelöli meg, ügyfélstátuszt nem módosít. „Frissítés” gomb, látható lapon percenkénti frissítés és visszatéréskori ellenőrzés szolgálja az új beérkezések megjelenését. A „Korábbi jelentkezések beolvasása” megállítható, majd a megnyitott panelben folytatható; az összesítő külön mutatja az új ügyfeleket, ismételt érdeklődéseket, ellenőrizendő és már beolvasott tételeket.

Az új ügyfelek listájában és az ügyfél adatlapján az `Érdeklődés` rész mutatja a mentett igényt/klímát. Ez nem ajánlati tétel és nem készletfoglalás. Ismételt érdeklődés új klímája a külön Facebook-naplósorban látszik, a korábbi ügyfél-igényt nem írja át.

## Visszahívandók térképe

A Visszahívandó listában a „Térképen” gomb, illetve a főoldal Térkép nézetének „Visszahívandók” füle nyitja meg. Az időpont nélküli, Visszahívandó státuszú ügyfeleket mutatja; a jelölő településszintű, nem pontos lakcím. Az azonos településhez tartozó érdeklődők közös, darabszámos jelölőt kapnak. Név, település és érdeklődési klíma alapján kereshető; a kapcsolódó ügyféllista tízesével lapozható, az ügyfél közvetlenül megnyitható. A hiányzó vagy nem azonosítható településű ügyfelek külön is listázhatók.

Mindkét térképfül közös Google Maps megjelenítőt használ, azonos nagyító- és teljes képernyő gombokkal, térképmérettel és térkép/lista elrendezéssel. Mobilon a lista a térkép alatt, széles asztali nézetben mellette jelenik meg. Térképhibánál újrapróbálás érhető el, az ügyféllista továbbra is működik.

A gombostűk a térképek egységesítése előtti eredeti alakot használják (`6a1ae37`, `MaintenanceMapPanel.tsx`): nyújtott csepp, sötét kontúr és nagy fehér közép, külső fehér szegély nélkül. A jelenlegi megjelenítési méret mindkét irányban a visszaállított alapméret 75%-a: asztalon 25,5×30 px, legfeljebb 640 px széles mobilnézetben 13,5×16,5 px, több bejegyzésnél mobilon 18×21 px. A korábbi alapméretek rendre 34×40, 18×22 és 24×28 px voltak. A kijelölt helyszín kontúrja befelé vastagodik, mérete változatlan. A mobilméretre váltás csak az ikonokat cseréli, a térképkivágást és a jelölőpéldányokat megtartja.

Minden külön helyszínt kicsi gombostű jelöl, közeli pontok összevonása nélkül, minden nagyításnál. Egy telepítés/ügyfél esetén színes fej és fehér pont látszik; egy helyhez tartozó több tételnél pontos darabszám jelenik meg. A gombostű színes feje az összes ottani karbantartási állapotot megtartja; a nagyon kis arányú állapot is látható szeletet kap. Koppintásra megjelenik minden állapot pontos darabszáma és a helyszín részletei. Visszahívandóknál településenként külön türkiz gombostű és több ügyfélnél darabszám jelenik meg. Sűrű területen a nagyítás segít a helyszínek elkülönítésében; a rendszer nem rejti el vagy vonja össze a szomszédos pontokat.

A „Telepített klímák” fül a mentett szerelési koordinátákat és karbantartási állapotokat mutatja. Az azonos koordinátájú telepítések közös jelölője is megőrzi az összes állapot színét és darabszámát. A helyszín kiválasztása szűri a tízesével lapozható listát; az egyes időpontok a felugró ablakból is külön megnyithatók. Az „Összes helyszín” gomb megszünteti a helyszín szerinti szűrést. Az állapotszűrők egyben színmagyarázatot adnak; a cím/név/klíma keresés, hiányzó koordináták keresése és az időpontonkénti „Nem kéri a karbantartást” beállítás megmarad.

A megjelenítő minden helyszín jelölőjét a Google optimalizált képrétegéhez kapcsolja, gyorsítótárazott PNG-ként. A mozgatást és a képernyőn kívüli képek kezelését maga a térkép végzi, alkalmazásoldali csoportosítás vagy képkockánkénti újraszámítás nélkül. A változatlan helyszínek jelölői megmaradnak; kijelölés vagy változatlan adatok visszaadása nem állítja vissza a nézetet. A térkép mellett/alatt levő ügyféllista billentyűzettel is használható.

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

A klíma- és anyagkészlet kivétel az általános lapozás alól: minden készlettétel egy folyamatos oldalon jelenik meg, közös név szerinti keresővel. Mindkét listán először a pozitív fizikai készletű tételek, majd a további tételek jelennek meg, csoportonként magyar betűrendben. A beszerzési egységár külön belső blokk, mindig bruttó összeggel; üresen „Nincs megadva”, a mentett nulla „0 Ft”. Nettó bevitel esetén a kijelzés 27% áfával számol, a mentett eredeti összeg és ártípus szerkesztéskor megmarad. Szerkesztése nem módosít készletet vagy eladási árat.

Felül a teljes klíma- és anyagkészlet bruttó beszerzési értéke, ebből a lefoglalt és a szabad rész látszik. A lefoglalt rész legfeljebb a tényleges fizikai készlet; a hiány figyelmeztetése továbbra is a tételnél jelenik meg. Hiányzó beszerzési ár esetén egyértelmű részösszeg-jelzés szükséges. A kereső nem módosítja az összesítőt. Az árak és az összesítő nyomtatáskor rejtettek. A korábbi „Raktár logika” és „Mit jelent?” kártyák nem szerepelnek a felületen.

## Naptár

- az aznapi események kezdési idő szerint rendezve;
- az eseményen látszódjon a típus: Szerelés, Felmérés vagy Karbantartás;
- a rövid időpontok valós 1 órás tartományként jelenjenek meg;
- egyedi kezdési idő is megengedett;
- ütközést a mentés előtt jelezni kell.

## Munkafotók és sorozatszámok

A „Készülékadatok és adattábla-fotók” rész telepítésnél kizárólag a Munkafotók lenyíló részében jelenik meg, további belső lenyitás nélkül. Az időponthoz tartozó klímalistában nincs második belépési pont; a klímalista becsukásával a fotók és készülékadatok továbbra is elérhetők a Munkafotók alatt. Készülékenként közös Gyártó mező, külön Beltéri/Kültéri csoportban pontos típus, S/N és adattábla-fotók szerepelnek. A fotó „Adattábla beolvasása” gombja mindhárom adatot együtt javasolja: az egyedi találat csak az üres szerkesztett mezőt tölti ki, eltérő vagy több javaslat külön választható. Ellenőrzés után egyetlen mentés rögzíti a készülék adatait. A felismerés helyben történik, a nem olvasható adat kézzel pótolható. A karbantartási és felmérési munkák általános munkafotói változatlanul az adott időponthoz tartoznak.

## Dokumentumok és karbantartási napló

A karbantartási napló legyen minimális:

- dátum;
- `Megtekintés` gomb;
- egyetlen `Új karbantartás` gomb a napló fejlécében.

A dokumentumok ne tűnjenek el attól, hogy más időponttípust választunk.
