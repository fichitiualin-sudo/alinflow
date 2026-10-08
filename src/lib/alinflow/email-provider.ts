import { ApiError } from "./server-auth";

type EmailProviderOptions = {
  apiKey: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  conflictMessage?: string;
};

const UNCERTAIN_DELIVERY_MESSAGE = "Az email küldési eredménye nem igazolható vissza. Új küldés előtt ellenőrizd a korábbi küldés eredményét, mert a levél már elindulhatott.";

export async function sendEmailThroughProvider(options: EmailProviderOptions): Promise<{ id: string }> {
  let response: Response;
  let result: unknown;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify(options.payload),
      ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(15_000) } : {}),
    });
    result = await response.json().catch(() => null);
  } catch {
    throw new ApiError(UNCERTAIN_DELIVERY_MESSAGE, 502);
  }

  if (response.status === 409 && options.conflictMessage) {
    throw new ApiError(options.conflictMessage, 409);
  }
  if (!response.ok) {
    if (response.status >= 500 || response.status === 408 || response.status === 409) {
      throw new ApiError(UNCERTAIN_DELIVERY_MESSAGE, 502);
    }
    if (response.status === 429) {
      throw new ApiError("Az emailküldő szolgáltató átmenetileg korlátozza a küldést. Próbáld újra később.", 429);
    }
    throw new ApiError("Az emailküldő szolgáltató elutasította a küldést. Ellenőrizd az ügyfél email-címét és az emailküldés beállításait.", 502);
  }

  const id = result && typeof result === "object" && "id" in result ? result.id : undefined;
  if (typeof id !== "string" || !id.trim()) {
    throw new ApiError(UNCERTAIN_DELIVERY_MESSAGE, 502);
  }
  return { id };
}
