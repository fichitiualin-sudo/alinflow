import { ApiError, apiErrorResponse, authorizeCustomerRequest } from "@/lib/alinflow/server-auth";
import { deviceSlots, deviceSlotKey, normalizeDeviceData, type AppointmentDevice } from "@/lib/alinflow/appointment-devices";
import { quoteItemFromRow } from "@/lib/alinflow/products";
import { normalizeHTariffData } from "@/lib/alinflow/h-tariff";
import { buildHTariffPdf } from "@/lib/alinflow/h-tariff-pdf";
import type { WorkPhotoContext } from "@/lib/alinflow/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { client, workspaceId, appointment } = await authorizeCustomerRequest(request, body);
    if (!appointment || appointment.appointment_type !== "installation") throw new ApiError("H tarifás nyomtatvány csak mentett telepítéshez készíthető.");
    if (!appointment.quote_id) throw new ApiError("Előbb mentsd a telepítéshez tartozó készülékeket és ajánlatot.");
    const context: WorkPhotoContext = { workspaceId, customerId: body.customer.id, appointmentId: appointment.id, appointmentType: "installation", workDate: appointment.scheduled_date || "", workTime: appointment.scheduled_time || "" };
    const [saved, devicesResult, quoteResult, itemsResult] = await Promise.all([
      client.from("h_tariff_requests").select("data").eq("workspace_id", workspaceId).eq("customer_id", context.customerId).eq("appointment_id", context.appointmentId).maybeSingle(),
      client.from("appointment_devices").select("*").eq("workspace_id", workspaceId).eq("customer_id", context.customerId).eq("appointment_id", context.appointmentId).order("product_key").order("unit_number"),
      client.from("quotes").select("id").eq("id", appointment.quote_id).eq("workspace_id", workspaceId).eq("customer_id", context.customerId).maybeSingle(),
      client.from("quote_items").select("*").eq("quote_id", appointment.quote_id).eq("workspace_id", workspaceId),
    ]);
    if (saved.error || devicesResult.error || quoteResult.error || itemsResult.error) throw new ApiError("Az elmentett H tarifás adatok nem érhetők el. Próbáld újra.", 503);
    if (!quoteResult.data) throw new ApiError("A telepítéshez tartozó ajánlat nem érhető el ezen a munkaterületen.", 403);
    if (!saved.data) throw new ApiError("Előbb mentsd el a H tarifás adatokat.");
    const devices: AppointmentDevice[] = (devicesResult.data || []).map((row) => ({ id: row.id, workspaceId: row.workspace_id, customerId: row.customer_id, appointmentId: row.appointment_id, productKey: row.product_key, productName: row.product_name, unitNumber: row.unit_number, data: normalizeDeviceData(row.data) }));
    const slots = deviceSlots((itemsResult.data || []).map(quoteItemFromRow));
    const expected = body.expectedDeviceSlots;
    if (!Array.isArray(expected) || expected.length !== slots.length || expected.some((value) => typeof value !== "string")
      || JSON.stringify([...expected].sort()) !== JSON.stringify(slots.map(deviceSlotKey).sort())) {
      throw new ApiError("A telepítés készüléklistája eltér a mentett ajánlattól. Mentsd a munkát, majd frissítsd a H tarifás adatokat.", 409);
    }
    const selected = slots.map((slot) => devices.find((device) => deviceSlotKey(device) === deviceSlotKey(slot)));
    if (!slots.length || selected.some((device) => !device)) throw new ApiError("Nem minden telepített készülék adatai vannak elmentve. Frissítsd és egészítsd ki a készülékadatokat.", 409);
    const pdf = await buildHTariffPdf(normalizeHTariffData(saved.data.data), selected as AppointmentDevice[], context);
    return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="H-tarifa.pdf"', "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
