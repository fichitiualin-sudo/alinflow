# Ügyfelenként több árajánlat

Az ügyfélhez tartozó új ajánlat önállóan szerkeszthető és küldhető. Az ügyfél ajánlati előzményeiben a mentett ajánlatok és az elküldött változatok árai, készülékei és dátumai visszakereshetők. A választási lehetőségek ára külön értendő.

A korábbi kliens az aktív ajánlat tételeit cseréli, és ügyfélhez vagy munkához kötött küldési nyugtát vezet. Felülírt történeti árat nem szabad a mai katalógusárból előállítani.

1. Önálló ajánlatszerkesztő indítása a meglévő ügyfélhez. A kapcsolt munkák árajánlatát, időpontját és állapotát meg kell őrizni.
2. A kiküldött változatok tartós tárolása mindkét küldési útvonalon. Hibánál azonos küldés újrapróbálható. A mentett és a bizonyítottan elküldött tételek megkülönböztetése.
3. Korábbi ajánlatok listája az ügyfélhez és munkaterülethez szűrve, csak olvasható részletekkel.
4. Két külön ajánlat, változatlan korábbi ár, alternatívák, mentési és küldési hibák, munkaterületi elszigetelés ellenőrzése, majd típusellenőrzés és build.

Visszaállításkor az elküldött változatokat meg kell őrizni. A fejlesztés ellenőrzéséhez kizárólag szintetikus ajánlatok küldése szimulálható.

## Elkészült változtatás és kiadási sorrend

A mentett ügyfélhez az adatlapról, a munkalapról és az ajánlatszerkesztőből is új ajánlat nyitható. Az elküldött változat külön sorba kerül. A „Mentett ajánlatok” az eddig is létező ajánlati rekordokat olvassa. A régi küldési nyugták alapján történeti tétel vagy ár visszatöltésére nem kerül sor.

Elsőként a `docs/sql/20261118_QUOTE_DELIVERY_HISTORY.sql` migrációt kell telepíteni és a mellette lévő VERIFY lekérdezést futtatni. Ezután adható ki az alkalmazás. Az API a már meglévő szerveroldali `SUPABASE_SERVICE_ROLE_KEY`, Supabase és Resend beállításokra támaszkodik. A kliens csak a saját munkaterületén visszaigazolt küldéseket olvashatja. A nyers levélküldési kérés csak szerveroldalon hozzáférhető.

A kliensváltozások a `page.tsx`, ajánlat-, ügyfél- és munkaoldali panelek, valamint a szerkesztési és újrapróbálási segédek körét érintik. A szerverváltozás a send-quote végpont, az archiváló modul és az SQL. A kapcsolódó funkcionális és jogosultsági ellenőrzések a `tests/` alatt találhatók.

A típusellenőrzés és az alkalmazás buildje sikeres. A helyi adatbázispróba, a bizonytalan küldés megismétlése, a két ajánlat eltérő ára és a felmérés változatlansága ellenőrizve. Szintetikus adatokkal a 390 és 1440 képpont széles nézet is elfér.
