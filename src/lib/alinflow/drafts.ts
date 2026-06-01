import type { Customer, CustomerDraft, ReturnContext, View } from "./types";
import { CUSTOMER_DRAFT_KEY, EMPTY_QUOTE_ITEMS, RESTORABLE_VIEWS, RETURN_CONTEXT_KEY } from "./constants";
import { todayIso } from "./format";

export function safeReturnView(value: unknown): View {
  return typeof value === "string" && RESTORABLE_VIEWS.includes(value as View) ? (value as View) : "work";
}

export function readReturnContext(): ReturnContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RETURN_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReturnContext>;
    if (!parsed.customerId) return null;
    const at = typeof parsed.at === "number" ? parsed.at : Date.now();
    const maxAgeMs = 6 * 60 * 60 * 1000;
    if (Date.now() - at > maxAgeMs) {
      window.sessionStorage.removeItem(RETURN_CONTEXT_KEY);
      return null;
    }
    return { customerId: parsed.customerId, view: safeReturnView(parsed.view), at };
  } catch {
    window.sessionStorage.removeItem(RETURN_CONTEXT_KEY);
    return null;
  }
}

export function readCustomerDraft(): CustomerDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CUSTOMER_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CustomerDraft>;
    if (!parsed.customer?.id) return null;
    const at = typeof parsed.at === "number" ? parsed.at : Date.now();
    const maxAgeMs = 6 * 60 * 60 * 1000;
    if (Date.now() - at > maxAgeMs) {
      window.sessionStorage.removeItem(CUSTOMER_DRAFT_KEY);
      return null;
    }
    return {
      customer: parsed.customer as Customer,
      quoteItems: Array.isArray(parsed.quoteItems) && parsed.quoteItems.length ? parsed.quoteItems : (parsed.customer as Customer).quoteItems || EMPTY_QUOTE_ITEMS,
      scheduleDate: typeof parsed.scheduleDate === "string" ? parsed.scheduleDate : (parsed.customer as Customer).date || todayIso(),
      scheduleTime: typeof parsed.scheduleTime === "string" ? parsed.scheduleTime : (parsed.customer as Customer).time?.split(" ")[0] || "08:00",
      view: safeReturnView(parsed.view),
      editCustomer: Boolean(parsed.editCustomer),
      allowWorkResourceEdit: Boolean(parsed.allowWorkResourceEdit),
      at,
    };
  } catch {
    window.sessionStorage.removeItem(CUSTOMER_DRAFT_KEY);
    return null;
  }
}

export function writeCustomerDraft(draft: CustomerDraft) {
  if (typeof window === "undefined" || !draft.customer?.id) return;
  try {
    window.sessionStorage.setItem(CUSTOMER_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // A sessionStorage csak kényelmi biztonsági mentés. Ha megtelik vagy tiltott, az app működjön tovább.
  }
}

export function clearCustomerDraft(customerId?: string) {
  if (typeof window === "undefined") return;
  if (!customerId) {
    window.sessionStorage.removeItem(CUSTOMER_DRAFT_KEY);
    return;
  }
  const current = readCustomerDraft();
  if (current?.customer.id === customerId) window.sessionStorage.removeItem(CUSTOMER_DRAFT_KEY);
}

export function draftForCustomer(customer: Customer) {
  const draft = readCustomerDraft();
  if (!draft || draft.customer.id !== customer.id) return null;

  const nextQuoteItems = draft.quoteItems.length
    ? draft.quoteItems
    : draft.customer.quoteItems?.length
    ? draft.customer.quoteItems
    : customer.quoteItems || EMPTY_QUOTE_ITEMS;

  return {
    ...draft,
    customer: {
      ...customer,
      ...draft.customer,
      quoteItems: nextQuoteItems,
    } as Customer,
    quoteItems: nextQuoteItems,
  };
}
