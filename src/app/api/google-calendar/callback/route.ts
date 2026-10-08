import { CALENDAR_SCOPE, calendarHash, calendarOAuthCookie, calendarStateMatches, decryptCalendarToken,
  encryptCalendarToken, getCalendarConfig, googleCalendarAdmin } from "@/lib/alinflow/google-calendar-auth";

export const runtime = "nodejs";
export async function GET(request: Request) {
  let appUrl: string;
  try { appUrl = getCalendarConfig().appUrl; }
  catch { return new Response("A Google Naptár-kapcsolat még nincs előkészítve.", { status: 503 }); }
  const redirect = (result: string) => new Response(null, { status: 303, headers: {
    Location: `${appUrl}/?googleCalendar=${result}`, "Set-Cookie": calendarOAuthCookie("", 0),
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
  } });
  try {
    const params = new URL(request.url).searchParams;
    const state = params.get("state");
    if (!calendarStateMatches(state, request.headers.get("cookie"))) return redirect("expired");
    const admin = googleCalendarAdmin();
    const consumed = await admin.rpc("consume_google_calendar_oauth_state", { p_state_hash: calendarHash(state!) });
    const pending = Array.isArray(consumed.data) ? consumed.data[0] : consumed.data;
    if (consumed.error || !pending) return redirect("expired");
    if (params.get("error")) return redirect("denied");
    const code = params.get("code");
    if (!code || code.length > 4096) return redirect("failed");
    // Recheck membership after the external consent round trip.
    const member = await admin.from("workspace_members").select("role").eq("workspace_id", pending.workspace_id)
      .eq("user_id", pending.user_id).eq("active", true).maybeSingle();
    const workspace = await admin.from("workspaces").select("id").eq("id", pending.workspace_id).eq("active", true).maybeSingle();
    if (member.error || !member.data || !["owner", "admin"].includes(member.data.role) || workspace.error || !workspace.data) return redirect("failed");
    const config = getCalendarConfig();
    const exchange = await fetch("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code,
        client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: `${appUrl}/api/google-calendar/callback`,
        grant_type: "authorization_code", code_verifier: decryptCalendarToken(pending.code_verifier, pending.state_hash),
      }) });
    const tokens = await exchange.json();
    if (!exchange.ok || typeof tokens.access_token !== "string" || !String(tokens.scope || "").split(" ").includes(CALENDAR_SCOPE)) return redirect("failed");
    const identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    const identity = await identityResponse.json();
    if (!identityResponse.ok || !identity.sub || identity.email_verified !== true || typeof identity.email !== "string"
      || identity.email.toLowerCase() !== pending.expected_email) return redirect("wrong_account");
    // Validate the primary calendar without reading any existing event details.
    const calendarCheck = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(identity.email.toLowerCase())}/events?maxResults=1&fields=accessRole`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    const calendar = await calendarCheck.json();
    if (!calendarCheck.ok || calendar.accessRole !== "owner") return redirect("failed");
    // The database locks the workspace and preserves its original sync cutoff.
    // A concurrent consent cannot silently retarget already managed events.
    const stored = await admin.rpc("complete_google_calendar_connection", { p_workspace_id: pending.workspace_id,
      p_user_id: pending.user_id, p_google_subject: identity.sub, p_google_email: identity.email.toLowerCase(),
      p_calendar_id: identity.email.toLowerCase(), p_scope: tokens.scope,
      p_refresh_token_encrypted: typeof tokens.refresh_token === "string" ? encryptCalendarToken(tokens.refresh_token, pending.workspace_id) : null,
    });
    return redirect(stored.error || stored.data !== true ? "failed" : "connected");
  } catch { return redirect("failed"); }
}
