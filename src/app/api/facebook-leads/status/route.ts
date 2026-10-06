import { authorizeFacebookWorkspace } from "@/lib/alinflow/facebook-leads-auth";
import { facebookApiError, facebookLeadStatus, parseFacebookBody, readFacebookBody } from "@/lib/alinflow/facebook-leads-server";

export const runtime = "nodejs";

async function status(request: Request, workspaceId: unknown) {
  const scope = await authorizeFacebookWorkspace(request, workspaceId);
  return Response.json(facebookLeadStatus(scope.workspaceId), { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  try { return await status(request, new URL(request.url).searchParams.get("workspaceId")); }
  catch (error) { return facebookApiError(error); }
}

export async function POST(request: Request) {
  try { return await status(request, parseFacebookBody(await readFacebookBody(request, 4096)).workspaceId); }
  catch (error) { return facebookApiError(error); }
}
