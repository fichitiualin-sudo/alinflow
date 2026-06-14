# Ismert kockázatok és nyitott pontok

## 1. Időponttörténet

A jelenlegi domain-típusban az ügyfélnek egy fő `date`, `time` és `appointmentType` mezője van, miközben az életút több eseményt tartalmazhat. A karbantartási munkalapok már több rekordot képeznek, de a teljes eseménytörténet hosszú távon külön appointment táblát igényelhet.

Ezt csak külön migrációs tervvel szabad átépíteni.

## 2. Központi `page.tsx`

A fájl sok felelősséget kezel. Célzott refaktor indokolt lehet, de működési stabilizálás előtt nem szabad nagy újraírásba kezdeni.

## 3. Supabase séma dokumentálása

A repo SQL fájljai és az élő Supabase séma eltérhetnek. A véglegesítés része legyen egy tényleges sémadump vagy kézzel ellenőrzött adatmodell.

## 4. Automatikus tesztek

Jelenleg a fő ellenőrzés TypeScript build és kézi regressziós teszt. A kritikus funkciókhoz később integrációs tesztek szükségesek:

- alternatív ajánlat;
- időpont-ütközés;
- karbantartás lemondása;
- több munkalap megőrzése;
- checklist dátumok;
- készlet egyszeri levonása.

## 5. Email- és naptárintegráció

A környezeti változók és külső szolgáltatások külön dokumentálása szükséges az éles deploymenthez. Titkok nem kerülhetnek a repóba.
