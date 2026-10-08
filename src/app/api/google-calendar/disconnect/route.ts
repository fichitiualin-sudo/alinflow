import { assertCalendarOrigin, authorizeCalendarWorkspace, calendarApiError, googleCalendarAdmin, readCalendarBody } from "@/lib/alinflow/google-calendar-auth";
import { ApiError } from "@/lib/alinflow/server-auth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await readCalendarBody(request);
    const scope = await authorizeCalendarWorkspace(request, body.workspaceId, true);
    assertCalendarOrigin(request);
    const result = await googleCalendarAdmin().from("google_calendar_connections").update({ status: "paused", updated_at: new Date().toISOString() })
      .eq("workspace_id", scope.workspaceId);
    if (result.error) throw new ApiError("A szinkronizálás szüneteltetése nem sikerült.", 503);
    return Response.json({ paused: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return calendarApiError(error); }
}
