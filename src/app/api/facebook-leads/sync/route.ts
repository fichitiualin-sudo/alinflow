import { authorizeFacebookWorkspace } from "@/lib/alinflow/facebook-leads-auth";
import { facebookApiError, parseFacebookBody, readFacebookBody, syncFacebookLeads } from "@/lib/alinflow/facebook-leads-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = parseFacebookBody(await readFacebookBody(request, 8192));
    const scope = await authorizeFacebookWorkspace(request, body.workspaceId);
    return Response.json(await syncFacebookLeads(scope.workspaceId, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return facebookApiError(error); }
}
