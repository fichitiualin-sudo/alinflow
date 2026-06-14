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

- [ ] Ajánlott idősávok elérhetők.
- [ ] Időpont módosítható.
- [ ] Ütközés felismerhető.
- [ ] Klímák és anyagok a szereléshez kapcsolódnak.
- [ ] Google Naptár leírásban az ár a klíma sor végén van.
- [ ] Készlet csak egyszer és megfelelő pillanatban változik.

## Munkalap és lezárás

- [ ] Munkalap aláírható.
- [ ] Aláírás nélkül nem jelölődik késznek.
- [ ] Vásárlási nyilatkozat aláírás nélkül nem kész.
- [ ] Checklist pipák dátuma mentődik és visszatöltődik.
- [ ] Teljes lezárás csak a szükséges feltételekkel engedett.
- [ ] Lezárás után a dokumentumok megmaradnak.

## Karbantartás

- [ ] Lezárt ügyfélnél elérhető a karbantartási napló.
- [ ] Új karbantartás gomb csak a naplóban van.
- [ ] Karbantartás 1 órás és egyedi idővel rögzíthető.
- [ ] Nem írja felül a szerelési időpontot.
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

## Listák és reszponzivitás

- [ ] Legfeljebb 10 rekord jelenik meg oldalanként.
- [ ] Lapozás működik.
- [ ] Mobil dashboard sorrend helyes.
- [ ] Asztali Raktár gyorsnézet fent, jobb oldalon van.
- [ ] A gombok nem érnek össze és nem csúsznak ki.
