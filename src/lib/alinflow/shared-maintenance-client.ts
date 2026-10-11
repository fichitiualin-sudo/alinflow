"use client";

import { supabase } from "@/lib/supabase";
import type { MaintenanceAccessGrant, SharedMaintenanceInstallation, SharedMaintenanceResult } from "./shared-maintenance";

async function call<T>(name: string, parameters: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
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
export const acceptMaintenanceOrder = (item: SharedMaintenanceInstallation) => call<{customerId: string; installationId: string; created: boolean}>("accept_shared_maintenance_order", {
  p_grant_id: item.grantId, p_installation_id: item.installationId, p_customer_order_confirmed: true,
});
