"use client";

import { supabase } from "@/lib/supabase";
import type { MaintenanceAccessGrant, SharedMaintenanceInstallation, SharedMaintenanceResult, SharedMaintenanceOptOut } from "./shared-maintenance";
import { isMaintenanceContactPreference, isMaintenanceDeviceSelectionList, preferenceDeclinesDevice, type MaintenanceContactChoice, type MaintenanceContactPreference } from "./maintenance-contact-choice";
import type { MaintenanceDeviceSelection } from "./types";
import type { SharedMaintenanceSchedule } from "./maintenance-scheduled-map";

async function call<T>(name: string, parameters: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    if (error.code === "40001") throw new Error("A karbantartási jelölés közben megváltozott. Frissítsd a listát, és ellenőrizd az új választást.");
    if (error.code === "PGRST202" || error.code === "42883") throw new Error("A karbantartói megosztás még nincs bekapcsolva ezen a szerveren.");
    if (error.code === "22023") {
      if (error.message.includes("karbantartó adatkezelési tájékoztatóját")) throw new Error("A karbantartó saját munkaterületén előbb ki kell tölteni és be kell kapcsolni az adatkezelési tájékoztatót.");
      if (error.message.includes("megállapodás hivatkozását")) throw new Error("Add meg az aláírt adatfeldolgozási megállapodás dátumát vagy azonosítóját.");
    }
    throw new Error(error.code === "42501" ? "Ehhez a karbantartói művelethez nincs aktív jogosultságod." : "A karbantartói művelet nem sikerült. Frissítsd a listát, és próbáld újra.");
  }
  return data as T;
}
export const listMaintenanceGrants = (workspaceId: string) => call<MaintenanceAccessGrant[]>("list_shared_maintenance_grants", { p_source_workspace_id: workspaceId });
export const grantMaintenanceAccess = (workspaceId: string, partnerUserId: string, partnerWorkspaceId: string, agreementReference: string) =>
  call<MaintenanceAccessGrant>("grant_shared_maintenance_access", { p_source_workspace_id: workspaceId, p_target_user_id: partnerUserId,
    p_target_workspace_id: partnerWorkspaceId, p_agreement_reference: agreementReference.trim() });
export const revokeMaintenanceAccess = (grantId: string) => call<MaintenanceAccessGrant>("revoke_shared_maintenance_access", { p_grant_id: grantId });
export const listReceivedMaintenance = (workspaceId: string) => call<SharedMaintenanceInstallation[]>("list_received_maintenance_installations", { p_target_workspace_id: workspaceId });
export const listMaintenanceResults = (workspaceId: string) => call<SharedMaintenanceResult[]>("list_shared_maintenance_results", { p_source_workspace_id: workspaceId });
export function isSharedMaintenanceSchedule(value: unknown): value is SharedMaintenanceSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (![row.installationId, row.sourceWorkspaceId, row.sourceInstallationId, row.maintenanceAppointmentId]
    .every(id => typeof id === "string" && uuid.test(id))) return false;
  if (typeof row.date !== "string" || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(row.date)) return false;
  const date = new Date(`${row.date}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.date) return false;
  return typeof row.time === "string" && /^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$/.test(row.time)
    && isMaintenanceDeviceSelectionList(row.selectedDevices) && row.selectedDevices.length > 0
    && (row.providerName === undefined || (typeof row.providerName === "string" && row.providerName.trim().length > 0));
}
export async function listMaintenanceSchedules(workspaceId: string) {
  const { data, error } = await supabase.rpc("list_shared_maintenance_schedules", { p_workspace_id: workspaceId });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") throw new Error("A megosztott egyeztetett időpontok megjelenítése még nincs bekapcsolva ezen a szerveren.");
    throw new Error(error.code === "42501" ? "A megosztott egyeztetett időpontokhoz nincs aktív jogosultságod."
      : "A megosztott egyeztetett időpontok betöltése nem sikerült. Frissítsd a listát.");
  }
  if (!Array.isArray(data) || !data.every(isSharedMaintenanceSchedule)) throw new Error("A megosztott egyeztetett időpontok válasza nem olvasható.");
  return data as SharedMaintenanceSchedule[];
}
export async function listMaintenanceContactPreferences(workspaceId: string) {
  const rows = await call<MaintenanceContactPreference[]>("list_maintenance_contact_preferences", { p_workspace_id: workspaceId });
  if (!Array.isArray(rows) || !rows.every(isMaintenanceContactPreference)) throw new Error("A karbantartási jelölések válasza nem olvasható.");
  return rows;
}
export async function setMaintenanceContactPreference(workspaceId: string, installationId: string, choice: MaintenanceContactChoice,
  expectedUpdatedAt: string | null, grantId?: string) {
  const saved = await call<MaintenanceContactPreference>("set_maintenance_contact_preference", {
    p_workspace_id: workspaceId, p_installation_id: installationId, p_choice: choice,
    p_expected_updated_at: expectedUpdatedAt, p_grant_id: grantId || null,
  });
  if (!isMaintenanceContactPreference(saved) || saved.choice !== choice
    || (grantId ? saved.sourceInstallationId !== installationId || saved.isSource : saved.installationId !== installationId)) {
    throw new Error("A karbantartási jelölés mentése nem igazolható. Frissítsd a listát.");
  }
  return saved;
}
export async function setSharedMaintenanceOptOut(item: SharedMaintenanceInstallation, checked: boolean) {
  const saved = await call<SharedMaintenanceOptOut>("set_shared_maintenance_opt_out", {
    p_grant_id: item.grantId, p_installation_id: item.installationId, p_opt_out: checked,
  });
  if (!saved || saved.maintenanceOptOut !== checked
    || !(saved.maintenanceOptOutAt === null || typeof saved.maintenanceOptOutAt === "string")
    || !(saved.targetInstallationId === null || typeof saved.targetInstallationId === "string")) {
    throw new Error("A karbantartási jelölés mentése nem igazolható. Frissítsd a listát.");
  }
  return saved;
}
export async function setMaintenanceDevicePreference(workspaceId: string, installationId: string, device: MaintenanceDeviceSelection,
  declined: boolean, expectedUpdatedAt: string | null, grantId?: string) {
  if (!isMaintenanceDeviceSelectionList([device]) || typeof declined !== "boolean") throw new Error("A kiválasztott készülék nem azonosítható. Frissítsd a listát.");
  const saved = await call<MaintenanceContactPreference>("set_maintenance_device_preference", {
    p_workspace_id: workspaceId, p_installation_id: installationId, p_device: device,
    p_declined: declined, p_expected_updated_at: expectedUpdatedAt, p_grant_id: grantId || null,
  });
  if (!isMaintenanceContactPreference(saved) || saved.declinedDevices === undefined
    || preferenceDeclinesDevice(saved, device) !== declined
    || (grantId ? saved.sourceInstallationId !== installationId || saved.isSource : saved.installationId !== installationId)) {
    throw new Error("A készülék karbantartási jelölésének mentése nem igazolható. Frissítsd a listát.");
  }
  return saved;
}
export const acceptMaintenanceOrder = (item: SharedMaintenanceInstallation) => call<{customerId: string; installationId: string; created: boolean}>("accept_shared_maintenance_order", {
  p_grant_id: item.grantId, p_installation_id: item.installationId, p_customer_order_confirmed: true,
});
