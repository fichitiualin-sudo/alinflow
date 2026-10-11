# Dokumentumok és lezárási adminisztráció

## PDF-küldés és dokumentumfelület

A munkalap mentési képernyőjén a **Mentés és PDF-ek küldése** előbb elmenti a munkalapot és a hozzá tartozó vásárlási nyilatkozatot, majd ezek azonosítóival hívja a szervert. A szerver az adott munkaterület, ügyfél és időpont mentett, aláírt rekordjaiból készít valódi PDF-mellékleteket. Karbantartásnál csak a karbantartási munkalapot küldi. A Dokumentumok gombjaival a mentett példányok ismét elküldhetők, szerkesztés nélkül is.

A PDF megőrzi a dokumentum saját aláírását, magyar ékezeteit és a mentett adatpillanatképet. Hiányzó vagy más időponthoz tartozó dokumentumot nem helyettesít a legutóbbi ügyféldokumentummal. A PDF-ek a küldéskor készülnek, nem foglalnak külön Supabase Storage tárhelyet.

A munkalap 2026-10-11-től modern, fehér alapú, visszafogott türkiz arculatot használ az előnézetben, HTML-exportban és email-PDF-ben. A saját munkaterület márkaneve, az ügyfél- és munkaadatok, készülékek, munkaleírás, megjegyzés és aláírás elkülönülnek. A hosszú tartalom további oldalakon folytatódik, nem vágódik le.

A vásárlási nyilatkozat az eredeti, eladói mezőket is tartalmazó `vasarlasi_nyilatkozat_0416.pdf` mintát követi I. és II. példánnyal. Az email-PDF az üres eredeti nyomtatványra helyezi a mentett adatokat és a nyilatkozat saját aláírását. A rendelkezésre álló helyre olvashatóan nem férő adatok és készüléklisták hivatkozott mellékletben, teljes egészükben szerepelnek. A keltezés a mentett aláírás budapesti dátuma, nem a megnyitás napja. Az előnézet és a HTML-export ugyanezt a fekete-fehér, Times betűs elrendezést követi. A korábbi mentett dokumentumadatokat a megjelenés változása nem módosítja.

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
