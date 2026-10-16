import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeContactEmail, normalizeContactPhone, type ContactSource } from "./google-contacts-model";

type Row = Record<string, unknown>;
const PAGE_SIZE = 500;
const MAX_ROWS = 100000;
function value(input: unknown) { return String(input ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim(); }
function scope(row: Row, workspaceId: string) { return row.workspace_id === workspaceId; }
function date(input: unknown) {
  const text = value(input);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(`${text}T12:00:00Z`))
    && new Date(`${text}T12:00:00Z`).toISOString().slice(0, 10) === text ? text : "";
}
function todayBudapest() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map((kind) => parts.find((part) => part.type === kind)!.value).join("-");
}
async function readRows(admin: SupabaseClient, table: string, columns: string, workspaceId: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const result = await admin.from(table).select(columns).eq("workspace_id", workspaceId).order("id").range(offset, offset + PAGE_SIZE - 1);
    if (result.error || !Array.isArray(result.data)) throw new Error("Az AlinFlow névjegyadatai nem tölthetők be teljesen. Próbáld újra.");
    rows.push(...result.data as unknown as Row[]);
    if (result.data.length < PAGE_SIZE) return rows;
  }
  throw new Error("A névjegylista túl nagy az egyszeri ellenőrzéshez. Az áttöltés nem indult el.");
}
async function readExcludedInstallations(admin: SupabaseClient, workspaceId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const result = await admin.rpc("google_contacts_excluded_installations", { p_workspace_id: workspaceId })
      .order("installation_id").range(offset, offset + PAGE_SIZE - 1);
    if (result.error || !Array.isArray(result.data) || result.data.some((row: Row) => typeof row.installation_id !== "string")) {
      throw new Error("A saját telepítések hatóköre nem ellenőrizhető. Az áttöltés nem indult el.");
    }
    ids.push(...result.data.map((row: Row) => String(row.installation_id)));
    if (result.data.length < PAGE_SIZE) return ids;
  }
  throw new Error("A saját telepítések teljes hatóköre nem ellenőrizhető. Az áttöltés nem indult el.");
}
function fullAddress(customer: Row, appointment?: Row) {
  const address = value(appointment?.address || customer.address);
  const city = value(customer.city), postalCode = value(customer.postal_code);
  // Work addresses already containing a postcode and city must not get them twice.
  if (/^\d{4}\s+\p{L}/u.test(address)) return address;
  if (city && address.toLocaleLowerCase("hu-HU").startsWith(city.toLocaleLowerCase("hu-HU"))) {
    return [postalCode, address].filter(Boolean).join(" ");
  }
  return [[postalCode, city].filter(Boolean).join(" "), address].filter(Boolean).join(", ");
}
function deviceDetails(device: Row) {
  const data = device.data && typeof device.data === "object" && !Array.isArray(device.data) ? device.data as Row : {};
  const pieces = [["Gyártó", data.manufacturer], ["Beltéri típus", data.indoorModel], ["Kültéri típus", data.outdoorModel],
    ["Beltéri S/N", data.indoorSerial], ["Kültéri S/N", data.outdoorSerial]]
    .filter(([, item]) => value(item)).map(([label, item]) => `${label}: ${value(item)}`);
  return `${value(device.product_name) || "Klíma"} #${Number(device.unit_number) || 1}${pieces.length ? ` – ${pieces.join("; ")}` : ""}`;
}
export type ContactSourceRows = {
  customers: Row[]; appointments: Row[]; quotes: Row[]; quoteItems: Row[]; devices: Row[]; maintenanceLinks: Row[]; excludedInstallationIds: string[];
};
/** Pure projection is also used to test the privacy boundary independently of Supabase. */
export function projectGoogleContactSources(rows: ContactSourceRows, workspaceId: string, today = todayBudapest()): ContactSource[] {
  const excluded = new Set(rows.excludedInstallationIds);
  const customers = new Map(rows.customers.filter((row) => scope(row, workspaceId)).map((row) => [value(row.id), row]));
  const appointments = new Map(rows.appointments.filter((row) => scope(row, workspaceId)).map((row) => [value(row.id), row]));
  const quotes = new Map(rows.quotes.filter((row) => scope(row, workspaceId)).map((row) => [value(row.id), row]));
  const installations = [...appointments.values()].filter((row) => row.appointment_type === "installation"
    && (row.maintenance_origin === "own" || row.maintenance_origin == null) && !excluded.has(value(row.id))
    && !row.cancelled_at && ["Lezárva", "Szerelés kész – admin folyamatban"].includes(value(row.status))
    && Boolean(date(row.scheduled_date)) && date(row.scheduled_date) <= today && customers.has(value(row.customer_id)))
    .sort((a, b) => value(a.scheduled_date).localeCompare(value(b.scheduled_date)) || value(a.id).localeCompare(value(b.id)));
  const byCustomer = new Map<string, Row[]>();
  for (const installation of installations) {
    const id = value(installation.customer_id);
    byCustomer.set(id, [...byCustomer.get(id) || [], installation]);
  }
  return [...byCustomer].map(([customerId, works]) => {
    const customer = customers.get(customerId)!;
    const notes: string[] = [];
    for (const work of works) {
      const workId = value(work.id), workDate = date(work.scheduled_date), address = fullAddress(customer, work);
      notes.push("", `Telepítés: ${workDate.replace(/-/g, ".")}${address ? ` – ${address}` : ""}`);
      const quote = quotes.get(value(work.quote_id));
      const validQuote = quote && value(quote.customer_id) === customerId;
      const alternatives = validQuote && ["alternatives", "quote_pricing_mode:alternatives"].includes(value(quote.notes));
      const items = validQuote && !alternatives ? rows.quoteItems.filter((item) => scope(item, workspaceId) && item.quote_id === quote.id
        && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0 && Number(item.quantity) <= 1000)
        .sort((a, b) => value(a.id).localeCompare(value(b.id))) : [];
      const devices = rows.devices.filter((device) => scope(device, workspaceId) && device.appointment_id === workId && device.customer_id === customerId)
        .sort((a, b) => value(a.product_key).localeCompare(value(b.product_key)) || Number(a.unit_number) - Number(b.unit_number) || value(a.id).localeCompare(value(b.id)));
      if (items.length) notes.push(...items.map((item) => `${Number(item.quantity)} db ${value(item.product_name) || "Klíma"}`));
      if (devices.length) notes.push(...devices.map(deviceDetails));
      if (!items.length && !devices.length) notes.push(alternatives ? "A klímatípus nincs véglegesítve az ajánlatban." : "A klíma típusa nincs rögzítve.");
      const maintenanceDates = rows.maintenanceLinks.filter((link) => scope(link, workspaceId) && link.customer_id === customerId && link.installation_appointment_id === workId)
        .map((link) => appointments.get(value(link.maintenance_appointment_id)))
        .filter((maintenance): maintenance is Row => Boolean(maintenance && maintenance.customer_id === customerId && maintenance.appointment_type === "maintenance"
          && maintenance.status === "Lezárva" && !maintenance.cancelled_at && date(maintenance.scheduled_date) && date(maintenance.scheduled_date) <= today))
        .map((maintenance) => date(maintenance.scheduled_date)).sort();
      if (maintenanceDates.length) notes.push(`Utolsó rögzített karbantartás: ${maintenanceDates[maintenanceDates.length - 1].replace(/-/g, ".")}`);
    }
    const result = {
      customerId, name: value(customer.name), phone: value(customer.phone), email: value(customer.email),
      address: fullAddress(customer), notes: notes.join("\n").trim(),
    };
    if (result.notes.length > 40000) throw new Error("Egy ügyfél telepítési adatai túl hosszúak a névjegyhez; külön ellenőrzés szükséges.");
    return { ...result, sourceHash: createHash("sha256").update(JSON.stringify(result)).digest("hex") };
  }).sort((a, b) => a.name.localeCompare(b.name, "hu-HU") || a.customerId.localeCompare(b.customerId));
}
export async function loadGoogleContactSources(admin: SupabaseClient, workspaceId: string): Promise<ContactSource[]> {
  const [customers, appointments, quotes, quoteItems, devices, maintenanceLinks, excluded] = await Promise.all([
    readRows(admin, "customers", "id,workspace_id,name,phone,email,city,postal_code,address", workspaceId),
    readRows(admin, "appointments", "id,workspace_id,customer_id,quote_id,scheduled_date,appointment_type,status,address,cancelled_at,maintenance_origin", workspaceId),
    readRows(admin, "quotes", "id,workspace_id,customer_id,notes", workspaceId),
    readRows(admin, "quote_items", "id,workspace_id,quote_id,product_name,quantity", workspaceId),
    readRows(admin, "appointment_devices", "id,workspace_id,customer_id,appointment_id,product_key,product_name,unit_number,data", workspaceId),
    readRows(admin, "maintenance_appointment_items", "id,workspace_id,customer_id,maintenance_appointment_id,installation_appointment_id", workspaceId),
    readExcludedInstallations(admin, workspaceId),
  ]);
  return projectGoogleContactSources({ customers, appointments, quotes, quoteItems, devices, maintenanceLinks,
    excludedInstallationIds: excluded }, workspaceId);
}


