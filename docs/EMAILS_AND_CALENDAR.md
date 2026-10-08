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

### Naptárból indított gyors rögzítés

Szerelés sikeres mentése után automatikusan két külön email indul: az adott időponthoz rögzített klímák árajánlata, majd az időpont-visszaigazolás. Felmérésnél és karbantartásnál csak a megfelelő időpontlevél megy ki. Email-cím hiányában az időpont megmarad, a felület jelzi az elmaradt küldést.

A mentés előtt látszik, milyen levelek indulnak; utána mindegyiknek külön eredménye van. Részleges hiba esetén az újrapróbálás csak a hiányzó levelet küldi. Már elfogadott levél naplózási hibája csak a dokumentumnapló írását próbálja újra. A művelet rögzített ügyfél/időpont/tartalom pillanatképet használ; az ügyfél „Időpont foglalva” státuszát nem lépteti vissza. Az időpontlevél önmagában nem jelölheti elküldöttnek az árajánlatot.

Az adott nyitott küldési folyamat stabil Resend-idempotenciakulcsot használ levéltípusonként. A [24 órás szolgáltatói megőrzés](https://resend.com/docs/dashboard/emails/idempotency-keys) mellett 23 óráig próbálható újra; bizonytalan eredmény vagy megváltozott tartalom után nem indul eltérő tartalmú automatikus újraküldés ugyanazzal a kulccsal. A folyamat állapota az aktuális oldalon él: oldalfrissítés nem indít új emailt, a sikeresen mentett dokumentumnapló visszatöltődik. A korábbi leveleket a változtatás nem küldi újra.

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

A naptárkapcsolat munkaterületenként, tulajdonosi vagy adminisztrátori Google-jóváhagyással kapcsolható be. A Google által igazolt email-címhez tartozó elsődleges naptár tulajdonosi hozzáférését a szerver a mentés előtt ellenőrzi. Részletes telepítés, környezeti változók és aktiválási állapot: [Google Naptár üzemeltetési útmutató](GOOGLE_CALENDAR_SETUP.md).

Az első sikeres összekapcsolás után **létrehozott** szerelési, felmérési és karbantartási időpontok automatikusan kerülnek a naptárba. A korábban felvett időpontok nem kerülnek át visszamenőleg, akkor sem, ha a munkavégzésük későbbre esik. A meglévő, kézzel létrehozott Google-eseményeket nem módosítjuk.

Az AlinFlow-ban módosított időpont ugyanazt a kezelt Google-eseményt frissíti; lemondás vagy törlés csak a hozzá kapcsolt eseményt távolítja el. A kapcsolat egyirányú: a Google oldali szerkesztés nem írja át az AlinFlow-t. A már automatikusan kezelt időpontnál nincs külön kézi `+ Naptár` gomb.

Az automatikus eseménynek nincsenek meghívottai. A Google írások `sendUpdates=none` paraméterrel mennek, az alapértelmezett naptáremlékeztetők kikapcsolva maradnak. Emiatt nem indul második Google-meghívó vagy visszaigazoló levél; a meglévő AlinFlow-emailküldés változatlan. Google-hiba nem vonhatja vissza az időpont mentését vagy a saját levélküldést.

A szinkronizálás tartós, verziózott feldolgozási sort használ. A megnyitott alkalmazás mentés után és látható állapotban percenként próbál feldolgozni; a böngészőtől független újrapróbáláshoz az opcionális Supabase/Vault cronfeladatot külön aktiválni kell. A **Szinkronizálás szüneteltetése** megőrzi az eseményeket és a várakozó sorokat. Ugyanazon fiók újraengedélyezése az eredeti kapcsolódási határt megtartja.

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
