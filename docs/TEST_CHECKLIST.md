# Regressziós tesztlista

Minden kiadás előtt legalább ezt a listát ellenőrizni kell.

## Automatikus ellenőrzés

```bash
npx tsc --noEmit
npm run build
```

## Projektstruktúra

- [ ] Nincs gyökér `app/` mappa.
- [ ] Csak `src/app/page.tsx` az alkalmazás főoldala.
- [ ] Nincs duplikált komponensmappa.
- [ ] Nem került titok vagy `.env` tartalom a repóba.

## Bejelentkezés és betöltés

- [ ] Belépés működik.
- [ ] Első betöltés után megjelennek a Supabase adatok.
- [ ] Oldalváltásnál nem jelenik meg újra teljes képernyős betöltés.
- [ ] Többszöri oldalváltás után sem lassul le feltűnően.

## Ügyfél

- [ ] Új ügyfél menthető.
- [ ] Meglévő ügyfél szerkeszthető.
- [ ] Mező tartalma teljesen törölhető.
- [ ] Telefonszám mellett pontosan egy hívásgomb van.
- [ ] Irányítószám kitölti a települést legördülő nélkül.
- [ ] Település kitölti az irányítószámot, ha egyértelmű.
- [ ] CSV import eredeti érdeklődési dátuma megjelenik.
- [ ] Legfrissebb érdeklődő van elöl.

## Árajánlat

- [ ] Bundle ajánlat összegzi a tételeket.
- [ ] Alternatives ajánlat nem összegzi a tételeket.
- [ ] Előnézet és email egyezik.
- [ ] Ajánlat dátuma szerepel.
- [ ] Nincs belső költségbontás.
- [ ] Alternatívák vizuálisan elkülönülnek.
- [ ] Elfogadott/időpontozott ügyfél eltűnik a kiküldött ajánlatok listájából.

## Felmérés

- [ ] Klímaválasztás nélkül rögzíthető.
- [ ] 1 órás időtartamot kap.
- [ ] Egyedi kezdési idő megadható.
- [ ] Nem módosít raktárkészletet.
- [ ] Befejezés után az árajánlat menü nyílik.
- [ ] Nem készít szerelési munkalapot/nyilatkozatot.

## Szerelés

- [ ] Az időpont az `appointments` rekordból töltődik vissza.
- [ ] A `jobs`-ban frissebb legacy módosítás kompatibilisen visszatöltődik.
- [ ] Appointmenthez kötött ajánlat klímatételei töltődnek vissza.
- [ ] Csak `jobs`-ban lévő időpont fallbackként megjelenik.
- [ ] Törölt legacy job backfill appointmentja nem jelenik meg újra.
- [ ] Ajánlott idősávok elérhetők.
- [ ] Időpont módosítható.
- [ ] Időpont mentésekor az `appointments` rekord frissül, a kapcsolt `jobs` sor csak kompatibilitási tükör.
- [ ] Felmérés és szerelés külön `appointments` rekordban marad, nem írják felül egymást.
- [ ] Ütközés felismerhető.
- [ ] Klímák és anyagok a szereléshez kapcsolódnak.
- [ ] Google Naptár leírásban az ár a klíma sor végén van.
- [ ] Készlet csak egyszer és megfelelő pillanatban változik.

## Munkalap és lezárás

- [ ] Munkalap aláírható.
- [ ] Aláírtnak csak együtt meglévő aláíráskép és érvényes aláírási időpont számít.
- [ ] Aláírás nélkül nem jelölődik késznek.
- [ ] Vásárlási nyilatkozat aláírás nélkül nem kész.
- [ ] Az emailküldés és a `docsSent` állapot önmagában nem jelenti a munkalap vagy nyilatkozat aláírását.
- [ ] Korábban elküldött, de aláírás nélküli dokumentum `Elküldve, aláírásra vár` állapotban jelenik meg.
- [ ] Checklist pipák dátuma mentődik és visszatöltődik.
- [ ] Teljes lezárás csak a szükséges feltételekkel engedett.
- [ ] Lezárás után a dokumentumok megmaradnak.

## Karbantartás

