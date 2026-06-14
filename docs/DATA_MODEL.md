# Adatmodell

> Ez a dokumentum domain-szintű térkép. Az élő séma 2026-06-14-i, csak olvasási felmérése: [`SUPABASE_SCHEMA_AUDIT.md`](SUPABASE_SCHEMA_AUDIT.md). SQL-migráció előtt az auditot újra kell futtatni.

## TypeScript domain-típusok

### Customer

Fontos mezők:

- `id`
- `name`
- `city`
- `postalCode`
- `phone`
- `email`
- `address`
- `source`
- `status`
- `need`
- `notes`
- `date`
- `time`
- `appointmentType`
- `createdAt`
- `updatedAt`
- `lastCalledAt`
- `quoteSentAt`
- `appointmentBookedAt`
- `appointmentUpdatedAt`
- `quoteItems`
- `quotePricingMode`
- `stockDeducted`

### AppointmentType

```ts
type AppointmentType = "installation" | "survey" | "maintenance";
```

### QuotePricingMode

```ts
type QuotePricingMode = "bundle" | "alternatives";
```

### WorkReport

Fontos mezők:

- `id`
- `customerId`
- `appointmentType`
- `workDate`
- `workTime`
- `workDescription`
- `notes`
- `signatureDataUrl`
- `signerName`
- `signedAt`
- `emailSentAt`
- `createdAt`
- `updatedAt`

A `WorkReport` több rekordot enged ugyanahhoz az ügyfélhez. A szerelési és karbantartási rekordokat típus szerint kell elkülöníteni.

### WorkChecklistState

```ts
{
  worksheet: boolean;
  signature: boolean;
  purchaseDeclaration: boolean;
  alinInvoice: boolean;
  amovaInvoice: boolean;
  nkvh: boolean;
  docsSent: boolean;
  completedAt?: Partial<Record<WorkChecklistItemKey, string>>;
}
```

## Supabase fő táblák

A jelenlegi projektben használt vagy korábban bevezetett fő táblák:

- `customers`
- `quotes`
- `quote_items`
- `jobs`
- `appointments`
- `documents`
- `work_reports`
- `work_checklists`
- `inventory_stock`
- `material_inventory`
- `climate_products`
- `profiles`

A 4. stabilizálási fázis additív migrációja létrehozta az `appointments` táblát és a `jobs` rekordok idempotens másolatát. Az alkalmazás ebben a fázisban továbbra is a `jobs` táblát használja. A migráció részletei: [`APPOINTMENTS_MIGRATION.md`](APPOINTMENTS_MIGRATION.md).

## Kapcsolatok

```text
customer
├── quotes
│   └── quote_items
├── jobs (jelenlegi kompatibilitási időpontrekord)
├── appointments (több időpont és történet; a 4. fázisban még nincs alkalmazáskódos olvasás)
├── documents
├── work_checklist
└── work_reports
    ├── installation report
    └── maintenance reports (0..n)
```

## Kritikus adatmodell-szabályok

1. Egy ügyfélnek több időpont-eseménye lehet az életútja során.
2. A jelenlegi `Customer.date/time/appointmentType` mezők önmagukban nem ideálisak korlátlan történet tárolására; új fejlesztésnél ne írj felül történeti adatot terv nélkül.
3. Egy ügyfélhez több `work_reports` rekord tartozhat.
4. A `work_reports` táblán nem maradhat olyan egyedi constraint, amely csak `customer_id` alapján egy rekordot enged.
5. Az időponttípus és munkalaptípus migrációja a régi rekordokra alapértelmezett `installation` értéket adhat.
6. A lezárási checklist dátumai külön JSON/mező formában tartósan tárolandók.
7. Minden adatbázis-változás előtt mentés szükséges.
8. A 2026-06-14-i élő sémában a `jobs` és a `work_reports` táblán nincs csak `customer_id` alapú unique constraint.
9. Az új `appointments` tábla legacy backfillje egyedi `legacy_source_key` mezőt és unique indexet igényel.
10. Az átmeneti kettős írásban az `appointments` az elsődleges rekord, a `jobs` csak kompatibilitási tükör lehet.

## Jövőbeli irány

A többcéges rendszerben minden domain-rekordhoz `company_id` szükséges, RLS védelemmel. Ezt a jelenlegi rendszer stabilizálása előtt nem szabad elkezdeni.
