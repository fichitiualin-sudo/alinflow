import { calendarApiError, calendarCronAuthorized, googleCalendarConfigured } from "@/lib/alinflow/google-calendar-auth";
import { runGoogleCalendarSync } from "@/lib/alinflow/google-calendar-sync";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!calendarCronAuthorized(request)) return Response.json({ error: "Nincs jogosultság." }, { status: 401 });
  try {
    if (!googleCalendarConfigured()) return Response.json({ configured: false }, { status: 503 });
    return Response.json(await runGoogleCalendarSync(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return calendarApiError(error); }
}
