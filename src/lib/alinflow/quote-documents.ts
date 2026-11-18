import { supabase } from "@/lib/supabase";
import { readAllRows } from "./pagination";
import { quotePricingModeFromNotes } from "./products";

type QuoteLine = {
  name: string;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  productUrl?: string;
};

export type QuoteDocumentVersion = {
  id: string;
  kind: "sent" | "saved";
  timestamp: string | null;
  issuedAt?: string | null;
  recipient?: string;
  alternatives: boolean;
  items: QuoteLine[];
  total: number | null;
};

export type QuoteDocumentReceipt = { id: string; sentAt: string; appointmentId?: string; quoteId?: string };
type ScopedVersion = QuoteDocumentVersion & { quoteId: string | null; appointmentId: string | null };
type QuoteDocumentRow = ScopedVersion | { kind: "receipt"; id: string; timestamp: string };
type DocumentScope = { appointmentId?: string; activeQuoteId?: string };

function nonnegative(value: unknown) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function quoteLine(name: unknown, qty: unknown, unit: unknown, total: unknown): QuoteLine {
  const quantity = nonnegative(qty);
  const unitPrice = nonnegative(unit);
  return {
    name: typeof name === "string" && name.trim() ? name : "Tétel megnevezés nélkül",
    quantity, unitPrice,
    totalPrice: nonnegative(total) ?? (quantity !== null && unitPrice !== null ? quantity * unitPrice : null),
  };
}

type SentRow = {
  id: string; quote_id: string | null; appointment_id: string | null; issued_at: string; sent_at: string;
  recipient: string; pricing_mode: string; items: unknown; total_amount: unknown;
};
type SavedRow = {
  id: string; appointment_id: string | null; updated_at: string | null; created_at: string | null;
  notes: string | null; total_amount: unknown;
  quote_items: { product_name: string; quantity: unknown; unit_price: unknown; total_price: unknown }[] | null;
};

async function sentQuotes(workspaceId: string, customerId: string): Promise<ScopedVersion[]> {
  const result = await readAllRows<SentRow>((from, to) => supabase.from("quote_delivery_history")
    .select("id,quote_id,appointment_id,issued_at,sent_at,recipient,pricing_mode,items,total_amount")
    .eq("workspace_id", workspaceId).eq("customer_id", customerId).not("sent_at", "is", null)
    .order("id").range(from, to));
  if (result.error) throw result.error;
  return result.data.map(row => ({
    id: row.id, kind: "sent", quoteId: row.quote_id, appointmentId: row.appointment_id,
    timestamp: row.sent_at, issuedAt: row.issued_at, recipient: row.recipient,
    alternatives: row.pricing_mode === "alternatives", total: nonnegative(row.total_amount),
    items: (Array.isArray(row.items) ? row.items : []).map(item => ({
      ...quoteLine(item?.name, item?.quantity, item?.unitPrice, item?.totalPrice),
      ...(typeof item?.productUrl === "string" ? { productUrl: item.productUrl } : {}),
    })),
  }));
}

async function savedQuotes(workspaceId: string, customerId: string): Promise<ScopedVersion[]> {
  const result = await readAllRows<SavedRow>((from, to) => supabase.from("quotes")
    .select("id,appointment_id,updated_at,created_at,notes,total_amount,quote_items(product_name,quantity,unit_price,total_price)")
    .eq("workspace_id", workspaceId).eq("customer_id", customerId).eq("quote_items.workspace_id", workspaceId)
    .order("id").range(from, to));
  if (result.error) throw result.error;
  return result.data.map(row => ({
    id: row.id, kind: "saved", quoteId: row.id, appointmentId: row.appointment_id,
    timestamp: row.updated_at || row.created_at, alternatives: quotePricingModeFromNotes(row.notes) === "alternatives",
    total: nonnegative(row.total_amount),
    items: (row.quote_items ?? []).map(item => quoteLine(item.product_name, item.quantity, item.unit_price, item.total_price)),
  }));
}

