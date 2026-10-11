// Server-only: the browser must never be able to release an invoice claim.
import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./server-auth";
import type { BillingInvoiceKind } from "./billing";

type InvoiceReceipt = { invoiceNumber: string; netAmount: string; grossAmount: string; emailSent: boolean };
type InvoiceOperation = {
  workspaceId: string; customerId: string; appointmentId: string | null;
  requestedBy: string; kind: BillingInvoiceKind; sendEmail: boolean;
};

export class InvoiceProviderRejection extends Error {}

export function invoiceIssueDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const REVIEW_MESSAGE = "A korábbi számlakérés eredménye bizonytalan. Új számlát nem készítettünk; előbb ellenőrizni kell a Számlázz.hu számlanaplóját és a számlázási művelet állapotát.";

export async function issueInvoiceOnce(operation: InvoiceOperation,
  send: () => Promise<Omit<InvoiceReceipt, "emailSent">>): Promise<InvoiceReceipt> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError("A számlázási napló beállítása hiányzik. Nem indult számlakiállítás.", 503);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const scope = {
    p_workspace_id: operation.workspaceId, p_customer_id: operation.customerId,
    p_appointment_id: operation.appointmentId, p_invoice_kind: operation.kind,
  };
  let claim;
  try { claim = await admin.rpc("claim_invoice_delivery", { ...scope, p_requested_by: operation.requestedBy }); }
  catch { throw new ApiError("A számlázási napló nem érhető el. Nem indult számlakiállítás.", 503); }
  if (claim.error || !claim.data) throw new ApiError("A számlázási napló nem érhető el. Nem indult számlakiállítás.", 503);
  const delivery = claim.data;
  if (delivery.status === "confirmed" && typeof delivery.invoice_number === "string" && delivery.invoice_number.trim()) {
    return { invoiceNumber: delivery.invoice_number, netAmount: delivery.net_amount || "", grossAmount: delivery.gross_amount || "", emailSent: delivery.email_sent === true };
  }
  if (delivery.status === "busy") throw new ApiError("Ehhez a munkához a számlakiállítás már folyamatban van. Várd meg a visszaigazolást.", 409);
  if (delivery.status === "already_recorded") throw new ApiError("Ehhez a munkához már rögzített számla tartozik. Új számlát nem készítettünk; ellenőrizd a korábbi számlát.", 409);
  if (delivery.status !== "send" || typeof delivery.claim_token !== "string" || !delivery.claim_token) {
    throw new ApiError(REVIEW_MESSAGE, 409);
  }
  async function finish(outcome: "confirmed" | "uncertain" | "rejected", receipt?: Omit<InvoiceReceipt, "emailSent">) {
    return admin.rpc("finish_invoice_delivery", {
      ...scope, p_claim_token: delivery.claim_token, p_outcome: outcome,
      p_invoice_number: receipt?.invoiceNumber || null, p_net_amount: receipt?.netAmount || null,
      p_gross_amount: receipt?.grossAmount || null, p_email_sent: outcome === "confirmed" && operation.sendEmail,
    });
  }
  let receipt: Omit<InvoiceReceipt, "emailSent">;
  try {
    receipt = await send();
    if (!receipt.invoiceNumber?.trim()) throw new Error("Missing invoice number");
  } catch (error) {
    // Only an explicit provider rejection proves that nothing was issued.
    // An expired claim is never automatically reused, even if this write fails.
    const rejected = error instanceof InvoiceProviderRejection;
    try { await finish(rejected ? "rejected" : "uncertain"); } catch { /* Durable claim remains closed. */ }
    throw new ApiError(rejected ? "A Számlázz.hu elutasította a számlakérést. Ellenőrizd a számlázási adatokat, majd próbáld újra." : REVIEW_MESSAGE, 502);
  }
  let completion;
  try { completion = await finish("confirmed", receipt); } catch { completion = null; }
  if (!completion || completion.error || completion.data?.status !== "confirmed") {
    throw new ApiError(`A számla elkészült (${receipt.invoiceNumber}), de a naplózást nem sikerült visszaigazolni. Új számlát ne készíts; a számlázási napló ellenőrzése szükséges.`, 503);
  }
  return { ...receipt, emailSent: operation.sendEmail };
}
