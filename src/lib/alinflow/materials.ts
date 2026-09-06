import { DEFAULT_MATERIALS } from "./constants";
import { qty } from "./products";
import type { Customer, QuoteItem } from "./types";

export function materialAmountForWork(name: string, items: QuoteItem[], usage?: Customer["materialUsage"]) {
  const materials = usage?.materials ?? DEFAULT_MATERIALS;
  const count = Math.max(1, qty(items));
  const consoleName = materials.find((item) => item.name === "Konzol")?.qty;
  if (name === "450-es konzol" || name === "550-es konzol") return consoleName === name ? count : 0;
  const material = materials.find((item) => item.name === name);
  if (!material || name === "Konzol") return 0;
  const override = usage?.overrides?.[name];
  const amount = Number(String(override ?? material.qty).replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * (override !== undefined || material.isExtra ? 1 : count) * 10) / 10;
}

export function stockMaterialQuantities(items: QuoteItem[], usage?: Customer["materialUsage"]) {
  const materials = usage?.materials ?? DEFAULT_MATERIALS;
  for (const material of materials) {
    if (material.name === "Konzol") continue;
    const value = Number(String(usage?.overrides?.[material.name] ?? material.qty).replace(",", "."));
    if (!Number.isFinite(value) || value < 0) throw new Error(`Érvénytelen anyagmennyiség: ${material.name}`);
  }
  const names = new Set(materials.map((item) => item.name === "Konzol" ? item.qty : item.name));
  return Array.from(names, (name) => ({ name, quantity: materialAmountForWork(name, items, usage) }))
    .filter((item) => item.quantity > 0);
}
