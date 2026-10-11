import type { Customer } from "./types";
import type { MaintenanceMapPoint } from "./maintenance-map";

export type MaintenanceGeocodeTarget = {
  appointmentId: string; address: string; expectedAddress: string; appointmentUpdatedAt: string;
};

/** Capture immutable request inputs; a shared display-only row is never writable. */
export function maintenanceGeocodeTarget(point: MaintenanceMapPoint): MaintenanceGeocodeTarget | null {
  const version = point.customer.appointmentUpdatedAt;
  if (point.sharedMaintenance || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(point.appointmentId)
    || !point.address || !version || !Number.isFinite(Date.parse(version))) return null;
  return { appointmentId: point.appointmentId, address: point.address,
    expectedAddress: (point.customer.workAddress || point.customer.address || "").trim(), appointmentUpdatedAt: version };
}

function coordinate(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

export function maintenanceGeocodeParameters(workspaceId: string, target: MaintenanceGeocodeTarget, result: unknown) {
  const value = result as Record<string, unknown> | null;
  if (!value || value.appointmentId !== target.appointmentId || !["ok", "failed"].includes(String(value.status))) return null;
  const success = value.status === "ok";
  if (success && (!coordinate(value.latitude, 90) || !coordinate(value.longitude, 180))) return null;
  return { p_workspace_id: workspaceId, p_appointment_id: target.appointmentId,
    p_expected_appointment_updated_at: target.appointmentUpdatedAt, p_expected_address: target.expectedAddress,
    p_latitude: success ? value.latitude as number : null, p_longitude: success ? value.longitude as number : null,
    p_status: success ? "ok" : "failed", p_error: success ? null : String(value.error || "Nincs találat a címre.").slice(0, 500) };
}

/** Only an acknowledged DB value changes the displayed coordinates and version. */
export function maintenanceGeocodePatch(saved: unknown): Partial<Customer> | null {
  const value = saved as Record<string, unknown> | null;
  if (!value || !["ok", "failed"].includes(String(value.geocodeStatus)) || typeof value.geocodedAt !== "string"
    || !Number.isFinite(Date.parse(value.geocodedAt)) || typeof value.updatedAt !== "string"
    || !Number.isFinite(Date.parse(value.updatedAt))) return null;
  const success = value.geocodeStatus === "ok";
  if (success && (!coordinate(value.latitude, 90) || !coordinate(value.longitude, 180))) return null;
  return { mapLatitude: success ? value.latitude as number : undefined, mapLongitude: success ? value.longitude as number : undefined,
    mapGeocodedAt: value.geocodedAt, mapGeocodeStatus: success ? "ok" : "failed",
    mapGeocodeError: success ? undefined : String(value.geocodeError || "Nincs találat a címre."), appointmentUpdatedAt: value.updatedAt };
}
