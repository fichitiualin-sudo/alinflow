# Többcéges AlinFlow – jövőbeli terv

## Státusz

**TERV – jelenleg nem implementálandó.**

Előfeltételek:

1. AlinFlow 1.0 üzleti logikája végleges;
2. regressziós tesztlista teljesül;
3. kódmentés elkészült;
4. teljes Supabase adatbázismentés elkészült;
5. tesztkörnyezet rendelkezésre áll.

## Cél

Egy közös alkalmazás és kódbázis, ahol minden cég saját:

- névvel és felhasználókkal;
- ügyfelekkel;
- logóval;
- naptárral;
- ajánlatokkal;
- dokumentumokkal;
- raktárkészlettel;
- termékekkel és árakkal;
- email aláírással és értékelési linkekkel rendelkezik.

A működés, dizájn és közös sablonok központilag frissülnek.

## Javasolt architektúra

```text
companies
├── company_members
├── company_settings
├── customers
├── quotes
├── jobs / appointments
├── documents
├── work_reports
├── inventory_stock
├── material_inventory
└── climate_products
```

Minden üzleti rekordhoz `company_id` tartozik.

## Biztonság

A frontend-szűrés önmagában nem elegendő. Kötelező:

- Supabase Auth;
- Row Level Security minden céges táblán;
- policy, amely csak a felhasználó saját cégének sorait engedi;
- service-role kulcs kizárólag szerveren;
- adatkeveredési tesztek két tesztcéggel.

## Cégbeállítások

- cégnév;
- logó;
- telefonszám;
- weboldal;
- email feladó/aláírás;
- Google/Facebook értékelési link;
- ajánlat- és munkalapfejléc;
- alap szerelési árak;
- engedélyezett termékek;
- naptár-integráció.

## Szerepkörök

Első verzió:

- tulajdonos;
- munkatárs.

Később:

- admin;
- szerelő;
- irodai munkatárs;
- csak olvasó.

## Migrációs stratégia

1. teljes backup;
2. `companies` és tagsági táblák;
3. KLIMAlin létrehozása első cégként;
4. `company_id` hozzáadása nullable módban;
5. meglévő adatok hozzárendelése KLIMAlinhoz;
6. ellenőrző számlálások;
7. `NOT NULL` és indexek;
8. RLS policyk;
9. második tesztcég;
10. adat-izolációs teszt;
11. csak ezután éles többcéges használat.

## Nem cél az első verzióban

- külön Supabase projekt minden cégnek;
- automatikus számlázás/előfizetés;
- nyilvános önkiszolgáló regisztráció;
- bonyolult szerepkör-mátrix;
- egyedi kódág cégenként.
