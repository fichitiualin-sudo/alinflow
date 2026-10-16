import { countGoogleContactsRepresentedCustomers } from "@/lib/alinflow/google-contacts-sync";
import { authorizeContactsWorkspace, contactsApiError, contactsAdmin, googleContactsConfigured, readContactsBody } from "@/lib/alinflow/google-contacts-auth";
import { ApiError } from "@/lib/alinflow/server-auth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await readContactsBody(request);
    const scope = await authorizeContactsWorkspace(request, body.workspaceId);
    const configured = googleContactsConfigured();
    const empty = { configured, canManage: true, connected: false, email: "", status: null, linkedCount: 0, coveredCustomerCount: 0, pendingCount: 0, errorCount: 0, lastSyncedAt: null, lastError: null };
    if (!configured) return Response.json(empty, { headers: { "Cache-Control": "no-store" } });
    const admin = contactsAdmin();
    const connection = await admin.from("google_contacts_connections").select("status,google_email,last_synced_at,last_error")
      .eq("workspace_id", scope.workspaceId).maybeSingle();
    if (connection.error) throw new ApiError("A névjegykapcsolat állapota nem tölthető be.", 503);
    if (!connection.data) return Response.json(empty, { headers: { "Cache-Control": "no-store" } });
    const [linked, pending, errors] = await Promise.all([
      admin.from("google_contacts_links").select("customer_id", { count: "exact", head: true }).eq("workspace_id", scope.workspaceId),
      admin.from("google_contacts_links").select("customer_id", { count: "exact", head: true }).eq("workspace_id", scope.workspaceId).in("state", ["pending", "creating"]),
      admin.from("google_contacts_links").select("customer_id", { count: "exact", head: true }).eq("workspace_id", scope.workspaceId).in("state", ["uncertain", "review"]),
    ]);
    if (linked.error || pending.error || errors.error) throw new ApiError("A névjegyfrissítés állapota nem tölthető be.", 503);
    return Response.json({ ...empty, connected: connection.data.status === "active", email: connection.data.google_email, status: connection.data.status,
      linkedCount: linked.count || 0, coveredCustomerCount: await countGoogleContactsRepresentedCustomers(scope.workspaceId, linked.count || 0), pendingCount: pending.count || 0, errorCount: errors.count || 0,
      lastSyncedAt: connection.data.last_synced_at, lastError: connection.data.last_error,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return contactsApiError(error); }
}
