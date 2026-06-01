import type { ClimateProduct, Customer, QuoteItem, QuotePricingMode } from "./types";
import { DEFAULT_INSTALL_PRICE, EMPTY_PRODUCT, PRODUCTS } from "./constants";
import { appointmentInterval, intervalsOverlap, ONE_HOUR_APPOINTMENT_SLOTS, timeToMinutes } from "./appointments";
import { ft } from "./format";

export function productSlug(value: string) {
  return String(value || "klima")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `klima-${Date.now()}`;
}

export function productPriceText(product: Pick<ClimateProduct, "price">) {
  return `${Number(product.price || 0).toLocaleString("hu-HU")} Ft (telepítéssel együtt)`;
}

export function normalizeQuotePricingMode(value?: string | null): QuotePricingMode {
  return value === "alternatives" || value === "quote_pricing_mode:alternatives" ? "alternatives" : "bundle";
}

export function quotePricingModeFromNotes(notes?: string | null): QuotePricingMode {
  return normalizeQuotePricingMode(notes);
}

export function quotePricingModeToNotes(mode?: QuotePricingMode) {
  return `quote_pricing_mode:${normalizeQuotePricingMode(mode)}`;
}

export function isQuoteAlternatives(mode?: QuotePricingMode) {
  return normalizeQuotePricingMode(mode) === "alternatives";
}

export function normalizeProduct(product: any): ClimateProduct {
  const name = String(product?.name || "Névtelen klíma").trim();
  const price = Number(product?.price ?? product?.total_price ?? 0) || 0;
  const installPrice = Number(product?.installPrice ?? product?.install_price ?? DEFAULT_INSTALL_PRICE) || 0;
  return {
    id: String(product?.id || productSlug(name)),
    name,
    price,
    installPrice,
    priceText: product?.priceText || productPriceText({ price }),
    active: product?.active !== false,
  };
}

export function sortProducts(products: ClimateProduct[]) {
  return [...products]
    .map(normalizeProduct)
    .filter((product) => product.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, "hu", { sensitivity: "base" }));
}

let ACTIVE_PRODUCTS: ClimateProduct[] = sortProducts(PRODUCTS as any);

export function setActiveProducts(products: ClimateProduct[]) {
  ACTIVE_PRODUCTS = sortProducts(products);
}

export function isKnownProductId(productId?: string) {
  return Boolean(productId && ACTIVE_PRODUCTS.some((product: any) => product.id === productId));
}

export function isCustomQuoteItem(item: QuoteItem) {
  return Boolean(item.isManual || item.customName?.trim() || (item.productId && !isKnownProductId(item.productId)));
}

export function isQuoteItemFilled(item: QuoteItem) {
  return Boolean(item.customName?.trim() || isKnownProductId(item.productId));
}

export function cleanQuoteItems(items?: QuoteItem[]) {
  return (items || []).filter(isQuoteItemFilled).map((item) => ({
    ...item,
    quantity: itemQuantity(item),
    productId: isKnownProductId(item.productId) ? item.productId : "",
    customName: item.customName?.trim() || undefined,
    customPrice: item.customPrice === "" ? undefined : item.customPrice,
    isManual: item.isManual || !isKnownProductId(item.productId),
  }));
}

export function prod(id: string) {
  return ACTIVE_PRODUCTS.find((p: any) => p.id === id) || EMPTY_PRODUCT;
}

export function qty(items: QuoteItem[]) {
  return cleanQuoteItems(items).reduce((s, i) => s + itemQuantity(i), 0);
}

export function itemName(item: QuoteItem) {
  const custom = item.customName?.trim();
  if (custom) return custom;
  if (isKnownProductId(item.productId)) return prod(item.productId).name;
  return item.isManual ? "Egyedi klíma" : "Válassz klímát";
}

export function itemQuantity(item: QuoteItem) {
  const quantity = Number(item.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

export function itemUnitPrice(item: QuoteItem) {
  const customPrice = Number(item.customPrice);
  return item.customPrice !== undefined && item.customPrice !== "" && Number.isFinite(customPrice) ? customPrice : prod(item.productId).price;
}

export function itemInstallPrice(item: QuoteItem) {
  if (!isQuoteItemFilled(item)) return 0;
  if (isCustomQuoteItem(item)) return Math.min(DEFAULT_INSTALL_PRICE, itemUnitPrice(item));
  return Math.min(prod(item.productId).installPrice || DEFAULT_INSTALL_PRICE, itemUnitPrice(item));
}

export function itemTotal(item: QuoteItem) {
  return itemUnitPrice(item) * itemQuantity(item);
}

export function itemInstallTotal(item: QuoteItem) {
  return itemInstallPrice(item) * itemQuantity(item);
}

export function total(items: QuoteItem[]) {
  return cleanQuoteItems(items).reduce((s, i) => s + itemTotal(i), 0);
}

export function quoteInstallTotal(items: QuoteItem[]) {
  const clean = cleanQuoteItems(items);
  return Math.min(total(clean), clean.reduce((sum, item) => sum + itemInstallTotal(item), 0));
}

export function itemPriceLine(item: QuoteItem) {
  if (!isQuoteItemFilled(item)) return "Nincs klíma kiválasztva";
  if (isCustomQuoteItem(item)) return "Egyedi klíma / tétel";
  return `${ft(itemUnitPrice(item))} / db (telepítéssel együtt)`;
}

export function hasCustomProductPrice(item: QuoteItem) {
  return isKnownProductId(item.productId) && !item.isManual && itemUnitPrice(item) !== prod(item.productId).price;
}

export function occupiedSlots(customer: Customer) {
  if (!customer.time) return [];
  const interval = appointmentInterval(customer);
  if (!interval) return [];

  return ONE_HOUR_APPOINTMENT_SLOTS.filter((slot) => {
    const start = timeToMinutes(slot);
    if (start === null) return false;
    return intervalsOverlap(interval, { start, end: start + 60 });
  });
}

export function quoteItemFromRow(row: any): QuoteItem {
  const productById = ACTIVE_PRODUCTS.find((product) => product.id === row.description);
  const productByName = ACTIVE_PRODUCTS.find((product) => product.name === row.product_name);
  const matchedProduct = productById || productByName;

  return {
    productId: matchedProduct?.id || "",
    quantity: Number(row.quantity || 1),
    customPrice: Number(row.unit_price || matchedProduct?.price || 0),
    customName: matchedProduct ? undefined : row.product_name,
    isManual: !matchedProduct,
  };
}

export function quoteItemToRow(item: QuoteItem, quoteId: string) {
  return {
    quote_id: quoteId,
    product_name: itemName(item),
    description: item.productId,
    quantity: itemQuantity(item),
    unit_price: itemUnitPrice(item),
    total_price: itemTotal(item),
  };
}

export function climateSummary(items?: QuoteItem[]) {
  const activeItems = cleanQuoteItems(items).filter((item) => itemQuantity(item) > 0);
  if (!activeItems.length) return "Nincs klíma megadva";
  return activeItems.map((item) => `${itemQuantity(item)} db ${itemName(item)}`).join(" + ");
}
