import { assertContactsOrigin, authorizeContactsWorkspace, contactsApiError, contactsAdmin, readContactsBody } from "@/lib/alinflow/google-contacts-auth";
import { ApiError } from "@/lib/alinflow/server-auth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await readContactsBody(request);
    const scope = await authorizeContactsWorkspace(request, body.workspaceId);
    assertContactsOrigin(request);
    const result = await contactsAdmin().from("google_contacts_connections").update({ status: "paused", updated_at: new Date().toISOString() })
      .eq("workspace_id", scope.workspaceId);
    if (result.error) throw new ApiError("A névjegyfrissítés szüneteltetése nem sikerült.", 503);
    return Response.json({ paused: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return contactsApiError(error); }
}
