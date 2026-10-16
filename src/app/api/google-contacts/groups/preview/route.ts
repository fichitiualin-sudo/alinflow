import { assertContactsOrigin, authorizeContactsWorkspace, contactsApiError, googleContactsConfigured, readContactsBody } from "@/lib/alinflow/google-contacts-auth";
import { previewGoogleContactGroups } from "@/lib/alinflow/google-contacts-sync";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    assertContactsOrigin(request);
    const body = await readContactsBody(request);
    const scope = await authorizeContactsWorkspace(request, body.workspaceId);
    if (!googleContactsConfigured()) return Response.json({ error: "A névjegykapcsolat még nincs bekapcsolva." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return Response.json(await previewGoogleContactGroups(scope.workspaceId, scope.userId, body.groups), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return contactsApiError(error); }
}
