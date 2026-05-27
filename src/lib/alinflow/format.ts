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

export function fullCustomerAddress(customer: Pick<Customer, "city" | "address">) {
  const city = (customer.city || "").trim();
  const address = (customer.address || "").trim();
  if (city && address) {
    return address.toLowerCase().includes(city.toLowerCase()) ? address : `${city}, ${address}`;
  }
  return address || city || "nincs megadva";
}

export function displayAddress(customer: Pick<Customer, "city" | "address">) {
  const city = (customer.city || "").trim();
  const address = (customer.address || "").trim();
  if (city && address) {
    return address.toLocaleLowerCase("hu-HU").includes(city.toLocaleLowerCase("hu-HU")) ? address : `${city}, ${address}`;
  }
  return address || city || "";
}

export function telHref(phone: string) {
  const cleaned = phone.replace(/[^+0-9]/g, "");
  return `tel:${cleaned}`;
}

export function mapsHref(customer: Customer) {
  const destination = displayAddress(customer) || customer.name || "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
