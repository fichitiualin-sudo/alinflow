# Dokumentumok és lezárási adminisztráció

## PDF-küldés és dokumentumfelület

A munkalap mentési képernyőjén a **Mentés és PDF-ek küldése** előbb elmenti a munkalapot és a hozzá tartozó vásárlási nyilatkozatot, majd ezek azonosítóival hívja a szervert. A szerver az adott munkaterület, ügyfél és időpont mentett, aláírt rekordjaiból készít valódi PDF-mellékleteket. Karbantartásnál nem készül vásárlási nyilatkozat. Ha a munkalaphoz aláírt adatkezelési tájékoztató is tartozik, az külön PDF-mellékletként kerül a csomagba. A Dokumentumok gombjaival a mentett példányok ismét elküldhetők, szerkesztés nélkül is.

A PDF megőrzi a dokumentum saját aláírását, magyar ékezeteit és a mentett adatpillanatképet. Hiányzó vagy más időponthoz tartozó dokumentumot nem helyettesít a legutóbbi ügyféldokumentummal. A PDF-ek a küldéskor készülnek, nem foglalnak külön Supabase Storage tárhelyet.

A munkalap előnézete, az összes munkalap nézete és a HTML-export is a munkalapban mentett ügyféladatokat, készülékösszesítőt és munkaidőt jeleníti meg. Változatlan aláírással történő újramentés ezeket és a hozzá tartozó vásárlási nyilatkozatot megőrzi. Az eladó vagy a nyilatkozati készülékválasztás módosításához új aláírás szükséges; a szerkesztő megnyitáskor az adott mentett nyilatkozat választásait tölti vissza. Lezárást kizárólag már elmentett aláírt munkalap engedélyezhet, a szerkesztőben maradt aláírás nem. Az összes munkalap nézet az ügyfél minden mentett telepítési és karbantartási munkalapját tartalmazza.

A munkalap 2026-10-11-től modern, fehér alapú, visszafogott türkiz arculatot használ az előnézetben, HTML-exportban és email-PDF-ben. A saját munkaterület márkaneve, az ügyfél- és munkaadatok, készülékek, munkaleírás, megjegyzés és aláírás elkülönülnek. A hosszú tartalom további oldalakon folytatódik, nem vágódik le.

A vásárlási nyilatkozat az eredeti, eladói mezőket is tartalmazó `vasarlasi_nyilatkozat_0416.pdf` mintát követi, egy példányban. Az email-PDF az üres eredeti nyomtatvány első oldalára helyezi a mentett adatokat és a nyilatkozat saját aláírását, példányszámozás nélkül. A rendelkezésre álló helyre olvashatóan nem férő adatok és készüléklisták hivatkozott mellékletben, teljes egészükben szerepelnek. A keltezés a mentett aláírás budapesti dátuma, nem a megnyitás napja. Az előnézet és a HTML-export ugyanezt a fekete-fehér, Times betűs elrendezést követi, szintén egy példányban. A korábbi mentett dokumentumadatokat a megjelenés változása nem módosítja.

2026-10-11-től a felhasználó kérésére a H tarifás nyomtatvány nem jelenik meg a Dokumentumok felületén. A korábban mentett adatokat a felület eltávolítása nem törli.

## Alapelv

A dokumentumtár egy ügyfél teljes történetét őrzi. Új dokumentum mindig hozzáadódik; nem írhat felül más üzleti eseményhez tartozó dokumentumot.

## Dokumentumtípusok

### Árajánlat

- az emailben kiküldött tartalommal szinkron előnézet;
- ajánlat dátuma/időpontja;
- bundle vagy alternatives árlogika;
- megtekinthető és nyomtatható.

### Időpont-visszaigazolás

- szerelés, felmérés vagy karbantartás típusa szerint változhat;
- a karbantartási értesítő emailt nem kell külön hosszú távú garanciadokumentumként tárolni;
- az érdemi karbantartási bizonyíték a munkalap.

### Szerelési munkalap

- telepítéshez tartozik;
- aláírást, aláíró nevét és időpontját őrzi;
- csak aláírás után kész;
- nem írható felül karbantartási munkalappal.

### Vásárlási nyilatkozat

- szereléshez tartozik;
- csak aláírás után kész;
- karbantartásnál nem készül új vásárlási nyilatkozat.
- a munkalap szerkesztőjén az eladó és a nyilatkozati tételek „Vásárlási nyilatkozat” lenyitható részbe kerülnek, amely alapból csukott; a korábbi aláírt dokumentumok előnézete és küldése megmarad.

### Karbantartási munkalap

- minden karbantartás külön rekord;
- saját munkadátum és aláírás;
- dátum szerint listázva;
- korlátlan számú alkalom;
- garancia vagy hiba esetén az összes munkalap visszakereshető.

### Adatkezelési tájékoztató és partneri hozzájárulás

A munkaterület saját dokumentumbeállításában külön szerepel a készülékértékesítő és a munkát végző vállalkozás: például AMOVA és az adott telepítő EV-je. Telepítésnél mindkettő szerepel a tájékoztatóban, karbantartásnál kizárólag az adott munkát végző vállalkozás. Kizárólag karbantartással foglalkozó munkaterület a készülékértékesítő mezőit üresen hagyhatja; telepítési tájékoztató aláírásához viszont a készülékértékesítő teljes adatai is szükségesek. A tájékoztató a kitöltött vállalkozási adatok, megőrzési idők, címzettek és nemzetközi adattovábbítási feltételek ellenőrzése után kapcsolható be. Az aktiválás nem állít ki számlát és nem változtat számlázási jogosultságot.

