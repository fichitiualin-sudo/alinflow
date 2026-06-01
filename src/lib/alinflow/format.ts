import type { Customer } from "./types";

export function ft(n: number) {
  return n.toLocaleString("hu-HU") + " Ft";
}

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function iso(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso() {
  return iso(new Date());
}

export function offsetIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
}

function customerLocationLine(customer: Pick<Customer, "city" | "address" | "postalCode">) {
  const postalCode = (customer.postalCode || "").trim();
  const city = (customer.city || "").trim();
  return [postalCode, city].filter(Boolean).join(" ");
}

function addressAlreadyContainsLocation(address: string, location: string) {
  const normalizedAddress = address.toLocaleLowerCase("hu-HU");
  const normalizedLocation = location.toLocaleLowerCase("hu-HU");
  return Boolean(location && normalizedAddress.includes(normalizedLocation));
}

export function fullCustomerAddress(customer: Pick<Customer, "city" | "address" | "postalCode">) {
  const location = customerLocationLine(customer);
  const address = (customer.address || "").trim();
  if (location && address) {
    return addressAlreadyContainsLocation(address, location) || (customer.city && addressAlreadyContainsLocation(address, customer.city))
      ? address
      : `${location}, ${address}`;
  }
  return address || location || "nincs megadva";
}

export function displayAddress(customer: Pick<Customer, "city" | "address" | "postalCode">) {
  const location = customerLocationLine(customer);
  const address = (customer.address || "").trim();
  if (location && address) {
    return addressAlreadyContainsLocation(address, location) || (customer.city && addressAlreadyContainsLocation(address, customer.city))
      ? address
      : `${location}, ${address}`;
  }
  return address || location || "";
}

export function telHref(phone: string) {
  const cleaned = phone.replace(/[^+0-9]/g, "");
  return `tel:${cleaned}`;
}

export function mapsHref(customer: Customer) {
  const destination = displayAddress(customer) || customer.name || "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
