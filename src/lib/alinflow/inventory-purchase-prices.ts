import { supabase } from "@/lib/supabase";

// Internal warehouse data. Never merge these records into products, quotes or customer payloads.
export type InventoryPriceItem = { itemType: "climate" | "material"; itemKey: string };
export type PurchaseTaxBasis = "gross" | "net";
export type InventoryPurchasePrice = InventoryPriceItem & {
  workspaceId: string;
  purchasePrice: number | null;
  taxBasis: PurchaseTaxBasis;
  updatedAt: string;
};
const COLUMNS = "workspace_id,item_type,item_key,purchase_price,tax_basis,updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PRICE = 999999999.99;
const BATCH_SIZE = 500;

export function inventoryPriceKey(item: InventoryPriceItem) {
  return JSON.stringify([item.itemType, item.itemKey]);
}

export function parsePurchasePrice(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) throw new Error("Nemnegatív összeget adj meg, legfeljebb két tizedesjeggyel.");
  const price = Number(text.replace(",", "."));
  if (!Number.isFinite(price) || price > MAX_PRICE) throw new Error("A beszerzési ár legfeljebb 999 999 999,99 Ft lehet.");
  return price;
}

function assertWorkspace(workspaceId: string) {
  if (!UUID.test(workspaceId)) throw new Error("A beszerzési árakhoz jelentkezz be egy munkaterületre.");
}

function fromRow(row: Record<string, unknown>, workspaceId: string): InventoryPurchasePrice {
  const price = row.purchase_price === null ? null : Number(row.purchase_price);
  if (row.workspace_id !== workspaceId || !["climate", "material"].includes(String(row.item_type))
    || typeof row.item_key !== "string" || !row.item_key.trim()
    || !["gross", "net"].includes(String(row.tax_basis))
    || typeof row.updated_at !== "string" || !row.updated_at
    || (price !== null && (!Number.isFinite(price) || price < 0 || price > MAX_PRICE))) {
    throw new Error("A beszerzési ár adatai nem megfelelőek. Nyisd meg újra a raktárt.");
  }
  return {
    workspaceId, itemType: row.item_type as InventoryPriceItem["itemType"], itemKey: row.item_key,
    purchasePrice: price, taxBasis: row.tax_basis as PurchaseTaxBasis, updatedAt: row.updated_at,
  };
}

export async function listInventoryPurchasePrices(workspaceId: string): Promise<InventoryPurchasePrice[]> {
  assertWorkspace(workspaceId);
  const prices: InventoryPurchasePrice[] = [];
  for (let start = 0; ; start += BATCH_SIZE) {
    const { data, error } = await supabase.from("inventory_purchase_prices").select(COLUMNS)
      .eq("workspace_id", workspaceId).order("item_type").order("item_key").range(start, start + BATCH_SIZE - 1);
    if (error) throw new Error("A beszerzési árak nem tölthetők be. Ellenőrizd a kapcsolatot, majd próbáld újra.");
    const rows = data || [];
    prices.push(...rows.map((row) => fromRow(row, workspaceId)));
    if (rows.length < BATCH_SIZE) return prices;
  }
}

export async function saveInventoryPurchasePrice(workspaceId: string, item: InventoryPriceItem, value: string, taxBasis: PurchaseTaxBasis, existing?: InventoryPurchasePrice): Promise<InventoryPurchasePrice> {
  assertWorkspace(workspaceId);
  const target = { ...item };
  if (!["climate", "material"].includes(target.itemType) || !target.itemKey.trim() || target.itemKey.length > 500
    || !["gross", "net"].includes(taxBasis)) throw new Error("A készlettétel vagy az ár típusa nem megfelelő.");
  if (existing && (existing.workspaceId !== workspaceId || inventoryPriceKey(existing) !== inventoryPriceKey(target) || !existing.updatedAt)) {
    throw new Error("Az ár másik készlettételhez tartozik. Nyisd meg újra a raktárt.");
  }
  const price = parsePurchasePrice(value);
  const payload = { purchase_price: price, tax_basis: taxBasis };
  const query = existing
    ? supabase.from("inventory_purchase_prices").update(payload).eq("workspace_id", workspaceId)
      .eq("item_type", target.itemType).eq("item_key", target.itemKey).eq("updated_at", existing.updatedAt)
    : supabase.from("inventory_purchase_prices").insert({ ...payload, workspace_id: workspaceId, item_type: target.itemType, item_key: target.itemKey });
  const { data, error } = await query.select(COLUMNS).single();
  if (error || !data) {
    throw new Error(error?.code === "23505" || error?.code === "PGRST116"
      ? "Ezt az árat közben máshol is módosították. Nyisd meg újra a raktárt, majd ellenőrizd a friss értéket."
      : "A beszerzési árat nem sikerült menteni. Az eladási ár és a készlet nem változott. Próbáld újra.");
  }
  const saved = fromRow(data, workspaceId);
  if (inventoryPriceKey(saved) !== inventoryPriceKey(target)) throw new Error("A mentett ár másik készlettételhez tartozik.");
  return saved;
}
