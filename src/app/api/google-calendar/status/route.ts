import { authorizeCalendarWorkspace, calendarApiError, googleCalendarAdmin, googleCalendarConfigured } from "@/lib/alinflow/google-calendar-auth";
import { ApiError } from "@/lib/alinflow/server-auth";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const scope = await authorizeCalendarWorkspace(request, new URL(request.url).searchParams.get("workspaceId"));
    const configured = googleCalendarConfigured();
    const empty = { configured, connected: false, status: "not_connected", pending: 0, managedAppointmentIds: [], canManage: scope.canManage };
    if (!configured) return Response.json(empty, { headers: { "Cache-Control": "no-store" } });
    const admin = googleCalendarAdmin();
    const connection = await admin.from("google_calendar_connections").select("status,google_email,sync_from,last_error")
      .eq("workspace_id", scope.workspaceId).maybeSingle();
    if (connection.error) throw new ApiError("A naptárkapcsolat állapota nem tölthető be.", 503);
    if (!connection.data) return Response.json(empty, { headers: { "Cache-Control": "no-store" } });
    const queue = await admin.rpc("google_calendar_sync_status", { p_workspace_id: scope.workspaceId });
    if (queue.error) throw new ApiError("A naptárszinkron állapota nem tölthető be.", 503);
    const state = queue.data || {};
    return Response.json({ ...empty, status: connection.data.status, connected: connection.data.status === "connected",
      email: connection.data.google_email, calendarName: "Elsődleges Google Naptár", syncFrom: connection.data.sync_from,
      pending: Number(state.pending_count) || 0, managedAppointmentIds: state.managed_appointment_ids || [],
      lastError: connection.data.last_error || state.last_error || undefined,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return calendarApiError(error); }
}