- [ ] Több appointment esetén a legújabb aktív időpont töltődik be.
- [ ] Lemondott appointment nem írja felül az aktív időpontot.
- [ ] Lezárt ügyfélnél elérhető a karbantartási napló.
- [ ] Új karbantartás gomb csak a naplóban van.
- [ ] Karbantartás 1 órás és egyedi idővel rögzíthető.
- [ ] Nem írja felül a szerelési időpontot.
- [ ] Minden új karbantartás új `appointments` rekordot kap, a korábbi karbantartások megmaradnak.
- [ ] A karbantartás kapcsolt `jobs` tükre nem veszi át egy másik időpont `legacy_source_key` értékét.
- [ ] Nem tünteti el az ajánlatot, nyilatkozatot vagy szerelési munkalapot.
- [ ] Minden karbantartás külön munkalapot hoz létre.
- [ ] Több karbantartás dátum szerint listázódik.
- [ ] `Megtekintés` a megfelelő munkalapot nyitja.
- [ ] Összes munkalap egyben megnyitható/nyomtatható.
- [ ] Karbantartás csak munkalappal/aláírással zárható le.
- [ ] Karbantartás lemondása csak az adott karbantartást érinti.
- [ ] Lemondás után az ügyfél telepítési dokumentumai megmaradnak.

## Email

- [ ] Árajánlat email működik.
- [ ] Időpont-visszaigazolás típusa helyes.
- [ ] Munkalap email a megfelelő munkalapot küldi.
- [ ] Köszönő emailben nincs ár.
- [ ] Google értékelő gomb a közvetlen review linkre visz.
- [ ] Facebook értékelő link működik.

## Munkafotók és sorozatszámok

- [ ] A sorozatszám- és adattábla-rész kizárólag a Munkafotók alatt nyitható meg, a klímalista nyitottságától függetlenül.
- [ ] A korábban feltöltött beltéri/kültéri képek ugyanahhoz a készülékhez és munkához töltődnek vissza.
- [ ] A Code 128 vonalkódból olvasott azonosító ellenőrizhető javaslat; találat nélkül helyi szövegfelismerés következik.
- [ ] Az adattábla beolvasása együtt javasolja a gyártót, az adott oldal pontos típusát és S/N-jét. Egyedi találat üres mezőbe kerül; meglévő érték és másik oldal adatai változatlanok, eltérő/több találat külön választható.
- [ ] Ellenőrzés után egyetlen készülékadat-mentés és visszatöltés megőrzi az összes mezőt. Az el nem olvasható típus vagy gyártó kézzel pótolható; szövegfelismerési hiba mellett a sikeres vonalkód megmarad.
- [ ] Dupla kattintás nem indít párhuzamos felismerést; munkaváltás és megszakítás után nem érkezik késői mezőmódosítás.
- [ ] A képletöltési, felismerőmotor- és időtúllépési hiba érthetően elkülönül az üres felismerési eredménytől.

## Listák és reszponzivitás

- [ ] A lapozott listákon legfeljebb 10 rekord jelenik meg oldalanként; a Raktárban minden készlettétel egy folyamatos listában látszik.
- [ ] Lapozás működik.
- [ ] Mobil dashboard sorrend helyes.
- [ ] Asztali Raktár gyorsnézet fent, jobb oldalon van.
- [ ] A gombok nem érnek össze és nem csúsznak ki.

## Belső beszerzési árak

- [ ] Ár mentése és visszatöltése megőrzi az összeget és a nettó/bruttó jelölést.
- [ ] A kijelzés mindig bruttó; nettó 100 000 Ft megadása 127 000 Ft bruttóként jelenik meg.
- [ ] A készletérték és lefoglalt/szabad része helyes, hiányzó árnál részösszeget jelez; kereséskor nem változik.
- [ ] Készleten lévő tételek elöl, utánuk a többi, mindkét csoport magyar betűrendben.
- [ ] Hiányzó ár és nulla megkülönböztethető; betöltési hiba mellett ár nem menthető.
- [ ] Munkaterületváltás, kijelentkezés és későn érkező válasz nem hagyhat látható idegen belső árat.
- [ ] Ajánlat, email, számla, naptár, nyilatkozat, munkalap és export nem tartalmaz belső ármezőt.
- [ ] Nyomtatáskor a beszerzési ár, a szerkesztője és a készletérték-összesítő egyaránt rejtett.
