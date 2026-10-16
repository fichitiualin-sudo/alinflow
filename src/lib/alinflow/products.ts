import type { ClimateProduct, Customer, QuoteItem, QuotePricingMode } from "./types";
import { DEFAULT_INSTALL_PRICE, EMPTY_PRODUCT, PRODUCTS } from "./constants";
import { appointmentInterval, intervalsOverlap, RECOMMENDED_APPOINTMENT_SLOTS, slotInterval } from "./appointments";
import { ft } from "./format";

export function productSlug(value: string) {
  return String(value || "klima")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `klima-${Date.now()}`;
}

export function klimalinProductNameKeys(value?: string | null) {
  const exact = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("hu-HU")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const compatible = exact
    .replace(/\bmono split klima\b/g, " ")
    .replace(/\bsplit klima\b/g, " ")
    .replace(/\bklimaberendezes\b/g, " ")
    .replace(/\bhuzatmentes\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return Array.from(new Set([exact, compatible].filter(Boolean)));
}

export function matchesKlimalinProductName(left?: string | null, right?: string | null) {
  const leftKeys = new Set(klimalinProductNameKeys(left));
  return klimalinProductNameKeys(right).some((key) => leftKeys.has(key));
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
    externalSource: product?.externalSource ?? product?.external_source ?? undefined,
    externalKey: product?.externalKey ?? product?.external_key ?? undefined,
    productUrl: product?.productUrl ?? product?.product_url ?? undefined,
    imageUrl: product?.imageUrl ?? product?.image_url ?? undefined,
    lastSyncedAt: product?.lastSyncedAt ?? product?.last_synced_at ?? undefined,
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

export function isExtraQuoteItem(item: QuoteItem) {
  return item.itemType === "extra";
}

export function isCustomQuoteItem(item: QuoteItem) {
  return Boolean(isExtraQuoteItem(item) || item.isManual || item.customName?.trim() || (item.productId && !isKnownProductId(item.productId) && !item.productName));
}

export function isQuoteItemFilled(item: QuoteItem) {
  return Boolean(item.customName?.trim() || item.productName?.trim() || !isExtraQuoteItem(item) && isKnownProductId(item.productId));
}

export function cleanQuoteItems(items?: QuoteItem[]): QuoteItem[] {
  // Customer documents may persist these objects; never copy unknown internal fields.
  return (items || []).filter(isQuoteItemFilled).map((item) => ({
    quantity: itemQuantity(item),
    productId: isExtraQuoteItem(item) ? "" : item.productId || "",
    productName: item.productName || (!isExtraQuoteItem(item) && isKnownProductId(item.productId) ? prod(item.productId).name : undefined),
    customName: item.customName?.trim() || undefined,
    customPrice: item.customPrice === "" ? undefined : item.customPrice,
    customInstallPrice: item.customInstallPrice === "" ? undefined : item.customInstallPrice,
    isManual: isExtraQuoteItem(item) || item.isManual || !item.productId,
    ...(item.itemType === "climate" || item.itemType === "extra" ? { itemType: item.itemType } : {}),
  }));
}

export function climateQuoteItems(items?: QuoteItem[]) {
  return cleanQuoteItems(items).filter((item) => !isExtraQuoteItem(item));
}

export function prod(id: string) {
  return ACTIVE_PRODUCTS.find((p: any) => p.id === id) || EMPTY_PRODUCT;
}

export function itemProductMedia(item: QuoteItem) {
  if (isExtraQuoteItem(item)) return {};
  const product = isKnownProductId(item.productId) ? prod(item.productId) : undefined;
  if (!item.isManual && product && (product.imageUrl || product.productUrl)) {
    return {
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
    };
  }

  const displayedName = item.customName?.trim() || product?.name;
  if (!displayedName) return {};

  const catalogMatches = ACTIVE_PRODUCTS.filter((candidate) => (
    candidate.externalSource === "klimalin"
    && Boolean(candidate.imageUrl || candidate.productUrl)
    && matchesKlimalinProductName(displayedName, candidate.name)
  ));
  if (catalogMatches.length !== 1) return {};

  return {
    imageUrl: catalogMatches[0].imageUrl,
    productUrl: catalogMatches[0].productUrl,
  };
}

export function qty(items: QuoteItem[]) {
  return climateQuoteItems(items).reduce((s, i) => s + itemQuantity(i), 0);
}

export function itemName(item: QuoteItem) {
  const custom = item.customName?.trim();
  if (custom) return custom;
  if (item.productName) return item.productName;
  if (isKnownProductId(item.productId)) return prod(item.productId).name;
  return isExtraQuoteItem(item) ? "Egyéb tétel" : item.isManual ? "Egyedi klíma" : "Válassz klímát";
}

export function itemQuantity(item: QuoteItem) {
  const quantity = Number(item.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

export function itemUnitPrice(item: QuoteItem) {
  const customPrice = Number(item.customPrice);
  return item.customPrice !== undefined && item.customPrice !== "" && Number.isFinite(customPrice) ? customPrice : isExtraQuoteItem(item) ? 0 : prod(item.productId).price;
}

export function itemInstallPrice(item: QuoteItem) {
  if (!isQuoteItemFilled(item)) return 0;
  const customInstallPrice = Number(item.customInstallPrice);
  if (item.customInstallPrice !== undefined && item.customInstallPrice !== "" && Number.isFinite(customInstallPrice)) {
    return Math.max(0, Math.min(customInstallPrice, itemUnitPrice(item)));
  }
  if (isExtraQuoteItem(item)) return 0;
  if (isCustomQuoteItem(item)) return Math.min(DEFAULT_INSTALL_PRICE, itemUnitPrice(item));
  return Math.min(prod(item.productId).installPrice || DEFAULT_INSTALL_PRICE, itemUnitPrice(item));
}

export function itemTotal(item: QuoteItem) {
  return itemUnitPrice(item) * itemQuantity(item);
}

export function itemInstallTotal(item: QuoteItem) {
  return itemInstallPrice(item) * itemQuantity(item);
}

export function itemDeviceTotal(item: QuoteItem) {
  return Math.max(0, itemTotal(item) - itemInstallTotal(item));
}

export function total(items: QuoteItem[]) {
  return cleanQuoteItems(items).reduce((s, i) => s + itemTotal(i), 0);
}

export function quoteInstallTotal(items: QuoteItem[]) {
  const clean = cleanQuoteItems(items);
  return Math.min(total(clean), clean.reduce((sum, item) => sum + itemInstallTotal(item), 0));
}

export function itemPriceLine(item: QuoteItem) {
  if (!isQuoteItemFilled(item)) return isExtraQuoteItem(item) ? "Add meg a tétel megnevezését" : "Nincs klíma kiválasztva";
  if (isExtraQuoteItem(item)) return "Egyéb tétel";
  if (isCustomQuoteItem(item)) return "Egyedi klíma / tétel";
  return `${ft(itemUnitPrice(item))} / db (telepítéssel együtt)`;
}

export function hasCustomProductPrice(item: QuoteItem) {
  if (isExtraQuoteItem(item) || !isKnownProductId(item.productId) || item.isManual) return false;
  const product = prod(item.productId);
  return itemUnitPrice(item) !== product.price || itemInstallPrice(item) !== product.installPrice;
}

export function occupiedSlots(customer: Customer) {
  if (!customer.time) return [];
  const interval = appointmentInterval(customer);
  if (!interval) return [];

  return RECOMMENDED_APPOINTMENT_SLOTS.filter((slot) => {
    const slotCandidate = slotInterval(slot, customer.appointmentType, customer.quoteItems || []);
    return slotCandidate ? intervalsOverlap(interval, slotCandidate) : false;
  });
}

export function quoteItemFromRow(row: any): QuoteItem {
  const description = parseQuoteItemDescription(row.description);
  const productById = ACTIVE_PRODUCTS.find((product) => product.id === description.productId);
  const productByName = ACTIVE_PRODUCTS.find((product) => product.name === row.product_name);
  const extra = description.itemType === "extra";
  const matchedProduct = extra ? undefined : productById || productByName;

  return {
    productId: extra ? "" : description.productId || matchedProduct?.id || "",
    productName: row.product_name || matchedProduct?.name,
    quantity: Number(row.quantity || 1),
    customPrice: Number(row.unit_price ?? matchedProduct?.price ?? 0),
    customInstallPrice: description.installPrice,
    customName: !extra && (description.productId || matchedProduct) ? undefined : row.product_name,
    isManual: extra || !description.productId && !matchedProduct,
    ...(description.itemType ? { itemType: description.itemType } : {}),
  };
}

function parseQuoteItemDescription(value: unknown) {
  const raw = String(value || "");
  const [productId, ...parts] = raw.split("|");
  const installPart = parts.find((part) => part.startsWith("install_price="));
  const installPrice = installPart ? Number(installPart.replace("install_price=", "")) : undefined;
  return {
    productId,
    installPrice: Number.isFinite(installPrice) ? installPrice : undefined,
    itemType: parts.includes("item_type=extra") ? "extra" as const : parts.includes("item_type=climate") ? "climate" as const : undefined,
  };
}

function quoteItemDescription(item: QuoteItem) {
  const productId = isExtraQuoteItem(item) ? "" : item.productId || "";
  const installPrice = itemInstallPrice(item);
  const itemType = item.itemType === "extra" || item.itemType === "climate" ? `|item_type=${item.itemType}` : "";
  return `${productId}|install_price=${installPrice}${itemType}`;
}

export function quoteItemToRow(item: QuoteItem, quoteId: string) {
  return {
    quote_id: quoteId,
    product_name: itemName(item),
    description: quoteItemDescription(item),
    quantity: itemQuantity(item),
    unit_price: itemUnitPrice(item),
    total_price: itemTotal(item),
  };
}

export function climateSummary(items?: QuoteItem[]) {
  const activeItems = climateQuoteItems(items).filter((item) => itemQuantity(item) > 0);
  if (!activeItems.length) return "Nincs klíma megadva";
  return activeItems.map((item) => `${itemQuantity(item)} db ${itemName(item)}`).join(" + ");
}
