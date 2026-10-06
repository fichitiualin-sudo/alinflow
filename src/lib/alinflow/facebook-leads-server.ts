// Server module: Node crypto and credentials must never enter a client bundle.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./server-auth";
import {
  isFacebookId, normalizeFacebookLead, parseFacebookLeadsConfig, validateFacebookGraphLead,
  type FacebookGraphLead, type FacebookLeadsConfig, type FacebookLeadStatus, type FacebookLeadSyncResult,
} from "./facebook-leads";

const GRAPH_VERSION = "v26.0";
const GRAPH_ORIGIN = "https://graph.facebook.com";
const LEAD_FIELDS = "id,created_time,field_data,form_id,ad_id,ad_name,campaign_id,campaign_name";
const MAX_BATCH = 20;
const REQUEST_BUDGET_MS = 45000;

type ServerSettings = {
  config: FacebookLeadsConfig;
  appSecret: string;
  pageToken: string;
  supabaseUrl: string;
  serviceKey: string;
};
type ImportResult = { status: "created" | "matched" | "review"; duplicate: boolean };

function configuredScope(): FacebookLeadsConfig | null {
  try { return parseFacebookLeadsConfig(JSON.parse(process.env.META_LEADS_CONFIG || "null")); }
  catch { return null; }
}

export function facebookLeadStatus(workspaceId: string): FacebookLeadStatus {
  const config = configuredScope();
  const configured = !!config && config.workspaceId === workspaceId;
  const ready = configured && !!process.env.META_APP_SECRET && !!process.env.META_WEBHOOK_VERIFY_TOKEN &&
    !!process.env.META_PAGE_ACCESS_TOKEN && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  return {
    configured, ready,
    message: ready ? "A beolvasás szerverbeállításai megvannak. Az automatikus érkezéshez a Meta-feliratkozásnak is működnie kell."
      : configured ? "A Facebook-kapcsolat szerverbeállítása még hiányos."
      : "Ehhez a munkaterülethez még nincs beállítva Facebook-kapcsolat.",
    climateNames: configured && config ? [...new Set(Object.values(config.adClimateMap))] : [],
  };
}

function settings(workspaceId?: string): ServerSettings {
  const config = configuredScope();
  if (!config || (workspaceId !== undefined && workspaceId !== config.workspaceId)) {
    throw new ApiError("Ehhez a munkaterülethez nincs beállítva Facebook-kapcsolat.", 503);
  }
  if (!facebookLeadStatus(config.workspaceId).ready) throw new ApiError("A Facebook-kapcsolat szerverbeállítása még hiányos.", 503);
  return {
    config, appSecret: process.env.META_APP_SECRET!, pageToken: process.env.META_PAGE_ACCESS_TOKEN!,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  };
}

