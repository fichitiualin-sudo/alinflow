# Technikai architektúra

## Technológia

- Next.js App Router
- React
- TypeScript
- Supabase adatbázis és autentikáció
- Tailwind CSS
- Vercel deployment

## Könyvtárstruktúra

```text
src/
├── app/
│   ├── page.tsx
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
├── components/
│   └── alinflow/
└── lib/
    └── alinflow/
```

### Tiltott struktúra

```text
app/page.tsx
app/layout.tsx
```

a repó gyökerében. A projekt kizárólag a `src/app` struktúrát használja.

## Központi orchestration

A `src/app/page.tsx` jelenleg sok felelősséget kezel:

- Supabase-adatbetöltés;
- ügyfelek, ajánlatok, időpontok és dokumentumok állapota;
- nézetváltás;
- mentési műveletek;
- email route-ok meghívása;
- lusta dokumentumbetöltés;
- oldalazás és dashboard-összeállítás.

Új funkciónál ne növeld automatikusan tovább ezt a fájlt. Előbb vizsgáld meg, hogy a logika kiszervezhető-e egy `src/lib/alinflow/` segédfájlba vagy célzott komponensbe. Nagy refaktor csak külön terv alapján történhet.

## Fő komponensek

| Fájl | Felelősség |
|---|---|
| `LeadPanel.tsx` | Ügyféladatok, státusz, ajánlat/időpont műveletek |
| `QuoteBuilderPanel.tsx` | Ajánlati tételek és árképzési mód |
| `QuotePreviewPanel.tsx` | Ajánlat vizuális előnézete |
| `SchedulePanel.tsx` | Időponttípus, dátum, ajánlott és egyedi idő |
| `CalendarPanel.tsx` | Heti/havi naptár és rendezés |
| `WorkPagePanel.tsx` | Munka, dokumentumok, karbantartási napló, lezárás |
| `WorkReportPanel.tsx` | Munkalap és aláírás |
| `DocumentPreviewDocuments.tsx` | Nyomtatható dokumentumok |
| `DocumentCards.tsx` | Dokumentum-műveletek |
| `WarehousePanel.tsx` | Klíma- és anyagkészlet |
| `CustomerPanels.tsx` | Keresés, CSV import, listák |
| `TaskPanel.tsx` | Mai/holnapi feladatok és figyelmeztetések |
| `ArchivePanel.tsx` | Lezárt és lemondott ügyfelek |

## Fő segédfájlok

| Fájl | Felelősség |
|---|---|
| `types.ts` | Közös domain-típusok |
| `constants.ts` | Státuszok, alapértékek, termékek |
| `appointments.ts` | Időponttípus, időtartam, ütközés |
| `products.ts` | Tétel-, mennyiség- és árlogika |
| `calendar.ts` | Google Naptár eseményszöveg |
| `work-report.ts` | Munkalaptípus és alapleírás |
| `lead-import.ts` | CSV feldolgozás és dátumfelismerés |
| `postal-codes.ts` | Irányítószám–település kitöltés |
| `drafts.ts` | Helyi szerkesztési állapot és visszalépés |
| `format.ts` | Dátum, pénz és cím formázás |

## API route-ok

A route-ok feladata kizárólag a szerveroldali küldés és sablon-előállítás. Ne tegyél beléjük ügyfélfolyamatot módosító üzleti állapotgépet.

Jellemző route-ok:

- `send-quote`
- `send-appointment`
- `send-work-report`
- `send-thank-you`

## Teljesítmény

- Listák oldalmérete: 10.
- Részletes dokumentumok és munkalapok lusta betöltéssel érkezzenek.
- Oldalváltás ne indítson teljes alkalmazás-újratöltést.
- Párhuzamosan betölthető Supabase lekérdezéseket párhuzamosíts.
- Ne kérd le az összes ügyfél minden dokumentumát a dashboard megnyitásakor.

## Hibatűrés

Új Supabase oszlop bevezetésekor:

1. legyen idempotens SQL migráció;
2. a kliens kezelje átmenetileg a hiányzó mezőt;
3. a migráció futtatási szükségletét egyértelműen jelezd;
4. ne rejtsd el az adatbázis-hibát úgy, mintha a mentés sikerült volna.
