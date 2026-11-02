# Google Névjegyek napi ellenőrzése

## Cél
A kapcsolt névjegyek automatikus ellenőrzése naponta egyszer, hajnali 03:00 UTC-től történjen. A kézi frissítés és az újonnan jóváhagyott névjegyek áttöltése továbbra is azonnal indítható.

## Jelenlegi működés
A Supabase percenként ellenőrzi az esedékes sort. A Vercel worker nyolc névjegyet dolgoz fel, minden siker után öt percre újraütemezve őket; emiatt több száz névjegynél folyamatos a feldolgozás. Az éles mérés szerint ez adta a 12 órás CPU-fogyasztás körülbelül 92%-át.

## Megváltoztathatatlan szabályok
- Csak korábban jóváhagyott névjegyek frissülhetnek, új címzett és jogosultság nélkül.
- A munkaterület-szűrés, zárolás, Google-marker, ETag-ellenőrzés és bizonytalan írások védelme megmarad.
- A 45 másodperces worker és nyolcas adag megmarad; a napi kör több részletből állhat.
- Névjegyet, ügyfelet, dokumentumot vagy naptáreseményt nem törlünk.

## Adatmodell
Új tábla és mező nem szükséges. A meglévő next_sync_at tárolja a következő napi időpontot. Az egyszeri, újrafuttatható aktiváló SQL a már szinkronizált névjegyek régi ötperces ütemezését állítja át, a feldolgozandó és ellenőrzendő rekordok megőrzésével.

## Implementációs lépések
1. Közös, tesztelhető következő napi időpont számítása; minden siker és próbált hiba napi visszaütemezése.
2. Teljes kör betöltési hibájánál csak a kör kezdetekor már esedékes tételek halasztása; új jóváhagyások és más munkaterületek védelme.
3. Kifejezett kézi frissítés új kört indíthat, az egyszerű jóváhagyási hívás nem.
4. Rövid napi működésjelzés és üzemeltetési dokumentáció, célzott regressziós tesztek.
5. Típusellenőrzés, build, ellenőrzött kiadás, a napi ütemezés éles aktiválása és visszaolvasása.

## Ellenőrzés
- Napi időpont: határidő előtt/után, évforduló, nyári/téli időszak.
- Több mint nyolc esedékes névjegy teljes feldolgozása, aznap nincs ismétlés.
- Külső hiba nem indít folyamatos újrapróbálást; bizonytalan létrehozás nem dupláz.
- Kézi frissítés és jóváhagyás eltérő hatóköre, munkaterület-védelem.
- Meglévő Google Contacts tesztek, npx tsc --noEmit, npm run build.
- Éles, csak olvasási ellenőrzés az ütemezésről és sorállapotról; valódi névjegyírás tesztként nem szükséges.

## Visszaállítás
A korábbi alkalmazáskiadás visszaállítható. Az ütemezés időbélyegei adatvesztés nélkül visszaállíthatók; a névjegy-azonosítókat és állapotokat az aktiválás nem érinti. A percenkénti üres ellenőrzés nem hívja a Vercelt.

## Módosított fájlok
- `src/lib/alinflow/google-contacts-schedule.ts`, `google-contacts-sync.ts`
- `src/app/api/google-contacts/sync/route.ts`
- `src/components/alinflow/GoogleContactsSettingsPanel.tsx`
- `docs/sql/20261102_GOOGLE_CONTACTS_DAILY_SYNC.sql`, a CRON sablon bevezetője
- `docs/GOOGLE_CONTACTS_SETUP.md`, ez a terv
- A Google Contacts schedule/sync/routes/UI regressziós tesztek és a tesztadatbázis összehasonlító szűrői

## Ellenőrzési eredmény és kiadás
- 116 névjegykezelési teszt sikeres; valódi Google-kérés nélkül.
- `npx tsc --noEmit` sikeres. A build az elkülönített munkapéldányban hiányzó publikus Supabase-környezeti értékek miatt először megállt; szintetikus publikus buildértékekkel teljesen sikeres. Az éles Vercel-build a projekt meglévő környezetét használja.
- Natív PostgreSQL, teljesen visszagörgetett tranzakció: első aktiválás 450 ütemezést módosítana, második 0-t. Az ellenőrzendő rekord érintetlen.
- Új környezeti változó, jogosultság és Google-engedély nem szükséges. A Google Naptár ütemezése nem változik.
- Kiadáskor csak a névjegy-cront kell röviden szüneteltetni, a futó adag befejezését megvárni, a fenti aktiváló SQL-t futtatni, majd ugyanazt a feladatot visszakapcsolni. A napi teljes kör nem egyetlen HTTP-kérés: 450 névjegynél körülbelül 57 rövid részlet.
- A már elfogyasztott Vercel-keretet a javítás nem állítja vissza. A tényleges CPU-megtakarítást a kiadás utáni használati kimutatás igazolja.
