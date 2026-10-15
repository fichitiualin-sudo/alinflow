import { assertContactsOrigin, authorizeContactsWorkspace, contactsApiError, googleContactsConfigured, readContactsBody } from "@/lib/alinflow/google-contacts-auth";
import { runGoogleContactsSync } from "@/lib/alinflow/google-contacts-sync";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    assertContactsOrigin(request);
    const body = await readContactsBody(request);
    const scope = await authorizeContactsWorkspace(request, body.workspaceId);
    if (!googleContactsConfigured()) return Response.json({ error: "A névjegykapcsolat még nincs bekapcsolva." }, { status: 503 });
    return Response.json(await runGoogleContactsSync(scope.workspaceId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return contactsApiError(error); }
}
