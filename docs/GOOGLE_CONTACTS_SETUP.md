# Google Névjegyek – beállítás és üzemeltetés

## Hatókör
A munkaterület tulajdonosa/adminisztrátora külön Google-hozzájárulással kapcsolódik. A Calendar-kapcsolat megmarad, külön OAuth-állapot és titkosított Contacts-token keletkezik. Azonos Google-fiók csak egy munkaterülethez kapcsolható; a meglévő kapcsolat másik Google-fiókra nem irányítható át automatikusan.

Kizárólag saját, nem lemondott, már elvégzett telepítéssel rendelkező ügyfél kerül előnézetbe. Alapértelmezetten egy ügyfél egy névjegy, minden saját telepítése összefoglalva. Kifejezetten azonos személynek megerősített, még nem kapcsolt ügyféladatlapok külön előnézetben közös névjegyhez rendelhetők; a CRM-rekordok nem egyesülnek. A karbantartásra átvett rekordok és megosztási tükörtelepítések kimaradnak. Árak, belső jegyzetek, képek, aláírások nem részei a kivetítésnek.

## Előkészítés
1. Az érintett éles sémát és jogosultságokat olvasással auditálni kell. Alkalmazandó sorrendben: `docs/sql/GOOGLE_CONTACTS_SYNC.sql`, majd `docs/sql/GOOGLE_CONTACTS_GROUPS.sql`. Már működő Contacts-kapcsolat bővítésénél csak az új GROUPS-migráció szükséges. A csoportos alkalmazáskiadás előtt a GROUPS-séma legyen telepítve: a hiányzó tagsági tábla hibáját a backend nem tekinti üres csoportlistának. Először visszagörgetett tranzakcióban, majd ellenőrzött aktiválással; a migráció ismételhető és meglévő ügyfél/időpont/dokumentum sort nem ír.
2. A meglévő Google Cloud projektben a People API szükséges; az OAuth webalkalmazásban a `${GOOGLE_CALENDAR_APP_URL}/api/google-contacts/callback` pontos HTTPS URI-t hozzá kell adni a már meglévő Calendar callback megtartásával.
3. Külön kérendő scope: `https://www.googleapis.com/auth/contacts` + OpenID email. Ez tág Google-kezelési engedély; a felhasználó külön engedélyező oldala kötelező. A Google-figyelmeztetéseket a felhasználó kezeli. Új feltételek elfogadása csak felhatalmazással.
4. A meglévő szerveres `GOOGLE_CALENDAR_CLIENT_ID`, `_CLIENT_SECRET`, `_TOKEN_KEY`, `_APP_URL` és `_CRON_SECRET` marad. A Contacts-titkosítás elkülönített AAD-környezetet használ. Az új `GOOGLE_CONTACTS_ENABLED=true` kapcsoló csak a beállítások elkészülte után aktiválandó; hiányában a funkció nem kapcsolható össze.
5. A `/adatvedelem/google-nevjegyek` oldal ismerteti a működést, adatköröket, tárolást és visszavonást. A naptár tájékoztatója hivatkozik rá.
6. A külön `docs/sql/GOOGLE_CONTACTS_CRON.sql` a már létező Vault-beállításokat használja, a naptár feladatát nem módosítja. A net/vault kizárását a Data API-ból ellenőrizni kell. A feladat percenként ellenőrzi a várakozó sorokat; nem indít névjegyírást kapcsolat és jóváhagyott ügyfél nélkül.

## Használat
Beállítások → Google Névjegyek → fiók összekapcsolása → Ügyfelek áttöltése · előnézet. Tíz ügyfél/oldal, kezdetben nincs kiválasztás. Pontos normalizált telefon/email-egyezést ajánl fel; név alapján nem kapcsol össze. Több CRM-ügyfélhez tartozó elérhetőséget ellenőrzendőnek jelöl. Jóváhagyáskor a szerver újraolvassa a forrásokat és a Google-egyezéseket; lejárt vagy megváltozott előnézetből nem indul áttöltés.

