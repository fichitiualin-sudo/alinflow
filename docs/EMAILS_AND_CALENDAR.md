# Emailek és Google Naptár

## Általános email-szabályok

- magyar nyelv;
- magázódó, udvarias hangnem;
- KLIMAlin arculat;
- az előnézet és a ténylegesen elküldött email lényegi tartalma egyezzen;
- ne jelenjen meg belső költségbontás;
- ne ismétlődjön ugyanaz a figyelmeztetés több helyen;
- a céges lábléc tartalmazza:
  - `klimalin.hu`
  - `legkondikalkulator.hu`
  - `06 30 700 4908`

## Árajánlat email

### Bundle ajánlat

- tételek;
- szereléssel együtt értendő ár;
- egyetlen összesítő sor;
- ajánlat időpontja.

### Alternatív ajánlat

- `1. lehetőség`, `2. lehetőség` stb.;
- jól elkülönülő vizuális blokkok;
- nincs összeadott végösszeg;
- nem kell az elején és a végén is megismételni, hogy az ügyfél választ.

## Időpont-visszaigazolás

Típus szerint:

- szerelési;
- felmérési;
- karbantartási.

A típus, dátum, kezdési idő és helyszín legyen egyértelmű. A karbantartási értesítő nem szükséges hosszú távú dokumentumként; a munkalap a megőrzendő irat.

## Munkalap email

- szerelési vagy karbantartási munkalap;
- a megfelelő dokumentumtípust küldje;
- karbantartásnál ne csatoljon vásárlási nyilatkozatot;
- küldés után a dokumentum státusza naplózható.

## Köszönő email

Az új telepítés teljes lezárásának sikeres mentése után automatikusan indul, ha az ügyfélnek van mentett email-címe. A „Szerelés kész – admin folyamatban” állapot, a karbantartás lezárása, a lap betöltése és a korábban lezárt munkák nem indítanak automatikus küldést. A kézi gomb a teljesen lezárt telepítés küldését indítja vagy próbálja újra; már elküldött emailt nem dupláz.

A szerver a mentett munkaterülethez, ügyfélhez és telepítési időponthoz ellenőrzi a jogosultságot és a „Lezárva” állapotot. Az `INSTALLATION_THANK_YOU.sql` migráció tartós, időpontonként egy küldési naplót vezet. Sikeres szolgáltatói elfogadás után a szerver ugyanabban az adatbázis-tranzakcióban jelöli elküldöttnek a naplót és az adott időpont `thank_you_email` dokumentumát. Emailhiba nem vonja vissza a munka lezárását.

Párhuzamos kérésnél legfeljebb kétperces foglalás védi a küldést. Bizonytalan hálózati eredmény után az újrapróbálás az eredeti, szerver által aláírt tartalmat és ugyanazt a Resend `Idempotency-Key` kulcsot használja; az időközben megváltozott címzett esetén ellenőrzést kér. A [Resend 24 órás megőrzése](https://resend.com/docs/dashboard/emails/idempotency-keys) miatt 23 órán túl a bizonytalan eredmény automatikus újraküldése tiltott, ilyenkor a szolgáltatói napló ellenőrzése szükséges. Az API-kulcs cseréje után a régi kulccsal aláírt, bizonytalan küldés szintén ellenőrzést igényel. Biztos kezdeti elutasítás után javított beállításokkal új kísérlet indulhat.

Tartalma:

- köszönet a választásért;
- telepített klíma neve és alapadatai;
- karbantartás fontosságának rövid említése;
- nincs klímaár;
- Google értékelés gomb;
- Facebook értékelés gomb;
- segítségfelajánlás és elérhetőségek.

Google értékelési URL:

```text
https://g.page/r/CaTB2608T1bZEBM/review
```

A linkeket a munkaterület mentett emailbeállításai adják. A KLIMAlin Facebook értékelési URL-je:

```text
https://www.facebook.com/100094506956317/reviews/
```

2026-09-14-én az élő AlinFlow beállításában ez a cím szerepelt; a Facebookon a KLIMAlin értékelési nézete nyílt meg. A `profile.php?id=100094506956317&sk=reviews` változat ugyanoda vezetett. Az ellenőrzött alaplinket megtartjuk. A Facebook az értékeléshez saját bejelentkezést kérhet; ezt a levél röviden jelzi.

## Google Naptár

A szerelési esemény leírásában szerepelhet:

```text
Ügyfél: <név>
Telefon: <telefonszám>
Klíma: <mennyiség és típus> – szereléssel együtt: <ár>
Időpont típusa: Szerelés
Idősáv: <kezdés–vég>
Státusz: <státusz>
```

Ne legyen külön `Ár:` sor, ha az ár már a klíma sor végén szerepel.

Felmérés és karbantartás esetén az esemény címe, időtartama és leírása a megfelelő típushoz igazodjon. Karbantartásnál ne jelenjen meg új klímaeladásként ár vagy készletfoglalás.

### Jövőbeli események beolvasása

A főoldali `Naptár frissítése` gomb csak a frissítés pillanatától kezdődő Google Naptár-eseményeket olvassa be. A már elmúlt eseményeket nem módosítja. A Google eseményazonosító külön kapcsolótáblába kerül, ezért az ismételt frissítés nem hoz létre újabb példányt ugyanabból az időpontból.

Az importhoz szükséges beállítások:

1. Futtasd a `docs/sql/20260823_ADD_GOOGLE_CALENDAR_IMPORT.sql` migrációt, majd a hozzá tartozó ellenőrző SQL-t.
2. A Vercelben add meg érzékeny környezeti változóként a szolgáltatásfiók teljes JSON-ját `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON` néven. Alternatívaként base64 formában használható a `GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_BASE64` név.
3. A Google Naptárat megtekintési jogosultsággal oszd meg a JSON-ban szereplő `client_email` címmel.
4. Az AlinFlow `Beállítások` oldalán add meg az adott munkaterülethez tartozó Google naptár azonosítóját, és mentsd a beállítást.

A szolgáltatásfiók titkos kulcsa kizárólag szerveroldali környezeti változó lehet. Nem kerülhet Supabase táblába vagy böngészőből elérhető `NEXT_PUBLIC_` változóba.

Az import az egyértelműen felismerhető szerelési, felmérési és karbantartási eseményeket kezeli. Először email, telefonszám, majd név és cím alapján keres meglévő ügyfelet. Bizonytalan vagy személyes eseményt kihagy, és ezt a frissítés eredményében jelzi.

Gyors, mezőnevek nélküli rögzítésnél az esemény címe legyen `Szerelés`, `Felmérés` vagy `Karbantartás`, a leírás sorainak sorrendje pedig: ügyfélnév, telefonszám, email, teljes cím, opcionálisan klíma. A részletes `Kulcs: érték` formátum továbbra is használható.
