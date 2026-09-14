import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/alinflow/server-auth";

type DeliveryOptions = {
  client: Pick<SupabaseClient, "rpc">;
  workspaceId: string;
  customerId: string;
  appointmentId: string;
  apiKey: string;
  payload: { to: string[]; [key: string]: unknown };
  fetchImpl?: typeof fetch;
};

type DeliveryResult = { ok: true; id: string | null; alreadySent: boolean; sentAt: string };

async function payloadSignature(apiKey: string, scope: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(Buffer.from(apiKey, "utf8")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key,
    new Uint8Array(Buffer.from(`thank-you/v1/${scope}\n${payload}`, "utf8")));
  return Buffer.from(signature).toString("hex");
}

// All sends go through the durable appointment claim. A retry uses the frozen,
// server-signed body and provider key, even if settings changed in the meantime.
export async function sendInstallationThankYouOnce(options: DeliveryOptions): Promise<DeliveryResult> {
  const { client, workspaceId, customerId, appointmentId, apiKey, payload, fetchImpl = fetch } = options;
  const scope = `${workspaceId}/${customerId}/${appointmentId}`;
  const scopeArgs = { p_workspace_id: workspaceId, p_customer_id: customerId, p_appointment_id: appointmentId };
  const payloadText = JSON.stringify(payload);
  const signature = await payloadSignature(apiKey, scope, payloadText);
  const claim = await client.rpc("claim_installation_thank_you", {
    ...scopeArgs, p_payload_text: payloadText, p_payload_signature: signature,
  });
  if (claim.error || !claim.data) {
    throw new ApiError("A köszönő email küldési naplója nem érhető el. Próbáld újra később.", 503);
  }
  const delivery = claim.data;
  if (delivery.status === "already_sent" && delivery.sent_at) {
    return { ok: true, id: delivery.provider_id || null, alreadySent: true, sentAt: delivery.sent_at };
  }
  if (delivery.status === "busy") {
    throw new ApiError("A köszönő email küldése már folyamatban van. Két perc múlva biztonságosan újrapróbálhatod.", 409);
  }
  if (delivery.status === "needs_review") {
    throw new ApiError("A korábbi köszönő email küldési eredménye bizonytalan. Újraküldés előtt ellenőrizni kell a szolgáltatói naplót.", 409);
  }
  if (delivery.status !== "send" || typeof delivery.payload_text !== "string" ||
      typeof delivery.payload_signature !== "string" || typeof delivery.claim_token !== "string" ||
      typeof delivery.idempotency_key !== "string" || !delivery.idempotency_key.startsWith(`alinflow-thank-you/${workspaceId}/${appointmentId}/`) ||
      delivery.idempotency_key.length > 256 ||
      await payloadSignature(apiKey, scope, delivery.payload_text) !== delivery.payload_signature) {
    throw new ApiError("A köszönő email mentett küldési adatai nem ellenőrizhetők. Ellenőrzés szükséges az újrapróbálás előtt.", 409);
  }
  let savedPayload: { to?: unknown };
  try { savedPayload = JSON.parse(delivery.payload_text); }
  catch { throw new ApiError("A köszönő email mentett tartalma hibás. Ellenőrzés szükséges.", 409); }
  if (!Array.isArray(savedPayload.to) || savedPayload.to.length !== 1 || payload.to.length !== 1 ||
      typeof savedPayload.to[0] !== "string" ||
      savedPayload.to[0].trim().toLowerCase() !== payload.to[0].trim().toLowerCase()) {
    throw new ApiError("Az email-cím a korábbi küldési kísérlet óta megváltozott. Ellenőrzés szükséges az újraküldés előtt.", 409);
  }

  async function finish(outcome: "sent" | "failed" | "uncertain", providerId: string | null, error: string | null) {
    return client.rpc("finish_installation_thank_you", {
      ...scopeArgs, p_claim_token: delivery.claim_token, p_outcome: outcome,
      p_provider_id: providerId, p_error: error,
    });
  }
  async function recordFailure(outcome: "failed" | "uncertain", message: string) {
    // A later HTTP rejection cannot disprove an earlier uncertain acceptance.
    const safeOutcome = delivery.resuming ? "uncertain" : outcome;
    try { await finish(safeOutcome, null, message); } catch { /* The lease will expire; its stable key remains. */ }
  }

  let response: Response;
  try {
    response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": delivery.idempotency_key },
      body: delivery.payload_text,
      ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(15_000) } : {}),
    });
  } catch {
    const message = "A köszönő email küldési eredménye hálózati hiba miatt bizonytalan. Az újrapróbálás ugyanazt a küldést folytatja.";
    await recordFailure("uncertain", message);
    throw new ApiError(message, 502);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result?.id !== "string" || !result.id.trim()) {
    const definitive = !response.ok && response.status >= 400 && response.status < 500 && response.status !== 409;
    const message = definitive && !delivery.resuming
      ? "A szolgáltató elutasította a köszönő email küldését. Ellenőrizd az emailbeállításokat, majd próbáld újra."
      : "A köszönő email küldési eredménye bizonytalan. Az újrapróbálás ugyanazt a küldést folytatja.";
    await recordFailure(definitive ? "failed" : "uncertain", message);
    throw new ApiError(message, 502);
  }

  let completion;
  try { completion = await finish("sent", result.id, null); } catch { completion = null; }
  if (!completion || completion.error || !completion.data?.sent_at) {
    throw new ApiError("A szolgáltató elfogadta a köszönő emailt, de a naplózást nem sikerült visszaigazolni. Két perc múlva biztonságosan újrapróbálhatod.", 503);
  }
  return { ok: true, id: result.id, alreadySent: false, sentAt: completion.data.sent_at };
}