export function facebookApiError(error: unknown) {
  return Response.json({ ok: false, error: error instanceof ApiError ? error.message : "A Facebook-beolvasás nem sikerült. Próbáld újra." },
    { status: error instanceof ApiError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}

export async function readFacebookBody(request: Request, maximum = 256 * 1024): Promise<Buffer> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new ApiError("JSON tartalmú kérés szükséges.", 415);
  }
  const declared = Number(request.headers.get("content-length"));
  if (declared > maximum) throw new ApiError("A kérés túl nagy.", 413);
  if (!request.body) throw new ApiError("A kérés üres.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const timeout = AbortSignal.timeout(10000);
  let onTimeout: () => void = () => {};
  const expired = new Promise<never>((_resolve, reject) => {
    onTimeout = () => reject(new ApiError("A kérés olvasása túl sokáig tartott.", 408));
    if (timeout.aborted) onTimeout();
    else timeout.addEventListener("abort", onTimeout, { once: true });
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), expired]);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        throw new ApiError("A kérés túl nagy.", 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    timeout.removeEventListener("abort", onTimeout);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export function parseFacebookBody(raw: Buffer): Record<string, unknown> {
  try {
    const body: unknown = JSON.parse(raw.toString("utf8"));
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch { /* Return only our own diagnostic, never provider content. */ }
  throw new ApiError("Hibás JSON kérés.", 400);
}

export function verifyFacebookWebhook(raw: Buffer, signature: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new ApiError("A Facebook-kapcsolat szerverbeállítása még hiányos.", 503);
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) throw new ApiError("Érvénytelen aláírás.", 403);
  const expected = createHmac("sha256", secret).update(raw).digest();
  const supplied = Buffer.from(signature.slice(7), "hex");
  if (!timingSafeEqual(expected, supplied)) throw new ApiError("Érvénytelen aláírás.", 403);
}

export function facebookWebhookChallenge(request: Request) {
  const token = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!token) throw new ApiError("A Facebook-kapcsolat szerverbeállítása még hiányos.", 503);
  const params = new URL(request.url).searchParams;
  const supplied = params.get("hub.verify_token") || "";
  const challenge = params.get("hub.challenge");
  const expectedHash = createHmac("sha256", token).update(token).digest();
  const suppliedHash = createHmac("sha256", token).update(supplied).digest();
  if (params.get("hub.mode") !== "subscribe" || !challenge || challenge.length > 1000 ||
      !timingSafeEqual(expectedHash, suppliedHash)) throw new ApiError("Érvénytelen ellenőrzési kérés.", 403);
  return new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

function remaining(deadline: number) {
  const ms = deadline - Date.now();
  if (ms <= 0) throw new ApiError("A Facebook-beolvasás időkorlátba ütközött. Próbáld újra.", 503);
  return ms;
}

async function readGraphResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const maximum = 2 * 1024 * 1024;
  if (!response.body || Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel().catch(() => {});
    throw new ApiError("A Meta válasza üres vagy túl nagy.", 502);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new ApiError("A Meta válaszának olvasása időtúllépés miatt megszakadt.", 502));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), cancelled]);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new ApiError("A Meta válasza túl nagy.", 502);
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
    catch { throw new ApiError("A Meta hibás választ adott. Próbáld újra.", 502); }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

