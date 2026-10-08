import { authorizeCalendarWorkspace, calendarApiError, googleCalendarConfigured, readCalendarBody } from "@/lib/alinflow/google-calendar-auth";
import { runGoogleCalendarSync } from "@/lib/alinflow/google-calendar-sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const body = await readCalendarBody(request);
    const scope = await authorizeCalendarWorkspace(request, body.workspaceId);
    if (!googleCalendarConfigured()) return Response.json({ processed: 0, synced: 0, failed: 0 }, { headers: { "Cache-Control": "no-store" } });
    return Response.json(await runGoogleCalendarSync(scope.workspaceId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return calendarApiError(error); }
}
