import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./server-auth";
import { sendEmailThroughProvider } from "./email-provider";

export type SentQuoteLine = { name: string; quantity: number; unitPrice: number; totalPrice: number; productUrl?: string; imageUrl?: string };
type Delivery = {
  id: string; providerKey: string; workspaceId: string; customerId: string; appointmentId: string | null;
  quoteId: string | null; userId: string; issuedAt: string; recipient: string; pricingMode: "bundle" | "alternatives";
  items: SentQuoteLine[]; totalAmount: number; emailPayload: Record<string, unknown>; conflictMessage: string;
};

export function quoteDeliveryId(value: unknown) {
  if (value === undefined) return crypto.randomUUID(); // Older open clients have no explicit delivery identity.
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError("Az ajánlatküldés azonosítója hibás.", 400);
  }
  return value.toLowerCase();
}

export async function sendArchivedQuote(delivery: Delivery, apiKey: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new ApiError("Az ajánlatelőzmények mentése nincs beállítva.", 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const scope = { p_id: delivery.id, p_workspace_id: delivery.workspaceId, p_customer_id: delivery.customerId };
  const prepared = await admin.rpc("prepare_quote_delivery", {
    ...scope, p_appointment_id: delivery.appointmentId, p_quote_id: delivery.quoteId, p_user_id: delivery.userId,
    p_issued_at: delivery.issuedAt, p_recipient: delivery.recipient, p_pricing_mode: delivery.pricingMode,
    p_items: delivery.items, p_total_amount: delivery.totalAmount, p_provider_key: delivery.providerKey,
    p_email_payload: JSON.stringify(delivery.emailPayload),
  });
  if (prepared.error?.code === "23505") throw new ApiError(delivery.conflictMessage, 409);
  if (prepared.error?.code === "42501") throw new ApiError("Az ügyfél vagy az ajánlat adatai megváltoztak. Frissítsd az ügyfelet.", 403);
  if (prepared.error) throw new ApiError("Az ajánlatelőzmények mentése nem sikerült. Próbáld újra.", 503);
  const result = prepared.data;
  if (result?.state === "sent" && typeof result.provider_id === "string" && typeof result.sent_at === "string") {
    return { id: result.provider_id, deliveryId: delivery.id, sentAt: result.sent_at };
  }
  if (result?.state === "expired") throw new ApiError("Az ajánlat küldési eredményét az emailküldési naplóban kell ellenőrizni.", 409);
  if (result?.state !== "ready") throw new ApiError("Az ajánlat mentését nem sikerült ellenőrizni.", 503);
  const sent = await sendEmailThroughProvider({ apiKey, payload: delivery.emailPayload,
    idempotencyKey: delivery.providerKey, conflictMessage: delivery.conflictMessage });
  let confirmation;
  try {
    confirmation = await admin.rpc("confirm_quote_delivery", { ...scope, p_provider_id: sent.id });
  } catch { /* A subsequent retry uses the same provider idempotency key. */ }
  if (confirmation?.error || typeof confirmation?.data !== "string") throw new ApiError(
    "Az emailküldő visszaigazolta a küldést, de az előzmény mentését újra kell próbálni. Használd ugyanennek a küldésnek az újrapróbálását.", 503);
  return { id: sent.id, deliveryId: delivery.id, sentAt: confirmation.data };
}
