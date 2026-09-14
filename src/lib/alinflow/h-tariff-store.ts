import { supabase } from "@/lib/supabase";
import { normalizeHTariffData, type HTariffData } from "./h-tariff";
import type { WorkPhotoContext } from "./types";
import { deviceSlotKey, type DeviceSlot } from "./appointment-devices";

export type HTariffRequest = { data: HTariffData; updatedAt: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertScope(context: WorkPhotoContext) {
  if (![context.workspaceId, context.customerId, context.appointmentId].every((value) => UUID.test(value)) || context.appointmentType !== "installation") throw new Error("A H tarifás nyomtatványhoz mentett telepítési időpont szükséges.");
}
function fromRow(row: { data: unknown; updated_at: unknown }): HTariffRequest { return { data: normalizeHTariffData(row.data), updatedAt: String(row.updated_at || "") }; }

export async function loadHTariffRequest(context: WorkPhotoContext): Promise<HTariffRequest | null> {
  assertScope(context);
  const { data, error } = await supabase.from("h_tariff_requests").select("data,updated_at")
    .eq("workspace_id", context.workspaceId).eq("customer_id", context.customerId).eq("appointment_id", context.appointmentId).maybeSingle();
  if (error) throw new Error("A H tarifás adatok nem tölthetők be. Ellenőrizd a kapcsolatot, majd próbáld újra.");
  return data ? fromRow(data) : null;
}

export async function saveHTariffRequest(context: WorkPhotoContext, data: HTariffData, existing?: HTariffRequest | null): Promise<HTariffRequest> {
  const scope = { ...context };
  assertScope(scope);
  const payload = { workspace_id: scope.workspaceId, customer_id: scope.customerId, appointment_id: scope.appointmentId, data: normalizeHTariffData(data) };
  const query = existing
    ? supabase.from("h_tariff_requests").update(payload).eq("updated_at", existing.updatedAt)
      .eq("workspace_id", scope.workspaceId).eq("customer_id", scope.customerId).eq("appointment_id", scope.appointmentId)
    : supabase.from("h_tariff_requests").insert(payload);
  const { data: result, error } = await query.select("data,updated_at").single();
  if (error || !result) throw new Error(error?.code === "23505" || error?.code === "PGRST116"
    ? "A H tarifás adatokat közben máshol mentették. Frissítsd az adatokat, majd próbáld újra."
    : "A H tarifás adatok mentése nem sikerült. Próbáld újra.");
  return fromRow(result);
}

export async function downloadHTariffPdf(context: WorkPhotoContext, expectedDevices: DeviceSlot[]): Promise<void> {
  assertScope(context);
  const { data: session, error } = await supabase.auth.getSession();
  if (error || !session.session) throw new Error("A PDF letöltéséhez jelentkezz be újra.");
  const response = await fetch("/api/h-tariff/pdf", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session.access_token}` },
    body: JSON.stringify({ workspaceId: context.workspaceId, customer: { id: context.customerId, activeAppointmentId: context.appointmentId }, expectedDeviceSlots: expectedDevices.map(deviceSlotKey) }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error || "A H tarifás PDF nem készíthető el. Próbáld újra.");
  }
  const blob = await response.blob();
  if (!blob.type.includes("application/pdf")) throw new Error("A kiszolgáló nem PDF-dokumentumot küldött.");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `H-tarifa-${context.workDate || "telepites"}.pdf`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
