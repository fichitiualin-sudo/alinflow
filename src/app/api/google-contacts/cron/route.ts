import { contactsApiError, contactsCronAuthorized, googleContactsConfigured } from "@/lib/alinflow/google-contacts-auth";
import { runGoogleContactsSync } from "@/lib/alinflow/google-contacts-sync";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!contactsCronAuthorized(request)) return Response.json({ error: "Nincs jogosultság." }, { status: 401 });
  try {
    if (!googleContactsConfigured()) return Response.json({ configured: false }, { status: 503 });
    return Response.json(await runGoogleContactsSync(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return contactsApiError(error); }
}
