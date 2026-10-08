// Server-only credentials: never import this module from a client component.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./server-auth";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
export const CALENDAR_OAUTH_COOKIE = "__Host-alinflow-calendar-oauth";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getCalendarConfig() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "";
  const key = process.env.GOOGLE_CALENDAR_TOKEN_KEY || "";
  const configuredUrl = process.env.GOOGLE_CALENDAR_APP_URL || "";
  let appUrl: string;
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    appUrl = url.origin;
  } catch { throw new ApiError("A Google Naptár-kapcsolat előkészítése még nem fejeződött be.", 503); }
  const encryptionKey = Buffer.from(key, "base64");
  if (!clientId || !clientSecret || encryptionKey.length !== 32 || encryptionKey.toString("base64") !== key
      || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ApiError("A Google Naptár-kapcsolat előkészítése még nem fejeződött be.", 503);
  }
  return { appUrl, clientId, clientSecret, encryptionKey };
}

export function googleCalendarConfigured() {
  try { getCalendarConfig(); return true; } catch { return false; }
}

export function googleCalendarAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError("A Google Naptár-kapcsolat előkészítése még nem fejeződött be.", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function authorizeCalendarWorkspace(request: Request, workspaceId: unknown, ownerOnly = false) {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) throw new ApiError("A művelethez jelentkezz be.", 401);
  if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) throw new ApiError("Hiányzik vagy hibás a munkaterület.", 400);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError("A kapcsolat előkészítése még nem fejeződött be.", 503);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new ApiError("A bejelentkezés lejárt.", 401);
  const id = workspaceId.toLowerCase();
  const member = await client.from("workspace_members").select("role").eq("workspace_id", id)
    .eq("user_id", data.user.id).eq("active", true).maybeSingle();
  const workspace = await client.from("workspaces").select("id").eq("id", id).eq("active", true).maybeSingle();
  if (member.error || !member.data || workspace.error || !workspace.data) throw new ApiError("Nincs hozzáférés ehhez a munkaterülethez.", 403);
  const canManage = ["owner", "admin"].includes(member.data.role);
  if (ownerOnly && !canManage) throw new ApiError("A naptárkapcsolatot a munkaterület tulajdonosa kezelheti.", 403);
  return { workspaceId: id, userId: data.user.id, canManage };
}

export function calendarHash(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function encryptCalendarToken(value: string, context: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getCalendarConfig().encryptionKey, nonce);
  cipher.setAAD(Buffer.from(`alinflow-google-calendar:${context}`));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptCalendarToken(value: string, context: string) {
  try {
    const [version, nonce, tag, ciphertext, extra] = value.split(".");
    if (version !== "v1" || extra !== undefined || !nonce || !tag || !ciphertext) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", getCalendarConfig().encryptionKey, Buffer.from(nonce, "base64url"));
    decipher.setAAD(Buffer.from(`alinflow-google-calendar:${context}`));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new ApiError("A naptárkapcsolat hitelesítése nem olvasható. Kapcsold össze újra a Google-fiókot.", 503); }
}

export function calendarStateMatches(state: string | null, cookieHeader: string | null) {
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return false;
  const cookie = (cookieHeader || "").split(";").map(part => part.trim())
    .find(part => part.startsWith(`${CALENDAR_OAUTH_COOKIE}=`))?.slice(CALENDAR_OAUTH_COOKIE.length + 1);
  const expected = calendarHash(state);
  return Boolean(cookie && /^[a-f0-9]{64}$/.test(cookie) && timingSafeEqual(Buffer.from(cookie), Buffer.from(expected)));
}

export function calendarOAuthCookie(value: string, maxAge = 600) {
  return `${CALENDAR_OAUTH_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function readCalendarBody(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) throw new ApiError("JSON tartalmú kérés szükséges.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("A kérés üres.", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new ApiError("A kérés túl nagy.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new ApiError("Hibás kérés.", 400); }
}

export function assertCalendarOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== getCalendarConfig().appUrl) throw new ApiError("A naptárkapcsolatot az AlinFlow oldaláról indítsd.", 403);
}

export function calendarApiError(error: unknown) {
  return Response.json({ error: error instanceof ApiError ? error.message : "A naptárkapcsolat művelete nem sikerült. Próbáld újra." },
    { status: error instanceof ApiError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}

export class GoogleCalendarAuthError extends Error {
  constructor() { super("A Google-hozzáférés lejárt vagy vissza lett vonva. Kapcsold össze újra a naptárt."); }
}

const accessTokens = new Map<string, { token: string; expires: number }>();
export async function calendarAccessToken(connection: { workspace_id: string; refresh_token_encrypted: string }): Promise<string> {
  const key = `${connection.workspace_id}:${calendarHash(connection.refresh_token_encrypted)}`;
  const cached = accessTokens.get(key);
  if (cached && cached.expires > Date.now()) return cached.token;
  const config = getCalendarConfig();
  const refreshToken = decryptCalendarToken(connection.refresh_token_encrypted, connection.workspace_id);
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
        client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token",
      }) });
  } catch { throw new ApiError("A Google átmenetileg nem érhető el. A szinkronizálás újra próbálkozik.", 503); }
  const data = await response.json().catch(() => ({}));
  if (data.error === "invalid_grant") throw new GoogleCalendarAuthError();
  if (!response.ok || typeof data.access_token !== "string") throw new ApiError("A Google Naptár hitelesítése átmenetileg nem sikerült.", 503);
  if (accessTokens.size >= 50) accessTokens.delete(accessTokens.keys().next().value!);
  accessTokens.set(key, { token: data.access_token, expires: Date.now() + Math.max(0, Math.min(Number(data.expires_in) || 0, 3600) - 60) * 1000 });
  return data.access_token;
}

export function calendarCronAuthorized(request: Request) {
  const secret = process.env.GOOGLE_CALENDAR_CRON_SECRET || "";
  const actual = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  return secret.length >= 32 && Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
