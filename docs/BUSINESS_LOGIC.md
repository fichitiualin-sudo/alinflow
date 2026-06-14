# Üzleti folyamatok

## 1. Teljes ügyfél-életút

```text
Érdeklődés
  ├─ közvetlen árajánlat
  └─ opcionális felmérés
         ↓
      árajánlat
         ↓
  szerelési időpont
         ↓
      telepítés
         ↓
adminisztratív lezárás
         ↓
      lezárt ügyfél
         ↓
karbantartás #1, #2, #3 ...
```

## 2. Érdeklődő

### Rögzítés

Érdeklődő érkezhet:

- kézi rögzítéssel;
- CSV/Meta importból;
- más későbbi integrációból.

Fontos mezők:

- név;
- telefonszám;
- email;
- irányítószám;
- település;
- cím;
- forrás;
- igény és megjegyzés;
- érdeklődés időpontja.

CSV importnál az eredeti érdeklődési dátumot kell használni, ha a fájlban felismerhető. A listában mindig a legfrissebb érdeklődő legyen elöl.

### Hívás

A hívás gomb megnyomásakor a hívás ideje naplózható. A telefonszám mellett egyetlen hívásgomb legyen; duplikált hívásgomb nem megengedett.

## 3. Felmérés

A felmérés **opcionális**, nagyjából az ügyek kisebb részében szükséges.

Célja:

- helyszínen megvizsgálni, hová és hogyan telepíthető a klíma;
- bonyolultabb műszaki megoldást személyesen egyeztetni;
- pontos árajánlathoz információt gyűjteni.

Szabályok:

- az árajánlat előtt történik;
- nem kell előtte klímát választani;
- nem foglal és nem von le raktárkészletet;
- 1 órás időpont;
- ajánlott idők mellett egyedi kezdési idő is megadható;
- befejezése után a következő fő művelet az **Árajánlat készítése**;
- nem igényel szerelési munkalapot vagy vásárlási nyilatkozatot.

## 4. Árajánlat

### Árkezelési módok

#### Egyben értendő ajánlat (`bundle`)

A tételek egy közös megrendelés részei. A rendszer összesített végösszeget számol.

#### Külön-külön értendő alternatívák (`alternatives`)

A felsorolt klímák közül az ügyfél választ. A tételeket nem szabad összeadni. Az előnézetnek, emailnek és nyomtatható ajánlatnak ugyanazt a logikát kell mutatnia.

### Kötelező megjelenés

- ajánlat időpontja;
- ügyféladatok;
- tételek;
- mennyiség;
- szereléssel együtt értendő ár;
- bundle esetén egyetlen `Összesen` sor;
- alternatívák esetén esztétikus `1. lehetőség`, `2. lehetőség` jelölés.

Nem jelenhet meg felesleges belső ár- vagy költségbontás az ügyfélnek szánt ajánlatban.

### Státusz

Árajánlat elküldése után az ügyfél `Ajánlat elküldve` státuszba kerülhet. Ha az ajánlat elfogadása után időpontot kapott, ne maradjon a kiküldött ajánlatok listájában.

## 5. Szerelési időpont

Alapértelmezett időponttípus: `installation`.

Ajánlott sávok:

- 08:00–12:00;
- 12:00–16:00;
- +1 időpont, jellemzően 16:00 után.

Az időpont legyen módosítható, és az ütközést ellenőrizni kell. Több klíma hosszabb időt igényelhet; a tényleges jelenlegi időtartam-logikát az `appointments.ts` tartalmazza.

Szerelési időpontnál:

- kiválasztott klímák és szerelési anyagok kapcsolódnak hozzá;
- készletfoglalás vagy készletlevonás csak szerelésnél történhet;
- Google Naptár esemény készíthető;
- visszaigazoló email küldhető.

## 6. Telepítés és munkaoldal

A munkaoldalon kezelhető:

- időpont és időpontmódosítás;
- időponthoz tartozó klímák;
- szerelési anyagok;
- munkalap és aláírás;
- vásárlási nyilatkozat;
- számlák/NKVH/dokumentumküldés ellenőrzése;
- lezárási műveletek.

A munka készre jelölése után a szerelési erőforrások zárolhatók, de a felhasználó kérésére célzott módosítás engedélyezhető.

## 7. Lezárás

Állapot:

`Szerelés kész – admin folyamatban`

akkor használható, amikor a fizikai munka elkészült, de az adminisztráció még nincs teljesen lezárva.

A teljes lezárás előtt ellenőrizendő:

- munkalap kitöltve;
- ügyfél aláírása megvan;
- vásárlási nyilatkozat elkészült;
- szükséges számlák elkészültek;
- NKVH/admin teendő kész;
- dokumentumok elküldve.

Az ellenőrzőlista elemei mellett a teljesítés dátuma jelenjen meg. Munkalap és vásárlási nyilatkozat csak tényleges aláírás után lehet kész.

Teljes lezárás után az ügyfél `Lezárva` státuszba kerül.

## 8. Karbantartás

### Szerepe

A telepített klímát jellemzően évente karban kell tartani. Egy készüléknél 5–10 vagy még több karbantartás is előfordulhat. A munkalapok a garancia és későbbi hibakezelés miatt megőrzendők.

### Szabályok

- csak telepítés után értelmezhető;
- lezárt ügyfélnél is elérhető;
- az új karbantartás gomb csak a `Karbantartási napló` részen legyen;
- 1 órás időpont;
- ajánlott idők mellett egyedi idő megadható;
- két szerelés közé is beilleszthető, ha nincs ütközés;
- nem foglal és nem von le új klímakészletet;
- nem írhatja felül az ügyfél szerelési időpontját és dokumentumait;
- minden alkalom külön rekord és külön munkalap;
- karbantartás lezárásához legyen megfelelő munkalap és aláírás;
- a karbantartás dátuma és munkalapja később megtekinthető/letölthető.

### Karbantartási napló megjelenése

Egyszerű, naplószerű lista:

```text
Karbantartási napló

2026. 06. 02.    Megtekintés
2027. 06. 05.    Megtekintés
2028. 05. 28.    Megtekintés
```

Ne jelenjen meg nagy kártyarengeteg vagy külön karbantartási idővonal.

### Lemondás

Karbantartási időpont lemondásakor:

- csak az adott karbantartás legyen lemondva;
- kerüljön ki a naptárból;
- a klímatelepítés és az ügyfél lezárt státusza maradjon;
- korábbi dokumentumok maradjanak elérhetők;
- az egész ügyfél nem kerülhet `Lemondva` státuszba.

## 9. Köszönő email

Telepítés után kézzel küldhető. Ne menjen ki automatikusan próba vagy félkész ügyfélnél. Nem tartalmazza a klíma árát. Tartalmazhat Google- és Facebook-értékelési gombot.

## 10. Archív ügyfelek

A `Lezárva` és `Lemondva` státuszú ügyfelek külön listában jelennek meg. Lezárt ügyfél megnyitásakor:

- korábbi dokumentumok visszanézhetők;
- karbantartási napló látható;
- új karbantartás indítható a naplóból.