async function graph(settings: ServerSettings, path: string, fields: string, deadline: number, extra: Record<string, string> = {}) {
  const url = new URL(`/${GRAPH_VERSION}/${path}`, GRAPH_ORIGIN);
  url.searchParams.set("fields", fields);
  url.searchParams.set("appsecret_proof", createHmac("sha256", settings.appSecret).update(settings.pageToken).digest("hex"));
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  try {
    const signal = AbortSignal.timeout(Math.min(10000, remaining(deadline)));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${settings.pageToken}`, Accept: "application/json" },
      cache: "no-store", redirect: "error", signal,
    });
    if (!response.ok) throw new ApiError("A Meta nem engedte a beolvasást, vagy átmenetileg nem érhető el. Ellenőrizd a kapcsolatot, majd próbáld újra.", 502);
    const value = await readGraphResponse(response, signal);
    if (!value || typeof value !== "object" || Array.isArray(value) || "error" in value) {
      throw new ApiError("A Meta hibás választ adott. Próbáld újra.", 502);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("A Meta-kapcsolat megszakadt vagy időtúllépés történt. Próbáld újra.", 502);
  }
}

async function verifyForm(settings: ServerSettings, formId: string, deadline: number) {
  if (!settings.config.formIds.includes(formId)) throw new ApiError("Az űrlap nem tartozik a beállított kapcsolathoz.", 403);
  const form = await graph(settings, formId, "id,page,page_id", deadline);
  const nested = form.page && typeof form.page === "object" ? (form.page as Record<string, unknown>).id : form.page;
  const pageId = form.page_id || nested;
  if (form.id !== formId || pageId !== settings.config.pageId ||
      (form.page_id && nested && form.page_id !== nested)) {
    throw new ApiError("A Facebook-űrlap oldalhoz rendelése nem igazolható.", 502);
  }
}

function serviceClient(settings: ServerSettings) {
  return createClient(settings.supabaseUrl, settings.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function commitLead(settings: ServerSettings, lead: FacebookGraphLead, deadline: number): Promise<ImportResult> {
  const result = await serviceClient(settings).rpc("import_facebook_lead", {
    p_workspace_id: settings.config.workspaceId, p_page_id: settings.config.pageId, p_lead_id: lead.id,
    p_payload: normalizeFacebookLead(lead, settings.config),
  }).abortSignal(AbortSignal.timeout(Math.min(10000, remaining(deadline))));
  if (result.error || !result.data || !["created", "matched", "review"].includes(result.data.status) ||
      typeof result.data.duplicate !== "boolean") throw new ApiError("A jelentkezés mentése nem sikerült. Próbáld újra.", 503);
  return { status: result.data.status, duplicate: result.data.duplicate };
}

async function existingLeadIds(settings: ServerSettings, ids: string[], deadline: number) {
  if (!ids.length) return new Set<string>();
  const saved = await serviceClient(settings).from("facebook_lead_imports").select("lead_id")
    .eq("workspace_id", settings.config.workspaceId).eq("page_id", settings.config.pageId)
    .in("lead_id", ids).abortSignal(AbortSignal.timeout(Math.min(10000, remaining(deadline))));
  if (saved.error || !Array.isArray(saved.data)) throw new ApiError("A korábbi beérkezések ellenőrzése nem sikerült. Próbáld újra.", 503);
  return new Set<string>(saved.data.map(row => row.lead_id));
}

export async function receiveFacebookLeads(body: Record<string, unknown>) {
  const configured = settings();
  if (body.object !== "page" || !Array.isArray(body.entry) || body.entry.length > 100) {
    throw new ApiError("Hibás Facebook-esemény.", 400);
  }
  const pending = new Map<string, string | null>();
  let changesCount = 0;
  for (const entry of body.entry) {
    if (!entry || typeof entry !== "object" || !isFacebookId(entry.id) || !Array.isArray(entry.changes)) {
      throw new ApiError("Hibás Facebook-esemény.", 400);
    }
    changesCount += entry.changes.length;
    if (changesCount > 200) throw new ApiError("Túl sok Facebook-esemény.", 413);
    if (entry.id !== configured.config.pageId) continue;
    for (const change of entry.changes) {
      if (change?.field !== "leadgen") continue;
      const value = change.value;
      if (!value || !isFacebookId(value.leadgen_id) ||
          (value.page_id !== undefined && value.page_id !== entry.id) ||
          (value.form_id !== undefined && !isFacebookId(value.form_id))) throw new ApiError("Hibás Facebook-esemény.", 400);
      if (value.form_id && !configured.config.formIds.includes(value.form_id)) continue;
      pending.set(value.leadgen_id, value.form_id || null);
      if (pending.size > 200) throw new ApiError("Túl sok jelentkezés egy kérésben.", 413);
    }
  }
  const deadline = Date.now() + REQUEST_BUDGET_MS;
  const verifiedForms = new Set<string>();
  if (!pending.size) return { ok: true };
  // A partial batch can be retried after a timeout. Skip only rows already committed
  // in this configured scope, so retries progress instead of re-fetching the prefix.
  const existing = await existingLeadIds(configured, [...pending.keys()], deadline);
  for (const [leadId, eventFormId] of pending) {
    if (existing.has(leadId)) continue;
    const lead = await graph(configured, leadId, LEAD_FIELDS, deadline);
    if (!validateFacebookGraphLead(lead) || lead.id !== leadId ||
        !configured.config.formIds.includes(lead.form_id) || (eventFormId && eventFormId !== lead.form_id)) {
      throw new ApiError("A jelentkezés űrlapja nem igazolható.", 502);
    }
    if (!verifiedForms.has(lead.form_id)) {
      await verifyForm(configured, lead.form_id, deadline);
      verifiedForms.add(lead.form_id);
    }
    await commitLead(configured, lead, deadline);
  }
  return { ok: true };
}

function encodeCursor(settings: ServerSettings, formId: string, cursor: string) {
  const payload = Buffer.from(JSON.stringify({ f: formId, c: cursor })).toString("base64url");
  const signature = createHmac("sha256", settings.appSecret).update(`${settings.config.workspaceId}:${settings.config.pageId}:${payload}`).digest("hex");
  return `${payload}.${signature}`;
}

function decodeCursor(settings: ServerSettings, formId: string, token: unknown) {
  if (token === undefined || token === null || token === "") return "";
  if (typeof token !== "string" || token.length > 5000 || !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(token)) {
    throw new ApiError("Érvénytelen lapozási adat. Indítsd újra a beolvasást.", 400);
  }
  const [payload, signature] = token.split(".");
  const expected = createHmac("sha256", settings.appSecret).update(`${settings.config.workspaceId}:${settings.config.pageId}:${payload}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new ApiError("Érvénytelen lapozási adat.", 400);
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed.f === formId && typeof parsed.c === "string" && parsed.c.length > 0 && parsed.c.length <= 2048) return parsed.c;
  } catch { /* The cursor is scoped below; never treat it as a URL. */ }
  throw new ApiError("A lapozás másik űrlaphoz tartozik. Indítsd újra a beolvasást.", 400);
}

