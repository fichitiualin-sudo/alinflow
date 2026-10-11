# Munkalap és vásárlási nyilatkozat megjelenése

## Cél
Modern, jól olvasható munkalap az előnézetben, nyomtatáskor és az email PDF-mellékletében. A vásárlási nyilatkozat az eredeti nyomtatvány elrendezését kövesse.

## Jelenlegi működés
A React-előnézetet a DocumentPreviewDocuments.tsx, az archivált HTML-t a signed-document-export.ts, az email PDF-et a document-pdf-render.ts és document-pdf.ts készíti. A mentett dokumentumokat külön jogosultságellenőrzés tölti be.

## Megváltoztathatatlan szabályok
- Mentett tartalom, aláírás és időpont nem írható felül.
- Munkaterületi arculat és szolgáltatói adatok elkülönítve maradnak.
- Hosszú szöveg és készüléklista sem vágható le.
- Jogi szöveg és aláírási folyamat nem változik pusztán a megjelenés miatt.
- A vásárlási nyilatkozat szerkesztőjének alapból csukott állapota megmarad.

## Adatmodell
Nincs új mező, migráció vagy környezeti változó.

## Implementációs lépések
1. Eredeti nyilatkozatminták összehasonlítása a jelenlegi tartalommal.
2. Munkalap: rendezett fejléc, tipográfia, ügyfél- és munkaadatok, finom színjelzés, áttekinthető aláírási rész.
3. Nyilatkozat: eredeti fekete-fehér forma, mezők, táblázat, térközök és aláírási elrendezés.
4. Előnézet, HTML-export és PDF ellenőrzése rövid és hosszú szintetikus adatokkal.

## Ellenőrzés
- npx tsc --noEmit
- npm run build és Vercel-build
- Meglévő dokumentum/PDF/mentési regressziós tesztek
- PDF-oldalak renderelése és vizuális ellenőrzése
- Mobil és asztali előnézet, szövegtúlcsordulás és aláírás ellenőrzése

## Visszaállítás
A megjelenési commit visszavonható, mentett adat vagy dokumentum törlése nélkül.

## Módosított fájlok
- src/components/alinflow/DocumentPreviewDocuments.tsx
- src/lib/alinflow/signed-document-export.ts
- src/lib/alinflow/document-pdf.ts
- src/lib/alinflow/document-pdf-render.ts
- src/lib/alinflow/purchase-declaration-pdf.ts
- src/app/page.tsx
- next.config.ts
- public/forms/purchase-declaration/vasarlasi-nyilatkozat-0416.pdf és README.md
- tests/document-layout.test.cjs
- tests/warehouse-privacy.test.cjs (az új renderelő határának adatvédelmi ellenőrzése)
- docs/DOCUMENTS.md és ez a terv

## Eredmény és ellenőrzés
- A munkalap modern előnézetet, HTML-exportot és email-PDF-et kapott; a szerkesztő és mentési folyamat változatlan.
- A nyilatkozat PDF-jének alapja az eredeti üres 2025-04-16-os minta. Mindkét példány az első oldal tartalmát használja, mert a második eredeti oldal lábjegyzetjelölése hibás. A túl hosszú mezők/listák teljes tartalma mellékletbe kerül.
- Mentett nyilatkozat előnézete saját aláírást és budapesti aláírási dátumot használ, nem a munkalap aláírását vagy az aktuális napot.
- Teljes npm test: 758 teszt, 753 sikeres, 5 meglévő környezetfüggő kihagyás, 0 hiba. Az utolsó módosítások után 32 célzott teszt és a TypeScript-ellenőrzés sikeres.
- A helyi build fordítása és TypeScript-lépése sikeres; az oldaladatok gyűjtését a helyben hiányzó Supabase URL megállítja. Az éles Vercel-build eredménye a kapcsolódó PR-ban szerepel.
- Szintetikus PDF-ek renderelve és ellenőrizve: normál munkalap 1 oldal; nyilatkozat 2 eredeti példány; 105 soros megjegyzés 4 oldalon hiánytalan; 70 készülék és hosszú adatok mellékletekkel, vágás nélkül. Saját aláírás és magyar ő/ű megmarad.
- Valódi React-komponensek mobilon (390 px) és asztalon ellenőrizve; nincs vízszintes túlcsordulás. Nyomtatási CSS-sel a normál munkalap és egy-egy nyilatkozatpéldány 793,7 × 1122,5 px, azaz A4.
- Nincs migráció, új környezeti változó, tárolt dokumentum módosítása vagy tesztből küldött ügyfélemail.
