import { isArchivedCustomer } from "./constants";
import { uniqueSettlementByPostalCode } from "./postal-codes";
import { climateSummary } from "./products";
import { CALLBACK_TOWNS, type CallbackTown } from "./callback-town-data";
import type { Customer } from "./types";

export type CallbackMapGroup = {
  id: string;
  city: string;
  latitude: number;
  longitude: number;
  customers: Customer[];
};

export type CallbackMapData = {
  groups: CallbackMapGroup[];
  unlocated: Customer[];
  total: number;
};

function normalize(value?: string) {
  return (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("hu-HU").trim().replace(/\s+/g, " ");
}

function exactTownName(value: string) {
  return value.normalize("NFC").toLocaleLowerCase("hu-HU").trim().replace(/\s+/g, " ");
}

const townsByExactName = new Map<string, CallbackTown>();
const townsByName = new Map<string, CallbackTown | null>();
for (const town of CALLBACK_TOWNS) {
  townsByExactName.set(exactTownName(town[0]), town);
  const key = normalize(town[0]);
  // Accent removal must not silently choose between different municipalities.
  if (townsByName.has(key)) townsByName.set(key, null);
  else townsByName.set(key, town);
}

function lookupTown(name: string): CallbackTown | undefined {
  return townsByExactName.get(exactTownName(name)) || townsByName.get(normalize(name)) || undefined;
}

function locate(customer: Customer): CallbackTown | undefined {
  const city = (customer.city || "").trim();
  if (city) {
    // Only a complete town name may match. No substring, street-address or
    // fuzzy matching, and a misspelled town never falls back to its postcode.
    const townName = city.replace(/^(?:(?:HU|H)[ -]?)?\d{4}[\s,]+/i, "");
    return lookupTown(townName);
  }
  // The existing helper accepts partial/noisy codes; validate strictly before
  // using it, and permit postcode inference only when the town field is empty.
  const postalCode = /^(?:(?:HU|H)[ -]?)?(\d{4})$/i.exec((customer.postalCode || "").trim())?.[1];
  if (!postalCode) return undefined;
  const settlement = uniqueSettlementByPostalCode(postalCode);
  return settlement ? lookupTown(settlement.city) : undefined;
}

export function callbackClimateLabel(customer: Customer) {
  return customer.need?.trim() || climateSummary(customer.quoteItems);
}

export function callbackInquiryDate(customer: Pick<Customer, "createdAt" | "timeline">) {
  const value = customer.createdAt || customer.timeline?.inquiredAt;
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Budapest" });
}

export function buildCallbackMap(customers: Customer[], search = ""): CallbackMapData {
  const grouped = new Map<string, CallbackMapGroup>();
  const unlocated: Customer[] = [];
  const needle = normalize(search);
  let total = 0;
  for (const customer of customers) {
    if (isArchivedCustomer(customer) || customer.status !== "Visszahívandó" || customer.date) continue;
    const town = locate(customer);
    if (needle && !normalize([customer.name, customer.city, town?.[0], callbackClimateLabel(customer)].filter(Boolean).join(" ")).includes(needle)) continue;
    total++;
    if (!town) { unlocated.push(customer); continue; }
    const [city, latitude, longitude] = town;
    const id = `town:${exactTownName(city)}`;
    let group = grouped.get(id);
    if (!group) {
      group = { id, city, latitude, longitude, customers: [] };
      grouped.set(id, group);
    }
    group.customers.push(customer);
  }
  return { groups: [...grouped.values()].sort((a, b) => a.city.localeCompare(b.city, "hu")), unlocated, total };
}
