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
- `privacyNotice`
- `privacyConsentRevokedAt`
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

### Saját és karbantartásra átvett telepítések (2026-10-11)

Az `appointments.maintenance_origin` értéke `own` (alapérték) vagy `external`; domainmezője `Customer.maintenanceOrigin`. Az opcionális `maintenance_source_name` / `maintenanceSourceName` az átadó megjelenített neve, legfeljebb 160 karakter. Csak telepítési rekord sorolható átvettre, és átadó csak ehhez menthető. Az egy szerelési időponthoz tartozó klímák együtt kapják a besorolást, az ügyfél többi telepítése változatlan. Régi rekordok `own` értékkel maradnak láthatók; a migráció nem következtet importforrásból telepítőre.

A besorolás nem jogosultság, nem partnerkapcsolat és nem hozzájárulás. A meglévő munkaterületi RLS változatlan, a szerkesztés munkaterület/ügyfél/időpont szerint szűkített. A két nézeti kapcsoló a böngészőben felhasználó és munkaterület szerint tárolódik, kizárólag a láthatóságot módosítja. Migráció: `docs/sql/20261011_ADD_MAINTENANCE_ORIGIN.sql`.

A `20261011_EXCLUDE_MAINTENANCE_ORIGIN_FROM_CALENDAR.sql` külön, idempotens migráció a meglévő Google Naptár-triggerben a két besorolási mezőt kihagyja a változás-összehasonlításból. Egy önálló besorolásmentés így nem ütemez naptárfrissítést; időpont-, státusz- és egyéb tartalmi változások továbbra is igen. A függvény tulajdonosa, jogosultságai és biztonsági beállításai változatlanok.

### Aláírt adatkezelési tájékoztatók (2026-10-11)

A `work_reports.privacy_notice` nullable JSON-pillanatkép; TypeScript-mezője `WorkReport.privacyNotice`. Tartalmazza a verziót, a készülékértékesítő és a munkát végző vállalkozás adatait (`controllers`), a név szerint megjelölt partnert vagy `null` értéket, az ügyfél négy adatát, a teljes tájékoztató és hozzájárulás szövegét, a pipa állapotát, az aláíró nevét, aláírásképét és az aláírás időpontját. A szerver ellenőrzi a megengedett mezőket és méreteket, valamint az egyezést a munkalap mentett aláírásával. Régi, hiányos aláírási időpontú munkalapok tájékoztató nélkül továbbra is menthetők; a migráció nem tölti visszamenőleg a mezőt.

A `privacy_consent_revoked_at` nullable timestamptz (`WorkReport.privacyConsentRevokedAt`) csak megadott partneri hozzájárulás mellett használható. Első visszavonáskor az adatbázis írja a szerveridőt; a régi kliensállapot nem törölheti vagy módosíthatja ezt. Új, újra aláírt pillanatkép vagy a pillanatkép piszkozatként törlése külön állapotot kezd, ezért a trigger az élő visszavonási mezőt kiüríti, az előző állapotot pedig megőrzi.

A `work_report_privacy_history` hozzáfűzött előzményt tárol: eredeti munkaterület-, ügyfél-, munkalap- és időpontazonosító, előző `privacy_notice`, előző visszavonási idő, művelet (`replaced`, `cleared`, `revoked`, `deleted`), szerveroldali `recorded_at` és `recorded_by`. Visszavonáskor a naplósor a változás **előtti** állapotot tartalmazza, ezért annak visszavonási mezője még `null`; maga a visszavonási esemény a `revoked` művelettel és a szerveridős `recorded_at` mezővel bizonyítható, az aktuális pontos időpont az élő munkalapon van. Későbbi módosítás/törlés ezt az időpontot is archiválja. A naplóban nincs munkalap-/ügyfél-FK, így a törlési cascade nem törli a bizonyítékot. Az eredeti munkaterület aktív tagjai olvashatják; közvetlen kliensoldali írás, átírás, törlés és anonim hozzáférés nincs.

A munkaterületi dokumentumbeállítás `privacyNotice` objektuma a két vállalkozás, az opcionális partner és a tényleges adatkezelési feltételek kitöltetlenül nem aktiválható konfigurációja. Sem a beállítás, sem a hozzájárulás nem hoz létre partneri hozzáférést vagy munkaterületek közötti adatmegosztást. A számlázási kapcsolatokat nem módosítja.