export type GoogleContactGroup = { anchorCustomerId: string; memberCustomerIds: string[] };
/** Group only explicitly approved identities. Missing members never produce a partial export. */
export function groupGoogleContactSources(sources: ContactSource[], groups: GoogleContactGroup[]) {
  const byId = new Map(sources.map(source => [source.customerId, source]));
  const reserved = new Set<string>(), errors = new Map<string, string>(), combined: ContactSource[] = [];
  for (const group of groups) {
    if (!group || !Array.isArray(group.memberCustomerIds) || group.memberCustomerIds.length < 2 || group.memberCustomerIds.length > 10
      || !group.memberCustomerIds.includes(group.anchorCustomerId) || new Set(group.memberCustomerIds).size !== group.memberCustomerIds.length
      || group.memberCustomerIds.some(id => typeof id !== "string" || !id || reserved.has(id))) {
      throw new Error("A közös névjegyek tagsága hibás vagy átfedi egymást. Ellenőrzés szükséges.");
    }
    for (const id of group.memberCustomerIds) reserved.add(id);
    const ids = [...group.memberCustomerIds].sort(), members = ids.map(id => byId.get(id));
    if (members.some(member => !member || member.memberCustomerIds)) {
      errors.set(group.anchorCustomerId, "A közös névjegy egyik ügyfele már nem érhető el a saját telepítések között. A névjegyet megtartottuk.");
      continue;
    }
    const complete = members as ContactSource[], anchor = byId.get(group.anchorCustomerId)!;
    if (complete.some(member => member.phone.trim() && !normalizeContactPhone(member.phone)
      || member.email.trim() && !normalizeContactEmail(member.email))) {
      errors.set(group.anchorCustomerId, "A közös névjegy egyik elérhetősége hibás. Javítsd az ügyféladatot az összekapcsolás előtt.");
      continue;
    }
    const unique = (values: string[], key: (value: string) => string) => {
      const seen = new Set<string>();
      return values.map(value => value.trim()).filter(value => { const id = key(value); if (!value || seen.has(id)) return false; seen.add(id); return true; });
    };
    const notes = complete.map(member => member.notes).join("\n\n");
    if (!anchor.name.trim() || notes.length > 40000) {
      errors.set(group.anchorCustomerId, "A közös névjegy neve hiányzik vagy a munkajegyzete túl hosszú. Ellenőrzés szükséges.");
      continue;
    }
    const result = { ...anchor, memberCustomerIds: ids,
      phones: unique(complete.map(member => member.phone), normalizeContactPhone),
      emails: unique(complete.map(member => member.email), normalizeContactEmail),
      addresses: unique(complete.map(member => member.address), value => value), notes };
    result.sourceHash = createHash("sha256").update(JSON.stringify({ ...result, sourceHash: undefined,
      memberHashes: complete.map(member => [member.customerId, member.sourceHash]) })).digest("hex");
    combined.push(result);
  }
  return { sources: [...sources.filter(source => !reserved.has(source.customerId)), ...combined]
    .sort((a, b) => a.name.localeCompare(b.name, "hu-HU") || a.customerId.localeCompare(b.customerId)), errors };
}
