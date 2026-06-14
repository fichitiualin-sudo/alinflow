import type { Customer } from "./types";
import { normalizePostalCodeInput, uniqueSettlementByCity } from "./postal-codes";

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

export function postalCodeFromCustomerData(city?: string, postalCode?: string, address?: string) {
  const direct = normalizePostalCodeInput(postalCode);
  if (direct) return direct;

  const addressMatch = String(address || "").match(/\b\d{4}\b/);
  if (addressMatch?.[0]) return addressMatch[0];

  return uniqueSettlementByCity(city)?.postalCode || "";
}
