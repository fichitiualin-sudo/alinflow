// Server-only Google Contacts credentials. OAuth storage is separate from Calendar.
import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./server-auth";
import { authorizeCalendarWorkspace, calendarHash, calendarCronAuthorized, decryptCalendarToken, encryptCalendarToken,
  getCalendarConfig, googleCalendarAdmin, readCalendarBody } from "./google-calendar-auth";

export const CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts";
export const CONTACTS_OAUTH_COOKIE = "__Host-alinflow-contacts-oauth";
export const contactsHash = calendarHash;
export const contactsAdmin = googleCalendarAdmin;
export const readContactsBody = readCalendarBody;
export const contactsCronAuthorized = calendarCronAuthorized;

export function getContactsConfig() {
  if (process.env.GOOGLE_CONTACTS_ENABLED !== "true") throw new ApiError("A Google Névjegyek összekapcsolása még nincs bekapcsolva.", 503);
  try { return getCalendarConfig(); }
  catch { throw new ApiError("A névjegykapcsolat előkészítése még nem fejeződött be.", 503); }
}
export function googleContactsConfigured() { try { getContactsConfig(); return true; } catch { return false; } }
export async function authorizeContactsWorkspace(request: Request, workspaceId: unknown) {
  const scope = await authorizeCalendarWorkspace(request, workspaceId);
  if (!scope.canManage) throw new ApiError("A névjegykapcsolatot a munkaterület tulajdonosa vagy adminisztrátora kezelheti.", 403);
  return scope;
}
export function encryptContactsToken(value: string, context: string) { return encryptCalendarToken(value, `contacts:${context}`); }
export function decryptContactsToken(value: string, context: string) {
  try { return decryptCalendarToken(value, `contacts:${context}`); }
  catch { throw new GoogleContactsAuthError(); }
}
export function contactsStateMatches(state: string | null, cookieHeader: string | null) {
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return false;
  const cookie = (cookieHeader || "").split(";").map(part => part.trim())
    .find(part => part.startsWith(`${CONTACTS_OAUTH_COOKIE}=`))?.slice(CONTACTS_OAUTH_COOKIE.length + 1);
  const expected = contactsHash(state);
  return Boolean(cookie && /^[a-f0-9]{64}$/.test(cookie) && timingSafeEqual(Buffer.from(cookie), Buffer.from(expected)));
}
export function contactsOAuthCookie(value: string, maxAge = 600) {
  return `${CONTACTS_OAUTH_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
export function assertContactsOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== getContactsConfig().appUrl) throw new ApiError("A névjegykapcsolatot az AlinFlow oldaláról indítsd.", 403);
}
export function contactsApiError(error: unknown) {
  return Response.json({ error: error instanceof ApiError || error instanceof GoogleContactsAuthError ? error.message : "A névjegykapcsolat művelete nem sikerült. Próbáld újra." },
    { status: error instanceof ApiError ? error.status : error instanceof GoogleContactsAuthError ? 409 : 500, headers: { "Cache-Control": "no-store" } });
}
export class GoogleContactsAuthError extends Error {
  constructor() { super("A Google-névjegyek hozzáférése lejárt vagy vissza lett vonva. Kapcsold össze újra a fiókot."); }
}
const accessTokens = new Map<string, { token: string; expires: number }>();
export async function contactsAccessToken(connection: { workspace_id: string; refresh_token_encrypted: string }): Promise<string> {
  const config = getContactsConfig();
  const key = `${connection.workspace_id}:${contactsHash(connection.refresh_token_encrypted)}`;
  const cached = accessTokens.get(key);
  if (cached && cached.expires > Date.now()) return cached.token;
  const refreshToken = decryptContactsToken(connection.refresh_token_encrypted, connection.workspace_id);
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
        client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token",
      }) });
  } catch { throw new ApiError("A Google átmenetileg nem érhető el. A névjegyek frissítése később újrapróbálható.", 503); }
  const data = await response.json().catch(() => ({}));
  if (data.error === "invalid_grant") throw new GoogleContactsAuthError();
  if (!response.ok || typeof data.access_token !== "string") throw new ApiError("A Google-névjegyek hitelesítése átmenetileg nem sikerült.", 503);
  if (typeof data.scope === "string" && !data.scope.split(" ").includes(CONTACTS_SCOPE)) throw new GoogleContactsAuthError();
  if (accessTokens.size >= 50) accessTokens.delete(accessTokens.keys().next().value!);
  accessTokens.set(key, { token: data.access_token, expires: Date.now() + Math.max(0, Math.min(Number(data.expires_in) || 0, 3600) - 60) * 1000 });
  return data.access_token;
}
