# Google Naptár tájékoztató – jóváhagyott szöveg

Az oldal forrása: `src/app/adatvedelem/google-naptar/page.tsx`.
Cím: `/adatvedelem/google-naptar`.
A felhasználó **2026-10-08-án kifejezetten jóváhagyta a szöveg közzétételét**. A tervezetjelzés eltávolítva; a jóváhagyott üzleti tartalom változatlan. A #123 PR éles telepítése után az oldal megnyitását 390×844 és 1440×900 nézetben ellenőriztük. Az oldal bejelentkezés nélkül elérhető, keresőindexelés nélkül; a Google Branding beállításban a hivatkozás mentve.

## A szöveg forrása

- `google-calendar-auth.ts`, `api/google-calendar/connect/route.ts`, `callback/route.ts`: Google-fiókazonosítás, jogosultságok, titkosított token, átmeneti állapot és süti.
- `google-calendar-event.ts`, `google-calendar-sync.ts`: a továbbított CRM-adatok, az elsődleges naptár, az esemény-azonosítás, vendégek nélküli események, a beszerzési adatok kizárása.
- `api/google-calendar/disconnect/route.ts`, `docs/sql/GOOGLE_CALENDAR_SYNC.sql`: a szüneteltetés adatmegőrzése, a tartós szinkronizálási sor és az önkiszolgáló teljes törlés hiánya.
- [Google Naptár jogosultságok](https://developers.google.com/workspace/calendar/api/auth) és [Google-fiók kapcsolatok kezelése](https://support.google.com/accounts/answer/13533235?hl=hu): a Google-hozzáférés terjedelme és visszavonása.

## Jóváhagyás és működési keretek

1. A jóváhagyott szöveg tartalmazza az ügyfél-elérhetőségek, megjegyzések és eladási árak naptárba kerülését.
2. A kapcsolattartás első pontja a munkaterület tulajdonosa. A szerveroldali `EMAIL_REPLY_TO` csak érvényes, biztonságosan megjeleníthető email-címként kerülhet az oldalra; nincs beégetett személyes cím.
3. A szöveg nem ígér automatikus teljes adattörlést, meghatározott megőrzési határidőt vagy általános jogszabályi megfelelést.
4. A nyilvános oldal és a Google-beállításban szereplő hivatkozás éles ellenőrzése megtörtént.

## Minimális felületi hivatkozás

A `GoogleCalendarSettingsPanel.tsx` összekapcsolási gombja alatt és a bejelentkezési oldal láblécében is szerepel a „Google Naptár adatkezelési tájékoztató” hivatkozás. Új lapon nyílik, hogy a beírt adatok megmaradjanak.
