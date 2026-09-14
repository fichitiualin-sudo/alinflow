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

### Készülékadatok, adattábla-fotók és H tarifa (2026-09-14)

- `appointment_devices`: egy sor fizikai készülékenként a pontos telepítésen belül. Egyedi kulcs: `(appointment_id, product_key, unit_number)`. A gyártó, pontos beltéri/kültéri típus, két sorozatszám és H tarifás műszaki értékek a `data` JSON-ban vannak.
- `h_tariff_requests`: egy mentett H tarifás adatkészlet telepítési időpontonként, választott elosztóval. Mindkét új tábla munkaterület-/ügyfél-/időpont-kapcsolata változtathatatlan; aktív tagság és megfelelő telepítés szükséges. Az `updated_at` szerveroldali verziója megakadályozza a párhuzamos szerkesztés észrevétlen felülírását.
- `work_photos.device_id` és `device_side`: opcionális készülékkapcsolat; a kettő együtt tölthető ki. Kompozit FK tiltja a más ügyfélhez, munkához vagy munkaterülethez tartozó készüléket. A normál munkafotókban mindkettő `null`. A képek a korábbi privát Storage bucketben maradnak.
- `installation_thank_you_deliveries`: tartós küldési napló. Nincs közvetlen kliensoldali táblahozzáférés; a két szűk RPC tagságot, ügyfelet, pontos telepítést és teljes lezárást ellenőriz. A sikeres küldés a `documents` rekorddal egy tranzakcióban naplózódik.

Migrációk: `docs/sql/APPOINTMENT_DEVICES.sql` és `docs/sql/INSTALLATION_THANK_YOU.sql`. A fotók alap- és törlési migrációja után futtatandók, friss mentéssel és sémaaudittal. A készülékadatokból nem történik automatikus visszaírás régi munkalapba vagy vásárlási nyilatkozatba.

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

A 4. stabilizálási fázis additív migrációja létrehozta az `appointments` táblát és a `jobs` rekordok idempotens másolatát. Az 5. fázistól az alkalmazás elsődlegesen az `appointments` táblából olvas, a `jobs` pedig kompatibilitási fallback és a jelenlegi írás célja marad. Részletek: [`APPOINTMENTS_MIGRATION.md`](APPOINTMENTS_MIGRATION.md) és [`APPOINTMENTS_COMPATIBLE_READ.md`](APPOINTMENTS_COMPATIBLE_READ.md).

A 6. stabilizálási fázistól az időpontok írásánál is az `appointments` az elsődleges rekord. A `jobs` tábla nem szűnik meg, hanem tranzakciós kompatibilitási tükörként frissül az `appointments.legacy_source_key = jobs:<job_id>` kapcsolaton keresztül. Részletek: [`APPOINTMENTS_WRITE.md`](APPOINTMENTS_WRITE.md).

## Kapcsolatok

```text
customer
├── quotes
│   └── quote_items
├── jobs (jelenlegi kompatibilitási időpontrekord)
├── appointments (elsődleges időpont-olvasás, több rekord ügyfelenként)
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

## Munkafotók (2026-09-13)

A `work_photos` rekord stabil `workspace_id`, `customer_id` és `appointment_id`
kapcsolatot tárol. A `Customer.activeAppointmentId` választja ki a munkát; a
feltöltéskori típus/dátum/idő külön történeti pillanatkép. Az átütemezés nem
változtatja meg a képek munkához rendelését. Mentett időpont nélkül a feltöltés
nem engedélyezett; a dokumentumok és a lezárás továbbra sem igényelnek fényképet.

A privát `work-photos` bucketben a JPEG útvonala
`<workspace>/<customer>/<appointment>/<photo>.jpg`. A böngésző legfeljebb
1920 pixeles, 500000 bájtos képet készít és elhagyja az EXIF-adatokat.
A galéria 10 képet tölt oldalanként, rövid élettartamú aláírt URL-ekkel.
A hozzáférés a meglévő aktív munkaterület-tagságra épül.

SQL: [`sql/WORK_PHOTOS.sql`](sql/WORK_PHOTOS.sql). A kapcsolt fotók miatt
visszautasított ügyféltörlés nem törölheti a dokumentumokat sem:
`delete_customer_preserving_photos(customer, workspace)` egy tranzakcióban
ellenőrzi és végzi a már létező ügyféltörlési műveletet.

A képenkénti törléshez ezután a
[`sql/WORK_PHOTO_DELETION.sql`](sql/WORK_PHOTO_DELETION.sql) migráció szükséges.
Az aktív munkaterület-tag előbb Storage API-val törli a kiválasztott fájlt,
majd a `finish_work_photo_delete` ellenőrzi a pontos munkahatókört és a fizikai
objektum hiányát, mielőtt eltávolítja a metaadatot. Közvetlen metaadat-DELETE
jogosultság nincs; megszakadt törlés ugyanazzal az azonosítóval újrapróbálható.

## Korábbi tervezési irány

A többcéges rendszerben minden domain-rekordhoz `company_id` szükséges, RLS védelemmel. Ezt a jelenlegi rendszer stabilizálása előtt nem szabad elkezdeni.
