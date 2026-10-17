import type { Customer } from "./types";
import { exactPostalCodeSettlements, uniqueSettlementByCity, uniqueSettlementByPostalCode } from "./postal-codes";

export const LIST_PAGE_SIZE = 10;

export function customerCreatedAtMs(customer: Pick<Customer, "createdAt">) {
  if (!customer.createdAt) return 0;
  const date = new Date(customer.createdAt);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function sortCustomersByCreatedAtDesc(list: Customer[]) {
  return [...list].sort((a, b) => customerCreatedAtMs(b) - customerCreatedAtMs(a));
}

export function paginateItems<T>(items: T[], page: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / LIST_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const start = (currentPage - 1) * LIST_PAGE_SIZE;
  return {
    currentPage,
    pageCount,
    items: items.slice(start, start + LIST_PAGE_SIZE),
  };
}

export function formatCustomerCreatedAt(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function exactPostalCode(value?: string) {
  return String(value || "").trim().match(/^\d{4}$/)?.[0] || "";
}

function fullAddressLocationPrefix(address?: string) {
  // A parcel number or a longer numeric identifier is not a postcode.
  const match = String(address || "").match(/^\s*(\d{4})(?!\d)\s*,?\s*(\p{L}.*)$/u);
  return match && !/^(?:hrsz|helyrajzi\s+sz[aá]m)(?:[.\s/:]|$)/i.test(match[2]) ? match : null;
}

function normalizeLocationText(value: string) {
  return value.toLocaleLowerCase("hu-HU").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim();
}

export function customerLocationFromData(city?: string, postalCode?: string, address?: string) {
  const addressPrefix = fullAddressLocationPrefix(address);
  if (addressPrefix) {
    const code = addressPrefix[1];
    const addressCity = normalizeLocationText(addressPrefix[2]);
    const matches = exactPostalCodeSettlements(code).filter((settlement) => {
      const name = normalizeLocationText(settlement.city);
      return addressCity === name || (addressCity.startsWith(name) && /^[\s,.;:(]/.test(addressCity.slice(name.length)));
    });
    // A full work address owns its location; never borrow a different
    // installation's canonical city. Shared postcodes need an explicit town.
    return { city: matches.length === 1 ? matches[0].city : uniqueSettlementByPostalCode(code)?.city || "", postalCode: code };
  }

  const suppliedCity = String(city || "").trim();
  const code = exactPostalCode(postalCode) || uniqueSettlementByCity(suppliedCity)?.postalCode || "";
  return { city: suppliedCity || uniqueSettlementByPostalCode(code)?.city || "", postalCode: code };
}

export function postalCodeFromCustomerData(city?: string, postalCode?: string, address?: string) {
  // Preserve the existing precedence for callers asking only for a postcode.
  return exactPostalCode(postalCode) || fullAddressLocationPrefix(address)?.[1]
    || uniqueSettlementByCity(city)?.postalCode || "";
}
