import { CONTACTS_SCOPE, contactsHash, contactsOAuthCookie, contactsStateMatches, decryptContactsToken,
  encryptContactsToken, getContactsConfig, contactsAdmin } from "@/lib/alinflow/google-contacts-auth";

export const runtime = "nodejs";
export async function GET(request: Request) {
  let appUrl: string;
  try { appUrl = getContactsConfig().appUrl; }
  catch { return new Response("A Google Névjegyek-kapcsolat még nincs előkészítve.", { status: 503 }); }
  let targetWorkspace = "";
  const redirect = (result: string) => new Response(null, { status: 303, headers: {
    Location: `${appUrl}/?googleContacts=${result}${targetWorkspace ? `&googleContactsWorkspace=${encodeURIComponent(targetWorkspace)}` : ""}`, "Set-Cookie": contactsOAuthCookie("", 0),
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  } });
  try {
    const params = new URL(request.url).searchParams;
    const state = params.get("state");
    if (!contactsStateMatches(state, request.headers.get("cookie"))) return redirect("expired");
    const admin = contactsAdmin();
    const consumed = await admin.rpc("consume_google_contacts_oauth_state", { p_state_hash: contactsHash(state!) });
    const pending = Array.isArray(consumed.data) ? consumed.data[0] : consumed.data;
    if (consumed.error || !pending) return redirect("expired");
    targetWorkspace = pending.workspace_id;
    if (params.get("error")) return redirect("denied");
    const code = params.get("code");
    if (!code || code.length > 4096) return redirect("failed");
    // Recheck membership after the external consent round trip.
    const member = await admin.from("workspace_members").select("role").eq("workspace_id", pending.workspace_id)
      .eq("user_id", pending.user_id).eq("active", true).maybeSingle();
    const workspace = await admin.from("workspaces").select("id").eq("id", pending.workspace_id).eq("active", true).maybeSingle();
    if (member.error || !member.data || !["owner", "admin"].includes(member.data.role) || workspace.error || !workspace.data) return redirect("failed");
    const config = getContactsConfig();
    const exchange = await fetch("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code,
        client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: `${appUrl}/api/google-contacts/callback`,
        grant_type: "authorization_code", code_verifier: decryptContactsToken(pending.code_verifier, pending.state_hash),
      }) });
    const tokens = await exchange.json();
    if (!exchange.ok || typeof tokens.access_token !== "string") return redirect("failed");
    if (!String(tokens.scope || "").split(" ").includes(CONTACTS_SCOPE)) return redirect("permissions_missing");
    const identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    const identity = await identityResponse.json();
    if (!identityResponse.ok || !identity.sub || identity.email_verified !== true || typeof identity.email !== "string"
      || identity.email.toLowerCase() !== pending.expected_email) return redirect("wrong_account");
    const stored = await admin.rpc("complete_google_contacts_connection", { p_workspace_id: pending.workspace_id,
      p_user_id: pending.user_id, p_google_subject: identity.sub, p_google_email: identity.email.toLowerCase(),
      p_scope: tokens.scope,
      p_refresh_token_encrypted: typeof tokens.refresh_token === "string" ? encryptContactsToken(tokens.refresh_token, pending.workspace_id) : null,
    });
    return redirect(stored.error || stored.data !== true ? "failed" : "connected");
  } catch { return redirect("failed"); }
}