export async function syncFacebookLeads(workspaceId: string, body: Record<string, unknown>): Promise<FacebookLeadSyncResult> {
  const configured = settings(workspaceId);
  const formId = body.formId === undefined || body.formId === null ? configured.config.formIds[0] : body.formId;
  if (!isFacebookId(formId) || !configured.config.formIds.includes(formId)) throw new ApiError("Ismeretlen Facebook-űrlap.", 400);
  const cursor = decodeCursor(configured, formId, body.cursor);
  const deadline = Date.now() + REQUEST_BUDGET_MS;
  await verifyForm(configured, formId, deadline);
  const page = await graph(configured, `${formId}/leads`, LEAD_FIELDS, deadline, {
    limit: String(MAX_BATCH), ...(cursor ? { after: cursor } : {}),
  });
  if (!Array.isArray(page.data) || page.data.length > MAX_BATCH ||
      page.data.some(lead => !validateFacebookGraphLead(lead) || lead.form_id !== formId)) {
    throw new ApiError("A Meta hibás jelentkezési listát adott. Próbáld újra.", 502);
  }
  const paging = page.paging as { next?: unknown; cursors?: { after?: unknown } } | undefined;
  const after = paging?.cursors?.after;
  const hasNextPage = typeof paging?.next === "string" && !!paging.next;
  if (hasNextPage && (typeof after !== "string" || !after || after.length > 2048 || after === cursor)) {
    throw new ApiError("A Meta lapozási adatai hibásak. Próbáld újra.", 502);
  }
  const nextForm = configured.config.formIds[configured.config.formIds.indexOf(formId) + 1] || null;
  const result: FacebookLeadSyncResult = {
    imported: 0, matched: 0, review: 0, duplicates: 0,
    nextCursor: hasNextPage ? encodeCursor(configured, formId, after as string) : null,
    nextFormId: hasNextPage ? formId : nextForm, hasMore: hasNextPage || !!nextForm,
  };
  const existing = await existingLeadIds(configured, (page.data as FacebookGraphLead[]).map(lead => lead.id), deadline);
  for (const lead of page.data as FacebookGraphLead[]) {
    if (existing.has(lead.id)) { result.duplicates++; continue; }
    const imported = await commitLead(configured, lead, deadline);
    if (imported.duplicate) result.duplicates++;
    else if (imported.status === "created") result.imported++;
    else result[imported.status]++;
  }
  return result;
}
