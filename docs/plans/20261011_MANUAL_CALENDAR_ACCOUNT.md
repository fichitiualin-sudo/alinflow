# Kézi Google Naptár-áttöltés célfiókja

## Cél

A munkaterület kézi `+ Naptár` gombja az ott megadott Google-fiókot válassza. Az eseményt a felhasználó a Google felületén menti el; automatikus összekapcsolás nem szükséges.

## Jelenlegi működés

A `calendar.ts` TEMPLATE linkje nem választ fiókot. A naptárkártyák emiatt a böngésző aktuális Google-fiókját használják. A céges kapcsolattartási email nem feltétlenül naptárfiók.

## Megváltoztathatatlan szabályok

- A kézi áttöltés nem kér OAuth-jogot, nem hoz létre tokent vagy automatikus eseményt.
- A meglévő automatikus kapcsolat és a kezelt időpontok gombelrejtése változatlan.
- A meglévő időpontok, ügyfelek és dokumentumok nem változnak.
- A célfiók munkaterülethez kötött; személyes cím nem kerül a repóba.

## Adatmodell

A meglévő `workspace_settings.company_profile` JSON mezőben egy opcionális, üresre alapértelmezett `manualCalendarEmail` érték. Típus, normalizálás, mentés, visszatöltés és beállítási UI együtt módosul. Nincs séma- vagy környezeti változó-módosítás.

## Implementációs lépések

1. Külön kézi célfiók mező a naptárbeállításoknál, meglévő beállításmentéssel.
2. A munkaterület mentett címének átadása mindkét fő naptárnézetnek és a TEMPLATE linknek.
3. Célzott link- és beállítás-visszatöltési ellenőrzés, TypeScript, build, mobil/asztali UI.
4. Élesítés után a kért munkaterület címének mentése, visszatöltés és linkellenőrzés esemény létrehozása nélkül.

## Ellenőrzés

- Üres mezővel a régi link változatlan; megadott címmel csak a célfiók változik.
- A link ügyfél/időpont adatai, időzónája és különböző munkatípusai megmaradnak.
- A mentés/visszatöltés megőrzi a beállítás többi mezőjét.
- `npx tsc --noEmit`, `npm run build`; hiányzó helyi környezetet külön jelezzük.

## Visszaállítás

A kézi célfiók mező kiürítése visszaállítja a korábbi fiókválasztást. Nem érint Google-eseményt vagy automatikus kapcsolatot.

## Google-fiókválasztás korlátja

A megadott email a TEMPLATE link `authuser` és `src` paraméterébe kerül. A Google saját fiókválasztását az AlinFlow nem tudja kikényszeríteni: ha a célfiók nincs bejelentkezve, másik fiókra válthat. Ezt szintetikus, el nem mentett esemény megnyitásával ellenőriztük. A felületen ezért szerepel a célcím és a bejelentkezés/naptár ellenőrzése a Google Mentés előtt. A beállítás nem jelenti a Google-fiók összekapcsolását.

## Módosított fájlok

- `src/lib/alinflow/workspace-settings.ts`
- `src/lib/alinflow/calendar.ts`
- `src/components/alinflow/SettingsPanel.tsx`
- `src/components/alinflow/CalendarPanel.tsx`
- `src/app/page.tsx`
- Célzott tesztek és ez a terv.

## Elkészült ellenőrzések

A célmező, meglévő JSON-mentés/visszatöltés és mindkét naptárnézet bekötése elkészült. 23 célzott teszt sikeres (kézi célfiók, eseménytartalom, automatikus szinkron kliens). A TypeScript-ellenőrzés sikeres. A helyi build fordítása és TypeScript-lépése sikeres, az oldaladatok gyűjtése a hiányzó helyi Supabase-környezet miatt leállt. A végső Vercel- és éles felületellenőrzés a kapcsolódó PR-ban követhető. Nem kell migráció vagy új környezeti változó. Google-esemény nem készült.
