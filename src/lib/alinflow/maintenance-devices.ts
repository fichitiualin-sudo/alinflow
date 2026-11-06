import type { Customer, MaintenanceDeviceSelection, QuoteItem } from "./types";
import { climateQuoteItems, itemName, itemQuantity } from "./products";

type DeviceSelection = MaintenanceDeviceSelection[] | null | undefined;

function normalizedDeviceName(name: string) {
  return name.trim().toLocaleLowerCase("hu-HU");
}

/** Names survive maintenance handoffs, while catalog product IDs do not. */
export function maintenanceDeviceKey(slot: MaintenanceDeviceSelection) {
  return JSON.stringify([normalizedDeviceName(slot.productName), slot.unitNumber]);
}

function deviceRows(items: QuoteItem[]) {
  const counters = new Map<string, number>();
  return climateQuoteItems(items).map((item) => {
    const productName = itemName(item).trim();
    const nameKey = normalizedDeviceName(productName);
    const quantity = itemQuantity(item);
    if (!productName || !Number.isInteger(quantity) || quantity > 1000) {
      throw new Error("A klímák kiválasztásához érvényes típus és egész darabszám szükséges.");
    }
    const start = counters.get(nameKey) || 0;
    counters.set(nameKey, start + quantity);
    const slots = Array.from({ length: quantity }, (_, index) => ({ productName, unitNumber: start + index + 1 }));
    return { item, slots };
  });
}

/** One selectable identity per physical unit, including legacy installations without serials. */
export function maintenanceDeviceSlots(items: QuoteItem[]): MaintenanceDeviceSelection[] {
  return deviceRows(items).flatMap((row) => row.slots);
}

function selectionKeys(selection: MaintenanceDeviceSelection[]) {
  if (!Array.isArray(selection)) throw new Error("A kiválasztott klímák adatai hibásak. Válaszd ki őket újra.");
  const keys = new Set<string>();
  for (const slot of selection) {
    if (!slot || typeof slot.productName !== "string" || !slot.productName.trim()
      || !Number.isInteger(slot.unitNumber) || slot.unitNumber < 1) {
      throw new Error("A kiválasztott klíma azonosítása hibás. Válaszd ki újra.");
    }
    const key = maintenanceDeviceKey(slot);
    if (keys.has(key)) throw new Error("Ugyanaz a klíma többször szerepel a kiválasztásban. Válaszd ki újra.");
    keys.add(key);
  }
  return keys;
}

/** Missing selection is historical whole-installation service; an empty array means none. */
export function selectedMaintenanceDevices(items: QuoteItem[], selection?: DeviceSelection): MaintenanceDeviceSelection[] {
  const slots = maintenanceDeviceSlots(items);
  if (selection == null) return slots;
  const selected = selectionKeys(selection);
  const available = new Set(slots.map(maintenanceDeviceKey));
  if (Array.from(selected).some((key) => !available.has(key))) {
    throw new Error("Egy kiválasztott klíma közben megváltozott. Frissítsd a telepítést és válaszd ki újra.");
  }
  return slots.filter((slot) => selected.has(maintenanceDeviceKey(slot)));
}

/** Rebuild maintenance-only quantities without mutating the installation or its prices. */
export function selectedMaintenanceQuoteItems(items: QuoteItem[], selection?: DeviceSelection): QuoteItem[] {
  const rows = deviceRows(items);
  if (selection == null) return rows.map((row) => row.item);
  const selected = new Set(selectedMaintenanceDevices(items, selection).map(maintenanceDeviceKey));
  return rows.flatMap(({ item, slots }) => {
    const quantity = slots.filter((slot) => selected.has(maintenanceDeviceKey(slot))).length;
    return quantity ? [{ ...item, quantity }] : [];
  });
}

export function maintenanceSelectionFor(
  work: Pick<Customer, "maintenanceDeviceSelections" | "maintenanceInstallations">,
  installationId: string,
): MaintenanceDeviceSelection[] | undefined {
  if (work.maintenanceDeviceSelections && Object.hasOwn(work.maintenanceDeviceSelections, installationId)) {
    return work.maintenanceDeviceSelections[installationId] ?? undefined;
  }
  return work.maintenanceInstallations?.find((installation) => installation.appointmentId === installationId)?.selectedDevices ?? undefined;
}

/** Use only for dated maintenance events already linked to this installation. */
export function maintenanceDeviceMatches(slot: MaintenanceDeviceSelection, selection?: DeviceSelection) {
  return selection == null || selectionKeys(selection).has(maintenanceDeviceKey(slot));
}