export async function loadQuoteDocuments(workspaceId: string, customerId: string) {
  const [sent, saved] = await Promise.allSettled([sentQuotes(workspaceId, customerId), savedQuotes(workspaceId, customerId)]);
  return {
    sent: sent.status === "fulfilled" ? sent.value : [],
    saved: saved.status === "fulfilled" ? saved.value : [],
    failed: sent.status === "rejected" || saved.status === "rejected",
  };
}

function contentKey(document: ScopedVersion, appointmentId: string | null) {
  // Stored line items have no position column. A repeated line still counts twice.
  const lines = document.items.map(line => JSON.stringify([line.name, line.quantity, line.unitPrice, line.totalPrice])).sort();
  return JSON.stringify([document.quoteId, appointmentId, document.alternatives, document.alternatives ? null : document.total, lines]);
}

function timestampKey(value: string | null) {
  if (!value) return "";
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return "";
  // The database timestamp can contain microseconds; equal milliseconds alone are insufficient.
  const fraction = value.match(/[T ]\d\d:\d\d:\d\d\.(\d+)/)?.[1] ?? "";
  return new Date(millis).toISOString().slice(0, -1) + fraction.slice(3, 6).padEnd(3, "0") + "Z";
}

export function quoteDocumentRows(
  sources: Awaited<ReturnType<typeof loadQuoteDocuments>>, receipts: QuoteDocumentReceipt[], scope: DocumentScope,
): QuoteDocumentRow[] {
  const appointments = new Map(sources.saved.map(document => [document.id, document.appointmentId]));
  function appointmentFor(document: ScopedVersion) {
    return document.appointmentId || (document.quoteId && appointments.get(document.quoteId))
      || (document.quoteId && document.quoteId === scope.activeQuoteId ? scope.appointmentId : null) || null;
  }
  function inScope(document: ScopedVersion) {
    if (!scope.appointmentId) return true;
    const appointment = appointmentFor(document);
    return appointment ? appointment === scope.appointmentId : !document.quoteId;
  }
  const sent = sources.sent.filter(inScope);
  const sentCopies = new Set<string>();
  const sentByAppointment = new Set<string>();
  const sentByQuote = new Set<string>();
  for (const document of sent) {
    const time = timestampKey(document.timestamp);
    const appointment = appointmentFor(document);
    if (document.quoteId) {
      sentCopies.add(contentKey(document, appointment));
      sentByQuote.add(JSON.stringify([time, document.quoteId]));
    }
    // Independent offers with neither link do not create a legacy sending receipt.
    if (document.quoteId || document.appointmentId) {
      sentByAppointment.add(JSON.stringify([time, document.appointmentId ?? null]));
      if (appointment) sentByAppointment.add(JSON.stringify([time, appointment]));
    }
  }
  // An empty, zero-total work placeholder is not a saved offer. Its quote link above still applies.
  const saved = sources.saved.filter(document => inScope(document) && (document.items.length || (document.total ?? 0) > 0)
    && !sentCopies.has(contentKey(document, appointmentFor(document))));
  const rows: QuoteDocumentRow[] = [...sent, ...saved];
  for (const receipt of receipts) {
    if (scope.appointmentId && receipt.appointmentId && receipt.appointmentId !== scope.appointmentId) continue;
    const time = timestampKey(receipt.sentAt);
    const matched = !receipt.appointmentId && receipt.quoteId
      ? sentByQuote.has(JSON.stringify([time, receipt.quoteId]))
      : sentByAppointment.has(JSON.stringify([time, receipt.appointmentId ?? null]));
    if (!time || !matched) rows.push({ kind: "receipt", id: receipt.id, timestamp: receipt.sentAt });
  }
  return rows.sort((a, b) => timestampKey(b.timestamp).localeCompare(timestampKey(a.timestamp)) || a.id.localeCompare(b.id));
}