Az új összerendelések külön jóváhagyást igényelnek. A jóváhagyott kapcsolatok a háttérben frissülnek, változásnál előresorolva. A Google-ban kézzel szerkesztett adatot megőrizzük vagy ütközésként jelezzük. Az iPhone-on a kapcsolt Google-fióknál a Kontaktok szinkronizálását be kell kapcsolni; a telefon frissítési ütemezését a készülék kezeli.

## Közös névjegy kifejezett jóváhagyással
A normál előnézetben kizárólag még nem kapcsolt, saját telepítéssel rendelkező ügyféladatlap választható csoporthoz. A tulajdonos/adminisztrátor 2–10 adatlapot jelöl ki, kiválasztja a fő nevet adó adatlapot és megerősíti, hogy ugyanahhoz a személyhez tartoznak. Ezután a teljes közös adat és a Google-egyezések új előnézetben jelennek meg; a Google-írás csak a névjegy jóváhagyása után indul. Nincs automatikus csoportosítás név vagy közös családi telefonszám alapján.

A közös névjegy megőrzi az összes külön telefonszámot, e-mailt, címet és minden tag teljes telepítési/karbantartási jegyzetét. Az eltérő formátumú azonos kontaktértékek egyszer szerepelnek; a munkajegyzeteket nem deduplikáljuk, még azonos nap vagy klímatípus esetén sem. Nem üres, hibás kontaktérték esetén a teljes csoport ellenőrzést kér. Az összesített munkajegyzet legfeljebb 40 000 karakter.

Az eredeti ügyfelek, dokumentumok és időpontok változatlanok. A stabil Google-azonosító és marker a választott fő ügyfél linkjén marad; a többi adatlapot a szerver-only `google_contacts_link_members` tábla rendeli hozzá. A már működő v1 linkek és pillanatképek nem változnak. A csoportok v2 pillanatképe az összes kezelt mezőtömböt és a rögzített tagságot tartalmazza. A beállítások külön mutatják a kapcsolt névjegyek és az általuk lefedett ügyféladatlapok számát.

Egy tag csak egy csoportban szerepelhet. Már kapcsolt névjegy csoportba emelése, tagság átrendezése és felbontása nem támogatott ebben a változatban. Más ügyféllel közös elérhetőség továbbra is megállítja a csoport összekapcsolását. Több Google-találat esetén külön célkiválasztás szükséges; meglévő Google-névjegyeket nem egyesítünk vagy törlünk. Ha valamelyik tag később eltűnik vagy már nem saját telepítéses ügyfél, a közös névjegy ellenőrzést kér, és nem vált vissza csonka, egytagú exportálásra.

A csoporttagság és az anchor link jóváhagyása egy adatbázis-tranzakció. A tagság, az összes tag forráshashe, a Google-fiók és a cél Google-névjegy friss állapota része az ellenőrzésnek. A böngésző csak a szerver által rögzített előnézetet hagyhatja jóvá; a tagságot nem írhatja közvetlenül.

Visszaállítás előtt a Contacts-kapcsolatot szüneteltetni kell. A v2 pillanatképek és a tagság megmaradnak; régi alkalmazásverzióval nem indítunk csoportos szinkronizálást és nem alakítjuk vissza a csoportot egyetlen ügyfél részadataira.

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

2026-10-16: a csoportos migráció kétszeri futtatása és az atomi tagság/link-jóváhagyás natív PostgreSQL visszagörgetett tranzakcióban sikeres. Visszajátszás, részleges batch visszagörgetése, lefoglalt tag, egyedi Google-cél, átfedő csoport, hiányzó saját forrás és böngészős jogosultság tiltása ellenőrizve. A 79 célzott modell/forrás/sync teszt sikeres; a végső típusellenőrzés és build sikeres szintetikus publikus Supabase buildértékekkel, továbbá 4/4 auth teszt sikeres. A teljes tesztcsomag végső futása: 1078 teszt, 1072 sikeres, 6 kihagyott, 0 hiba. Az éles kiadás és áttöltés külön ellenőrzendő.

## Hivatalos leírások
- https://developers.google.com/people/api/rest/v1/people.connections/list
- https://developers.google.com/people/api/rest/v1/people/createContact
- https://developers.google.com/people/api/rest/v1/people/updateContact
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://support.apple.com/en-us/111793