Migráció: [`sql/WORK_REPORT_PRIVACY_NOTICE.sql`](sql/WORK_REPORT_PRIVACY_NOTICE.sql). Mentés után, a workspace- és munkalap-hatókör migrációit követően alkalmazandó. A [`sql/VERIFY_WORK_REPORT_PRIVACY_NOTICE.sql`](sql/VERIFY_WORK_REPORT_PRIVACY_NOTICE.sql) PRE eredményei az eredeti munkalapok darabszámával/ujjlenyomatával és RLS-szabályaival, a POST ellenőrzések az új oszlopokkal, jogosultságokkal és aláírásegyezéssel igazolják az additív aktiválást. Ismételt futtatás nem ír át meglévő nyilatkozatot vagy előzményt.

### Facebook-jelentkezések (2026-10-06)

A `facebook_lead_imports` minden átvett jelentkezés önálló pillanatképét tárolja. Egyedi kulcsa `(workspace_id, page_id, lead_id)`; a `customer_id` meglévő vagy új ügyfélre mutat, ügyféltörléskor `null` lesz, a Meta-azonosító megmarad. A név, telefon, email, település, irányítószám, érdeklődési klíma, eredeti `submitted_at`, űrlap-/hirdetés-/kampányazonosítók külön mezők. A `received_at` a tényleges import ideje.

A `status` `created`, `matched` vagy `review`; utóbbinál `review_reason` jelzi a hiányzó nevet, hiányzó használható kontaktot vagy többértelmű ügyfélegyezést. Az `acknowledged_at/by` csak a beérkezés feldolgozottnak jelölését tárolja. A meglévő `Customer` mezőket ismételt érdeklődés nem írja felül; az új ügyfél `source='Facebook'`, `status='Visszahívandó'`, `need=climate_name` értékekkel jön létre, eredeti jelentkezési dátummal.

Az `import_facebook_lead` szerveroldali RPC egy tranzakcióban keresi az ügyfélegyezést, szükség szerint létrehozza az ügyfelet és a naplósort; párhuzamos importnál munkaterületi zárolás véd. Aktív tag olvashatja a saját munkaterülete naplóját és hívhatja az `acknowledge_facebook_lead` RPC-t. Közvetlen kliensoldali írás/törlés nincs. A `service_role` csak az import-RPC-t és a már beolvasott leadazonosítókhoz szükséges három oszlop olvasását kapja.

A Meta-titkok és a Page→workspace, form- és ad→klíma beállítások szerveres környezeti változók; nem részei a kliensállapotnak vagy a cégbeállítás JSON-jának. Migráció: [`sql/FACEBOOK_LEAD_IMPORT.sql`](sql/FACEBOOK_LEAD_IMPORT.sql). Aktiválás és korlátok: [`FACEBOOK_LEAD_IMPORT.md`](FACEBOOK_LEAD_IMPORT.md).

### Belső beszerzési árak (2026-09-14)

Az `inventory_purchase_prices` önálló belső tábla: `(workspace_id, item_type, item_key)` elsődleges kulcs, `purchase_price` opcionális HUF egységár, `tax_basis` kötelező `net`/`gross`, szerveroldali `created_at` és `updated_at`. Klímánál a termékazonosító, anyagnál a pontos anyagnév kapcsolja a saját munkaterület létező készlettételéhez. Aktív tagság szükséges; anonim hozzáférés és közvetlen törlés nincs. Kiürített ár `null`, nem nulla. Párhuzamos szerkesztés ellen az előző szerververzióra szűrő mentés véd.

Csak a Raktár tölti be, saját komponensállapotba. A beszerzési ár nem része a `ClimateProduct`, `QuoteItem`, `Customer` vagy cégbeállítás objektumnak, így az ajánlatok, emailek, számlák, naptárbejegyzések és dokumentumok nem kapják meg. A katalógusszinkron és a készletműveletek nem írják ezt a táblát. Migráció: `docs/sql/INVENTORY_PURCHASE_PRICES.sql`; terv: [WAREHOUSE_PURCHASE_PRICES_PLAN.md](WAREHOUSE_PURCHASE_PRICES_PLAN.md).

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
