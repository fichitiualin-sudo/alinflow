// Server-only lookup: no Auth user list or workspace access is exposed to callers.
import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./server-auth";
import { normalizePrivacyParty } from "./privacy-notice";
import type { PrivacyPartnerCandidate } from "./privacy-partner";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEADERS = { "Cache-Control": "no-store" };

type PartnerLookup = { workspaceId: string } & (
  | { email: string; partnerUserId?: never; partnerWorkspaceId?: never }
  | { email?: never; partnerUserId: string; partnerWorkspaceId: string }
);

export async function readPrivacyPartnerRequest(request: Request): Promise<PartnerLookup> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new ApiError("JSON tartalmú kérés szükséges.", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("A kérés üres.");
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
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch { throw new ApiError("Hibás kérés."); }
  if (Object.keys(body).some(key => !["workspaceId", "email", "partnerUserId", "partnerWorkspaceId"].includes(key))) {
    throw new ApiError("Hibás keresési feltételek.");
  }
  if (typeof body.workspaceId !== "string" || !UUID.test(body.workspaceId)) throw new ApiError("Hiányzik vagy hibás a munkaterület.");
  const workspaceId = body.workspaceId.toLowerCase();
  if (Object.hasOwn(body, "email")) {
    if (Object.hasOwn(body, "partnerUserId") || Object.hasOwn(body, "partnerWorkspaceId")) throw new ApiError("Egyszerre csak egy keresési mód használható.");
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL.test(email) || email.length > 254 || /[\u0000-\u001f\u007f]/.test(email)) throw new ApiError("Add meg a karbantartó pontos bejelentkezési email-címét.");
    return { workspaceId, email };
  }
  if (typeof body.partnerUserId !== "string" || !UUID.test(body.partnerUserId)
      || typeof body.partnerWorkspaceId !== "string" || !UUID.test(body.partnerWorkspaceId)) {
    throw new ApiError("Hiányzik vagy hibás a kiválasztott karbantartó.");
  }
  return { workspaceId, partnerUserId: body.partnerUserId.toLowerCase(), partnerWorkspaceId: body.partnerWorkspaceId.toLowerCase() };
}

export async function lookupPrivacyPartner(request: Request, lookup: PartnerLookup) {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) throw new ApiError("A művelethez jelentkezz be.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new ApiError("A karbantartó keresése átmenetileg nem érhető el.", 503);
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new ApiError("A bejelentkezés lejárt.", 401);
  const member = await client.from("workspace_members").select("role")
    .eq("workspace_id", lookup.workspaceId).eq("user_id", data.user.id).eq("active", true).maybeSingle();
  const workspace = await client.from("workspaces").select("id")
    .eq("id", lookup.workspaceId).eq("active", true).maybeSingle();
  if (member.error || !member.data || !["owner", "admin"].includes(member.data.role) || workspace.error || !workspace.data) {
    throw new ApiError("A karbantartó partnert a munkaterület tulajdonosa vagy adminisztrátora választhatja ki.", 403);
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new ApiError("A karbantartó keresése átmenetileg nem érhető el.", 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await admin.rpc("lookup_privacy_partner", {
    p_email: lookup.email ?? null,
    p_user_id: lookup.partnerUserId ?? null,
    p_workspace_id: lookup.partnerWorkspaceId ?? null,
  });
  if (result.error || !Array.isArray(result.data)) throw new ApiError("A karbantartó keresése átmenetileg nem sikerült. Próbáld újra.", 503);
  const candidates = result.data.slice(0, 10).map((row: unknown) => candidateFromRow(row));
  if (lookup.email !== undefined) return { ok: true, candidates };
  const candidate = candidates.find(item => item.userId === lookup.partnerUserId && item.workspaceId === lookup.partnerWorkspaceId);
  if (!candidate) throw new ApiError("A kiválasztott karbantartó már nem érhető el. Válaszd ki újra.", 404);
  if (candidate.issues.length) throw new ApiError("A kiválasztott karbantartó vállalkozási adatai hiányosak vagy hibásak. Kérd meg, hogy javítsa az adatkezelési tájékoztató beállításait.", 409);
  return { ok: true, candidate };
}

function candidateFromRow(input: unknown): PrivacyPartnerCandidate {
  const row = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  if (typeof row.user_id !== "string" || !UUID.test(row.user_id)
      || typeof row.workspace_id !== "string" || !UUID.test(row.workspace_id)
      || typeof row.workspace_name !== "string") throw new ApiError("A karbantartó adatai átmenetileg nem olvashatók.", 503);
  const party = normalizePrivacyParty(row.party);
  const issues: string[] = [];
  if (!party.legalName) issues.push("Hiányzik a hivatalos vállalkozásnév.");
  if (!party.address) issues.push("Hiányzik a vállalkozás székhelye.");
  if (!EMAIL.test(party.email)) issues.push("Hiányzik vagy hibás az adatkezelési email-cím.");
  for (const [key, limit, label] of [
    ["legalName", 300, "vállalkozásnév"], ["address", 1000, "székhely"], ["email", 254, "email-cím"],
    ["phone", 80, "telefonszám"], ["taxNumber", 80, "adószám"],
  ] as const) {
    if (party[key].length > limit) issues.push(`Túl hosszú ${label}.`);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(party[key])) issues.push(`Hibás karakter a(z) ${label} mezőben.`);
    // Malformed settings must not turn a small lookup into a large data response.
    party[key] = party[key].slice(0, limit);
  }
  return { userId: row.user_id.toLowerCase(), workspaceId: row.workspace_id.toLowerCase(), workspaceName: row.workspace_name.slice(0, 300), party, issues };
}

export function privacyPartnerResponse(body: unknown) { return Response.json(body, { headers: HEADERS }); }
export function privacyPartnerError(error: unknown) {
  return Response.json({ ok: false, error: error instanceof ApiError ? error.message : "A karbantartó keresése nem sikerült. Próbáld újra." }, {
    status: error instanceof ApiError ? error.status : 500, headers: HEADERS,
  });
}
