# Karbantartó partner kiválasztása AlinFlow-felhasználóból

## Cél
A felhasználó pontosítása szerint kizárólag az adatkezelési tájékoztató partnerét választjuk ki létező AlinFlow-fiókból. A térkép két eredetszűrője az állapotszűrők folytatásában, azonos stílusú pipaként jelenik meg.

## Jelenlegi működés
A PrivacyNoticeSettings a partner öt vállalkozási adatát szabad mezőkben szerkeszti. A beállítás a workspace_settings.document_settings.privacyNotice része; aláíráskor változatlan történeti pillanatkép készül. A MaintenanceOriginEditor átadó mezője külön fogalom, nem a leendő karbantartó.

## Megváltoztathatatlan szabályok
- Nem adunk partner-hozzáférést, munkaterületi tagságot vagy karbantartási megbízást.
- Meglévő aláírt dokumentumokat és hozzájárulásokat nem módosítunk.
- Teljes felhasználói címtár helyett pontos email alapján keresünk, csak aktív fiók aktív vállalkozását.
- A válasz kizárólag a kiválasztáshoz szükséges azonosítókat és a vállalkozási adatokat tartalmazza; titkokat, teljes Auth-rekordot vagy egyéb beállítást nem.
- Korábbi kézzel rögzített partner nem veszhet el automatikusan.

## Adatmodell
A PrivacyNoticeConfig opcionális partnerUserId és partnerWorkspaceId mezőt kap a meglévő JSON-beállításon belül, a PrivacyParty és aláírt pillanatkép sémája változatlan. Egy szolgáltatói szerepkörre korlátozott kereső RPC csak pontos email vagy konkrét felhasználó/munkaterület pár alapján ad vissza találatot. A kliens közvetlenül nem hívhatja; szerveroldali, munkaterülethez kötött hitelesítés előzi meg.

## Implementációs lépések
1. Térképszűrők célzott megjelenítési változtatása.
2. Hitelesített kereső/visszaellenőrző API és minimális SQL RPC.
3. Keresés, találat kiválasztása, kitöltött vállalkozási adatok, partner eltávolítása a beállításokban.
4. Hivatkozások mentése/visszatöltése; mentés előtt a kiválasztott fiók és vállalkozási adatok szerveroldali újraellenőrzése.
5. Célzott jogosultsági és dokumentummegőrzési tesztek, mobil/asztali próba, tsc/build, migráció és kiadás.

## Ellenőrzés
- Jogosulatlan kérés, más munkaterület, hibás email, inaktív célfiók, hiányos cégadat, hamisított azonosítópár.
- Partner kiválasztás/eltávolítás, visszatöltés, régi kézi partner megőrzése; aláírt pillanatkép változatlan.
- A két független térképpipa az állapotszűrők után szerepel mobilon és asztalon.
- npx tsc --noEmit; npm run build; célzott tesztek és teljes tesztcsomag.

## Visszaállítás
A felület/API visszaállítható, a JSON-ban levő partner és hivatkozások megőrzendők. Az RPC használaton kívül maradhat; meglévő adatot nem törlünk.

## Módosított fájlok és eredmény
- Térképfelület: `src/components/alinflow/MaintenanceMapPanel.tsx`.
- Partner választófelület: `PrivacyPartnerPicker.tsx`, `PrivacyNoticeSettings.tsx`, `SettingsPanel.tsx` a `src/components/alinflow/` alatt.
- Mentés: `src/app/page.tsx`, `src/lib/alinflow/privacy-notice.ts`, `privacy-partner.ts`, `privacy-partner-client.ts`.
- Szerver: `src/app/api/privacy-partner/route.ts`, `src/lib/alinflow/privacy-partner-server.ts`; migráció: `docs/sql/20261011_PRIVACY_PARTNER_LOOKUP.sql`.
- Tesztek: `tests/privacy-partner-client.test.cjs`, `privacy-partner-route.test.cjs`, `privacy-partner-settings.test.cjs`, `privacy-partner-sql.test.mjs`.
- Dokumentáció: ez a terv, `docs/DATA_MODEL.md`, `docs/SCREENS_AND_UX.md`.
- `npm test`: 837 sikeres, 5 kihagyott, 0 hibás. Külön PGlite SQL-ellenőrzés: 10/10. TypeScript sikeres.
- A helyi build fordítása és típusellenőrzése sikeres; az oldaladatgyűjtés a meglévő `/api/h-tariff/pdf` route hiányzó `NEXT_PUBLIC_SUPABASE_URL` beállításán áll meg. Konfigurált Vercel-build külön ellenőrizendő.
- Mobil/asztali szintetikus böngészős próba: kompakt térképpipák működnek; partnerkeresés és kifejezett kiválasztás kitölti a megfelelő cégadatokat; 390×844 mobilon nincs vízszintes túlcsordulás. Régi partner és aláírt pillanatképek megőrzése tesztelve.
- Új környezeti változó nem szükséges: a meglévő Supabase URL, anon és kizárólag szerveroldali service-role kulcs használatos. Nincs partner-hozzáférés vagy ügyféladat-átadás.
- Éles migráció sikeres: a két munkaterület teljes beállítása védett, kliensjogosultság nélküli visszaállítási másolatba került. 11/11 tranzakciós ellenőrzés igazolta a beállítások, a meglévő táblajogosultságok/RLS/policyk változatlanságát, a mentés védelmét és a keresőfüggvény kizárólag szerveroldali hívhatóságát. A helyi aktiválási próbák a hibás állapot miatti teljes visszagörgetést is ellenőrizték.
