import { supabase } from "@/lib/supabase";
import { cleanQuoteItems, itemName, itemQuantity } from "./products";
import type { QuoteItem, WorkPhotoContext } from "./types";

export const DEVICE_DATA_FIELDS = [
  "manufacturer", "indoorModel", "outdoorModel", "indoorSerial", "outdoorSerial",
  "nominalElectricalKw", "heatingCapacityKw", "scop", "systemType", "phaseCount",
  "startCurrentReduction", "nominalCurrentA", "maximumCurrentA", "recommendedFuse",
  "supplementaryHeaterKw", "supplementaryHeaterSeparable", "supplementaryHeaterSharePercent",
  "heatingSeasonKwh", "summerSeasonKwh", "systemUsage", "heatSource",
] as const;
export type DeviceDataField = typeof DEVICE_DATA_FIELDS[number];
export type DeviceTechnicalData = Partial<Record<DeviceDataField, string>>;
export type AppointmentDevice = {
  id: string; workspaceId: string; customerId: string; appointmentId: string;
  productKey: string; productName: string; unitNumber: number;
  data: DeviceTechnicalData; updatedAt?: string;
};
export type DeviceSlot = Pick<AppointmentDevice, "productKey" | "productName" | "unitNumber">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function deviceSlots(items: QuoteItem[]): DeviceSlot[] {
  const counters = new Map<string, number>();
  return cleanQuoteItems(items).flatMap((item) => {
    const name = itemName(item);
    const productKey = item.productId && !item.isManual ? `product:${item.productId}` : `manual:${name.trim().toLocaleLowerCase("hu-HU")}`;
    const quantity = itemQuantity(item);
    if (!Number.isInteger(quantity) || quantity > 100) throw new Error("A készülékadatokhoz tételenként 1–100 egész darabszám szükséges.");
    return Array.from({ length: quantity }, () => {
      const unitNumber = (counters.get(productKey) || 0) + 1;
      counters.set(productKey, unitNumber);
      return { productKey, productName: name, unitNumber };
    });
  });
}

export function deviceSlotKey(device: DeviceSlot) { return `${device.productKey}:${device.unitNumber}`; }

export function normalizeDeviceData(value: unknown): DeviceTechnicalData {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(DEVICE_DATA_FIELDS.map((key) => [key, String(source[key] ?? "").trim().slice(0, 200)]));
}

function assertScope(context: WorkPhotoContext) {
  if (!UUID.test(context.workspaceId) || !UUID.test(context.customerId) || !UUID.test(context.appointmentId)) {
    throw new Error("Előbb mentsd el a telepítési időpontot.");
  }
}

function fromRow(row: Record<string, unknown>): AppointmentDevice {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), customerId: String(row.customer_id),
    appointmentId: String(row.appointment_id), productKey: String(row.product_key),
    productName: String(row.product_name), unitNumber: Number(row.unit_number),
    data: normalizeDeviceData(row.data), updatedAt: String(row.updated_at || ""),
  };
}

export async function listAppointmentDevices(context: WorkPhotoContext): Promise<AppointmentDevice[]> {
  assertScope(context);
  const { data, error } = await supabase.from("appointment_devices").select("*")
    .eq("workspace_id", context.workspaceId).eq("customer_id", context.customerId).eq("appointment_id", context.appointmentId)
    .order("product_key").order("unit_number");
  if (error) throw new Error("A készülékadatok nem tölthetők be. Ellenőrizd a kapcsolatot és a készülékadatok beállítását.");
  return (data || []).map(fromRow);
}

export async function saveAppointmentDevice(context: WorkPhotoContext, slot: DeviceSlot, data: DeviceTechnicalData, existing?: AppointmentDevice): Promise<AppointmentDevice> {
  const scope = { ...context };
  assertScope(scope);
  if (!slot.productKey || slot.productKey.length > 250 || !slot.productName.trim()
    || !Number.isInteger(slot.unitNumber) || slot.unitNumber < 1 || slot.unitNumber > 1000) throw new Error("A készülék azonosítása nem megfelelő.");
  if (existing && (existing.workspaceId !== scope.workspaceId || existing.customerId !== scope.customerId
    || existing.appointmentId !== scope.appointmentId || deviceSlotKey(existing) !== deviceSlotKey(slot))) {
    throw new Error("A készülék másik munkához tartozik. Nyisd meg újra az időpontot.");
  }
  const payload = {
    workspace_id: scope.workspaceId, customer_id: scope.customerId, appointment_id: scope.appointmentId,
    product_key: slot.productKey, product_name: slot.productName.trim(), unit_number: slot.unitNumber,
    data: normalizeDeviceData(data),
  };
  // Existing records use optimistic versioning: a second tab must reload before overwriting edits.
  const query = existing
    ? supabase.from("appointment_devices").update(payload).eq("id", existing.id).eq("updated_at", existing.updatedAt!)
      .eq("workspace_id", scope.workspaceId).eq("customer_id", scope.customerId).eq("appointment_id", scope.appointmentId)
    : supabase.from("appointment_devices").insert(payload);
  const { data: saved, error } = await query.select("*").single();
  if (error || !saved) {
    throw new Error(error?.code === "23505" || error?.code === "PGRST116"
      ? "Ezt a készüléket közben máshol is mentették. Frissítsd a készülékadatokat, majd próbáld újra."
      : "A készülékadatokat nem sikerült menteni. Próbáld újra.");
  }
  return fromRow(saved);
}
