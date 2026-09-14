import { inventoryPriceKey, type InventoryPurchasePrice } from "./inventory-purchase-prices";

type PurchaseAmount = Pick<InventoryPurchasePrice, "purchasePrice" | "taxBasis">;
type WarehouseValueItem = {
  itemType: "climate" | "material";
  itemKey: string;
  stock: number;
  reserved: number;
};

export type WarehouseValueSummary = {
  grossStockValue: number;
  reservedValue: number;
  freeValue: number;
  missingStockPriceCount: number;
  pricedStockItemCount: number;
};

const ZERO = BigInt(0);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);

// Read decimal digits before multiplying: e.g. 0.29 × 150 cents must round 43.5 to 44.
function roundedDecimalProduct(value: number, multiplier: bigint): bigint {
  const [decimal, exponent = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = decimal.split(".");
  const power = Number(exponent) - fraction.length;
  const numerator = BigInt(whole + fraction) * multiplier;
  if (power >= 0) return numerator * TEN ** BigInt(power);
  const denominator = TEN ** BigInt(-power);
  return (numerator + denominator / BigInt(2)) / denominator;
}

function grossPurchasePriceCents(price?: PurchaseAmount): bigint | null {
  const amount = price?.purchasePrice;
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount < 0
    || (price?.taxBasis !== "gross" && price?.taxBasis !== "net")) return null;
  return roundedDecimalProduct(amount, price.taxBasis === "net" ? BigInt(127) : HUNDRED);
}

export function grossPurchasePrice(price?: PurchaseAmount): number | null {
  const cents = grossPurchasePriceCents(price);
  return cents === null ? null : Number(cents) / 100;
}

function physicalQuantity(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function summarizeWarehouseValue(
  items: readonly WarehouseValueItem[],
  prices: ReadonlyMap<string, InventoryPurchasePrice>,
): WarehouseValueSummary {
  let stockCents = ZERO;
  let reservedCents = ZERO;
  let missingStockPriceCount = 0;
  let pricedStockItemCount = 0;
  for (const item of items) {
    const stock = physicalQuantity(item.stock);
    if (!stock) continue;
    const unitCents = grossPurchasePriceCents(prices.get(inventoryPriceKey(item)));
    if (unitCents === null) {
      missingStockPriceCount++;
      continue;
    }
    pricedStockItemCount++;
    const reserved = Math.min(stock, physicalQuantity(item.reserved));
    stockCents += roundedDecimalProduct(stock, unitCents);
    reservedCents += roundedDecimalProduct(reserved, unitCents);
  }
  return {
    grossStockValue: Number(stockCents) / 100,
    reservedValue: Number(reservedCents) / 100,
    // Calculate the remainder in cents so independently rounded quantities cannot add a cent.
    freeValue: Number(stockCents - reservedCents) / 100,
    missingStockPriceCount,
    pricedStockItemCount,
  };
}

export function groupWarehouseItems<T extends { name: string }>(
  items: readonly T[],
  stockOf: (item: T) => number,
): Array<{ key: "in-stock" | "other"; title: string; items: T[] }> {
  const collator = new Intl.Collator("hu-HU", { sensitivity: "base" });
  const sorted = items.map((item, index) => ({ item, index }))
    .sort((a, b) => collator.compare(a.item.name, b.item.name) || a.index - b.index);
  const inStock: T[] = [];
  const other: T[] = [];
  for (const { item } of sorted) {
    (physicalQuantity(stockOf(item)) > 0 ? inStock : other).push(item);
  }
  return [
    { key: "in-stock", title: "Raktáron", items: inStock },
    { key: "other", title: "További tételek", items: other },
  ];
}
