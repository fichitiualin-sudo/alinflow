import { facebookApiError, facebookWebhookChallenge, parseFacebookBody, readFacebookBody, receiveFacebookLeads, verifyFacebookWebhook } from "@/lib/alinflow/facebook-leads-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export function GET(request: Request) {
  try { return facebookWebhookChallenge(request); }
  catch (error) { return facebookApiError(error); }
}

export async function POST(request: Request) {
  try {
    const raw = await readFacebookBody(request);
    verifyFacebookWebhook(raw, request.headers.get("x-hub-signature-256"));
    const result = await receiveFacebookLeads(parseFacebookBody(raw));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return facebookApiError(error); }
}
