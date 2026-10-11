import type { Customer, MaintenanceOrigin } from "./types";

/** Display classification only: never an access grant or evidence of consent. */
export function maintenanceOriginFromRow(row?: {
  maintenance_origin?: string | null;
  maintenance_source_name?: string | null;
} | null): Pick<Customer, "maintenanceOrigin" | "maintenanceSourceName"> {
  const maintenanceOrigin: MaintenanceOrigin = row?.maintenance_origin === "external" ? "external" : "own";
  return {
    maintenanceOrigin,
    maintenanceSourceName: maintenanceOrigin === "external" ? row?.maintenance_source_name?.trim() || undefined : undefined,
  };
}

export function maintenanceOriginPayload(origin: MaintenanceOrigin, sourceName: string) {
  if (origin !== "own" && origin !== "external") throw new Error("Válassz érvényes besorolást.");
  const source = origin === "external" ? sourceName.trim() : "";
  if (source.length > 160) throw new Error("Az átadó neve legfeljebb 160 karakter lehet.");
  if (/[\u0000-\u001f\u007f]/.test(source)) throw new Error("Az átadó nevét egy sorban add meg.");
  return { maintenance_origin: origin, maintenance_source_name: source || null };
}

export function isMissingMaintenanceOriginSchemaError(error: unknown) {
  const value = error as { message?: string; details?: string; code?: string } | null;
  const text = `${value?.message || ""} ${value?.details || ""}`.toLowerCase();
  return (text.includes("maintenance_origin") || text.includes("maintenance_source_name"))
    && (value?.code === "42703" || value?.code === "PGRST204" || text.includes("schema cache") || text.includes("does not exist"));
}
