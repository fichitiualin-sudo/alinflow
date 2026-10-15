import { randomBytes, createHash } from "node:crypto";
import { ApiError } from "@/lib/alinflow/server-auth";
import { authorizeContactsWorkspace, assertContactsOrigin, contactsApiError, contactsHash, contactsOAuthCookie,
  CONTACTS_SCOPE, encryptContactsToken, getContactsConfig, contactsAdmin, readContactsBody } from "@/lib/alinflow/google-contacts-auth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await readContactsBody(request);
    const scope = await authorizeContactsWorkspace(request, body.workspaceId);
    const config = getContactsConfig();
    assertContactsOrigin(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ApiError("Add meg a kapcsolni kívánt Google-fiók email-címét.");
    const admin = contactsAdmin();
    const existing = await admin.from("google_contacts_connections").select("google_email").eq("workspace_id", scope.workspaceId).maybeSingle();
    if (existing.error) throw new ApiError("A névjegykapcsolat előkészítése még nem fejeződött be.", 503);
    if (existing.data && existing.data.google_email.toLowerCase() !== email) throw new ApiError("Ehhez a munkaterülethez már másik Google-fiók tartozik. Az újrakapcsoláshoz ugyanazt a fiókot használd.", 409);
    const state = randomBytes(32).toString("base64url");
    const hash = contactsHash(state);
    const verifier = randomBytes(32).toString("base64url");
    const now = Date.now();
    await admin.from("google_contacts_oauth_states").delete().lt("expires_at", new Date(now).toISOString());
    const stored = await admin.from("google_contacts_oauth_states").insert({ state_hash: hash, workspace_id: scope.workspaceId,
      user_id: scope.userId, expected_email: email, code_verifier: encryptContactsToken(verifier, hash), expires_at: new Date(now + 600000).toISOString() });
    if (stored.error) throw new ApiError("A Google-kapcsolat nem indítható. Próbáld újra.", 503);
    const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${config.appUrl}/api/google-contacts/callback`,
      response_type: "code", scope: `openid email ${CONTACTS_SCOPE}`, access_type: "offline", prompt: "consent", login_hint: email,
      state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
    return Response.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` },
      { headers: { "Cache-Control": "no-store", "Set-Cookie": contactsOAuthCookie(hash) } });
  } catch (error) { return contactsApiError(error); }
}
