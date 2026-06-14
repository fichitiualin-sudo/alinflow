# Elfogadott termékdöntések

Ez a fájl megakadályozza, hogy egy későbbi módosítás véletlenül visszahozzon már elvetett megoldásokat.

## Projektstruktúra

- Döntés: `src/app` App Router struktúra.
- Tiltás: gyökér `app/` mappa létrehozása.

## UI

- A nagy, ismétlődő felső fejléc/modal blokkok eltávolítva.
- Ügyfél idővonal külön állandó blokkja nem szükséges.
- A releváns dátum a státusz, lezárási művelet, checklist vagy karbantartási napló mellett jelenjen meg.
- Telefonszám mellett egy hívásgomb legyen.
- Irányítószám/település kitöltéshez nincs legördülő találati panel.
- Listák oldalmérete 10.

## Árajánlat

- Két mód: egyben értendő vagy külön-külön alternatíva.
- Alternatívák nem adódnak össze.
- Ügyféloldali dokumentumban nincs belső ár- és költségbontás.
- Az előnézetnek és az emailnek szinkronban kell lennie.

## Időpontok

- Típusok: szerelés, felmérés, karbantartás.
- Felmérés opcionális, az ajánlat előtt.
- Felmérés után ajánlat következik.
- Karbantartás telepítés után, lezárt ügyfélnél is.
- Felmérés és karbantartás 1 órás.
- Ajánlott idők mellett egyedi idő megadható.

## Dokumentumok

- Munkalap és nyilatkozat csak aláírás után kész.
- Karbantartás nem írja felül a szerelési dokumentumokat.
- Minden karbantartás külön munkalap.
- Karbantartási napló egyszerű dátum + megtekintés lista.
- Új karbantartás gomb csak a naplóban.
- Karbantartási email/értesítő nem elsődleges hosszú távú dokumentum.

## Google Naptár

- A klíma ára ugyanabban a `Klíma:` sorban jelenik meg.
- Nincs külön `Ár:` sor.

## Köszönő email

- Nincs benne ár.
- Tartalmaz Google és Facebook értékelési lehetőséget.
- Google review link: `https://g.page/r/CaTB2608T1bZEBM/review`.

## Többcéges rendszer

- Elvi irány elfogadva.
- Megvalósítás csak az AlinFlow 1.0 stabilizálása és mentése után kezdhető.
- Javasolt architektúra: közös kód + közös adatbázis + `company_id` + Supabase RLS.