Az ügyfél az aláírás előtt elolvashatja a tájékoztatót. A partneri adatátadáshoz külön, alapból üres pipa tartozik; a partner vállalkozásneve és elérhetősége előre látható. A pipa kizárólag név, karbantartási cím, telefon és email karbantartási célú átadásáról szól. Partner nélkül nincs megadható partneri hozzájárulás, az elutasítás nem akadályozza a munkalap aláírását. Ez a funkció önmagában nem ad más munkaterületnek hozzáférést ügyféladatokhoz.

A rendszer az aláíráskor a tájékoztató teljes szövegét, verzióját, az adott munkatípushoz tartozó vállalkozásokat, a megnevezett partnert, az ügyféladatokat, a pipa állapotát és az aláírást együtt menti. Az előnézet és a PDF ebből a pillanatképből készül; későbbi cégbeállítások nem írják át a már aláírt dokumentumot. Régi munkalap aláírásából nem készül utólag nyilatkozat: új tájékoztatóhoz új aláírás szükséges.

Minden új karbantartási alkalom a saját munkalapjával, saját friss ügyfélaláírásával és saját tájékoztatójával készül. A karbantartási tájékoztató verziója `2026-10-11.2`; kizárólag a karbantartási munkalapon használható, és egy `service_provider` adatkezelőt tartalmaz. Az eredeti `2026-10-11.1` telepítési és korábbi karbantartási pillanatképek olvashatók maradnak és nem alakulnak át. Bekapcsolt, de hiányosan kitöltött tájékoztató esetén az új aláírás rögzítése hibát jelez; a rendszer nem hagyja el észrevétlenül a tájékoztatót. A külön partneri pipa minden új aláírásnál alapból üres. Az emailcsomag karbantartásnál a saját munkalapot és tájékoztatót tartalmazza, vásárlási nyilatkozatot nem.

A partneri hozzájárulás visszavonása külön művelet. A visszavonás szerveroldali időpontja megmarad, az eredeti aláírt szöveg nem változik, a későbbi előnézet és PDF jelzi a visszavonást. Új nyilatkozat, piszkozatként kiürítés vagy munkalaptörlés esetén az előző pillanatkép és visszavonási állapota védett előzménybe kerül. Az előzmény ügyféltörléskor sem tűnik el automatikusan; megőrzését és az érintetti törlési kérelem elbírálását a vállalkozás megőrzési szabályai szerint kell kezelni.

Aktiválás előtt adatbázismentés, a [`WORK_REPORT_PRIVACY_NOTICE.sql`](sql/WORK_REPORT_PRIVACY_NOTICE.sql) additív migrációja, majd az [`ellenőrző SQL`](sql/VERIFY_WORK_REPORT_PRIVACY_NOTICE.sql) szükséges. A vállalkozási és adatkezelési tényeket munkaterületenként kell jóváhagyni; hiányos beállításból nem készül ügyfél által aláírható tájékoztató. A munkalap melletti példány nem helyettesíti az adatbekéréskor szükséges tájékoztatást.

A külön karbantartási verziót támogató alkalmazáskiadás előtt a [`MAINTENANCE_PRIVACY_NOTICE.sql`](sql/MAINTENANCE_PRIVACY_NOTICE.sql) ismételhető migrációja és az [`ellenőrző SQL`](sql/VERIFY_MAINTENANCE_PRIVACY_NOTICE.sql) is szükséges. Ez kizárólag a már létező pillanatkép-ellenőrző függvényt bővíti; adatot nem tölt vissza, aláírást nem másol, jogosultságot nem ad és RLS-szabályt nem módosít.

### Számlák és admin elemek

- KLIMAlin/Alin számla;
- AMOVA 4U Kft. számla, ha alkalmazandó;
- NKVH;
- dokumentumok elküldése.

A tényleges elnevezést a jelenlegi UI és adatmodell szerint kell használni; dokumentációból nem szabad új számlatípust kitalálni.

## Karbantartási napló

A Dokumentumok részen legyen egyszerű dátumlista. Az email-értesítők helyett a dátum és a munkalap a fontos.

Minta:

```text
2026. 06. 02.    Megtekintés
2027. 06. 06.    Megtekintés
```

A `Megtekintés` a konkrét karbantartási munkalapot nyissa meg.

## Összes munkalap

Legyen lehetőség a szerelési munkalap és az összes karbantartási munkalap együttes megnyitására/nyomtatására, időrendi sorrendben. Ez garanciális ügyintézéshez szükséges.

## Lezárási ellenőrzőlista

Kulcsok a jelenlegi típus szerint:

- `worksheet`
- `signature`
- `purchaseDeclaration`
- `alinInvoice`
- `amovaInvoice`
- `nkvh`
- `docsSent`

Minden teljesített elemhez `completedAt` dátum tartozhat. A dátum a sor mellett jelenjen meg, ne külön idővonalban.

## Adatmegőrzési szabályok

1. Törlés helyett státusz vagy új verzió előnyben.
2. Egyedi adatbázis-constraint nem akadályozhatja, hogy egy ügyfélnek több karbantartási munkalapja legyen.
3. Szerelési és karbantartási munkalap külön típussal legyen megkülönböztethető.
4. Migráció előtt teljes kód- és adatbázismentés szükséges.
5. Korábbi dokumentumokat migráció közben számlálással és mintavétellel ellenőrizni kell.
