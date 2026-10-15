# Google Névjegyek – beállítás és üzemeltetés

## Hatókör
A munkaterület tulajdonosa/adminisztrátora külön Google-hozzájárulással kapcsolódik. A Calendar-kapcsolat megmarad, külön OAuth-állapot és titkosított Contacts-token keletkezik. Azonos Google-fiók csak egy munkaterülethez kapcsolható; a meglévő kapcsolat másik Google-fiókra nem irányítható át automatikusan.

Kizárólag saját, nem lemondott, már elvégzett telepítéssel rendelkező ügyfél kerül előnézetbe. Egy ügyfél egy névjegy, minden saját telepítése összefoglalva. A karbantartásra átvett rekordok és megosztási tükörtelepítések kimaradnak. Árak, belső jegyzetek, képek, aláírások nem részei a kivetítésnek.

## Előkészítés
1. Az érintett éles sémát és jogosultságokat olvasással auditálni kell. Alkalmazandó: `docs/sql/GOOGLE_CONTACTS_SYNC.sql`. Először visszagörgetett tranzakcióban, majd ellenőrzött aktiválással; a migráció ismételhető és meglévő ügyfél/időpont/dokumentum sort nem ír.
2. A meglévő Google Cloud projektben a People API szükséges; az OAuth webalkalmazásban a `${GOOGLE_CALENDAR_APP_URL}/api/google-contacts/callback` pontos HTTPS URI-t hozzá kell adni a már meglévő Calendar callback megtartásával.
3. Külön kérendő scope: `https://www.googleapis.com/auth/contacts` + OpenID email. Ez tág Google-kezelési engedély; a felhasználó külön engedélyező oldala kötelező. A Google-figyelmeztetéseket a felhasználó kezeli. Új feltételek elfogadása csak felhatalmazással.
4. A meglévő szerveres `GOOGLE_CALENDAR_CLIENT_ID`, `_CLIENT_SECRET`, `_TOKEN_KEY`, `_APP_URL` és `_CRON_SECRET` marad. A Contacts-titkosítás elkülönített AAD-környezetet használ. Az új `GOOGLE_CONTACTS_ENABLED=true` kapcsoló csak a beállítások elkészülte után aktiválandó; hiányában a funkció nem kapcsolható össze.
5. A `/adatvedelem/google-nevjegyek` oldal ismerteti a működést, adatköröket, tárolást és visszavonást. A naptár tájékoztatója hivatkozik rá.
6. A külön `docs/sql/GOOGLE_CONTACTS_CRON.sql` a már létező Vault-beállításokat használja, a naptár feladatát nem módosítja. A net/vault kizárását a Data API-ból ellenőrizni kell. A feladat percenként ellenőrzi a várakozó sorokat; nem indít névjegyírást kapcsolat és jóváhagyott ügyfél nélkül.

## Használat
Beállítások → Google Névjegyek → fiók összekapcsolása → Ügyfelek áttöltése · előnézet. Tíz ügyfél/oldal, kezdetben nincs kiválasztás. Pontos normalizált telefon/email-egyezést ajánl fel; név alapján nem kapcsol össze. Több CRM-ügyfélhez tartozó elérhetőséget ellenőrzendőnek jelöl. Jóváhagyáskor a szerver újraolvassa a forrásokat és a Google-egyezéseket; lejárt vagy megváltozott előnézetből nem indul áttöltés.

Az új összerendelések külön jóváhagyást igényelnek. A jóváhagyott kapcsolatok a háttérben frissülnek, változásnál előresorolva. A Google-ban kézzel szerkesztett adatot megőrizzük vagy ütközésként jelezzük. Az iPhone-on a kapcsolt Google-fióknál a Kontaktok szinkronizálását be kell kapcsolni; a telefon frissítési ütemezését a készülék kezeli.

## Ismételt futás és hibák
- Kapcsolatonként atomikus 120 másodperces foglalás; legfeljebb 45 másodperces munkamenet, soros Google-írások.
- A Google-létrehozás előtt tartós szándék és egyedi marker kerül mentésre. Megszakadt kérés után kizárólag marker-visszakeresés történhet; nincs vak második létrehozás.
- Módosítás előtt a célművelet külön pillanatképben megmarad. Elveszett válasz után csak az igazoltan egyező Google-állapot fogadható el. Az ETag-ütközés friss olvasást és összeolvasztást indít.
- Teljes lapozás kötelező; hibás vagy csonka telefonkönyv nem tekinthető üresnek.
- Szüneteltetés megőrzi a névjegyeket, összerendeléseket és a titkosított tokent. A már folyamatban lévő kérés befejeződhet. A Google-fiókban végzett teljes AlinFlow-hozzáférés-visszavonás a Calendar engedélyét is érintheti.
- Törölt/eltűnt vagy már nem saját telepítéshez tartozó ügyfél Google-névjegyét nem töröljük és nem hozzuk létre újra; ellenőrzést kérünk.
- A még meg sem kísérelt írás miatti ellenőrzés új előnézetből újra jóváhagyható. Bizonytalan vagy már módosított rekord nem nullázható vakon; szükség esetén a Google-névjegy és a mentett műveleti állapot összevetése kell.

## Ellenőrzési eredmény
2026-10-15: éles séma olvasási auditja és kétszeri migráció visszagörgetett tranzakcióban sikeres; böngészős táblahozzáférés/RPC tiltás, fiókcsere tiltása, jóváhagyás, kizáró foglalás és szüneteltetés ellenőrizve. A helyi tesztek valódi Google-kérést nem küldenek. Éles OAuth és valós névjegyáttöltés külön felhasználói lépés.

## Hivatalos leírások
- https://developers.google.com/people/api/rest/v1/people.connections/list
- https://developers.google.com/people/api/rest/v1/people/createContact
- https://developers.google.com/people/api/rest/v1/people/updateContact
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://support.apple.com/en-us/111793
