# AlinFlow Next.js induló projekt

Ez egy első, egyszerű Next.js induló csomag az AlinFlow-hoz.

## 1. Mit csinálj vele?

1. Töltsd le a ZIP-et.
2. Csomagold ki.
3. Nyisd meg VS Code-dal az `alinflow_next_starter_v1` mappát.
4. A VS Code-ban nyiss terminált.
5. Írd be:

```bash
npm install
npm run dev
```

6. Ha lefutott, nyisd meg böngészőben:

```text
http://localhost:3000
```

## 2. Mit tud most?

- AlinFlow dashboard
- új lead képernyő
- ajánlatkészítő
- munkaoldal
- klíma választás
- anyaglista módosítás
- belső számlabontás:
  - Adorján Alin E.V.: 60.000 Ft
  - AMOVA 4U Kft.: teljes ár mínusz 60.000 Ft

## 3. Mi nincs még benne?

- valódi adatbázis
- belépés
- PDF
- email
- Számlázz.hu
- NKVH
- éles domain

Ezeket lépésenként kötjük rá.

## 4. Következő lépés

Ha ez fut a gépeden, utána jön:

- GitHub repo létrehozása
- Vercel feltöltés
- Supabase projekt
- első valódi ügyfél mentése adatbázisba


## AlinFlow Supabase admin verzió

- / oldalon bejelentkezés szükséges Supabase Auth-tal.
- Ügyfelek mentése: customers tábla.
- Ajánlatok mentése: quotes + quote_items táblák.
- Időpontok/munkák mentése: jobs tábla.
- Vercelben szükséges env változók:
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY

Feltöltés után a Vercel automatikusan új deployt indít.
