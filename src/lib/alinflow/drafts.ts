import type { Customer, CustomerDraft, ReturnContext, View } from "./types";
import { CUSTOMER_DRAFT_KEY, EMPTY_QUOTE_ITEMS, RESTORABLE_VIEWS, RETURN_CONTEXT_KEY } from "./constants";
import { firstAppointmentTime, normalizeAppointmentType } from "./appointments";
import { todayIso } from "./format";
import { customerLocationFromData } from "./customers";

export function safeReturnView(value: unknown): View {
  return typeof value === "string" && RESTORABLE_VIEWS.includes(value as View) ? (value as View) : "work";
}

export type DraftScope = { userId: string; workspaceId: string | null } | null;

function storageKey(key: string, scope: DraftScope) {
  return scope?.userId ? `${key}:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.workspaceId || "legacy")}` : null;
}

function removeStored(key: string | null) {
  if (typeof window === "undefined" || !key) return;
  try { window.sessionStorage.removeItem(key); } catch { /* Optional local recovery storage. */ }
}

export function clearReturnContext(scope: DraftScope) {
  removeStored(storageKey(RETURN_CONTEXT_KEY, scope));
}

export function writeReturnContext(context: ReturnContext, scope: DraftScope) {
  const key = storageKey(RETURN_CONTEXT_KEY, scope);
  if (typeof window === "undefined" || !key) return;
  try { window.sessionStorage.setItem(key, JSON.stringify(context)); } catch { /* Optional local recovery storage. */ }
}

export function readReturnContext(scope: DraftScope): ReturnContext | null {
  const key = storageKey(RETURN_CONTEXT_KEY, scope);
  if (typeof window === "undefined" || !key) return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReturnContext>;
    if (!parsed.customerId) return null;
    const at = typeof parsed.at === "number" ? parsed.at : Date.now();
    const maxAgeMs = 6 * 60 * 60 * 1000;
    if (Date.now() - at > maxAgeMs) {
      removeStored(key);
      return null;
    }
    return { customerId: parsed.customerId, appointmentId: typeof parsed.appointmentId === "string" ? parsed.appointmentId : undefined, view: safeReturnView(parsed.view), at };
  } catch {
    removeStored(key);
    return null;
  }
}

export function readCustomerDraft(scope: DraftScope): CustomerDraft | null {
  const key = storageKey(CUSTOMER_DRAFT_KEY, scope);
  if (typeof window === "undefined" || !key) return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CustomerDraft>;
    if (!parsed.customer?.id) return null;
    const at = typeof parsed.at === "number" ? parsed.at : Date.now();
    const maxAgeMs = 6 * 60 * 60 * 1000;
    if (Date.now() - at > maxAgeMs) {
      removeStored(key);
      return null;
    }
    let customer = parsed.customer as Customer;
    if (!String(customer.city || "").trim()) {
      const location = customerLocationFromData(customer.city, customer.postalCode, customer.address);
      const savedPostalCode = String(customer.postalCode || "").trim();
      // Old work drafts hid the city. Recover only from this draft's own,
      // consistent location; keep every other unsaved field and stored snapshot.
      if (location.city && (!savedPostalCode || savedPostalCode === location.postalCode)) {
        customer = { ...customer, city: location.city, postalCode: savedPostalCode ? customer.postalCode : location.postalCode };
      }
    }
    return {
      customer,
      quoteItems: Array.isArray(parsed.quoteItems) && parsed.quoteItems.length ? parsed.quoteItems : (parsed.customer as Customer).quoteItems || EMPTY_QUOTE_ITEMS,
      scheduleDate: typeof parsed.scheduleDate === "string" ? parsed.scheduleDate : (parsed.customer as Customer).date || todayIso(),
      scheduleTime: typeof parsed.scheduleTime === "string" ? firstAppointmentTime(parsed.scheduleTime) : firstAppointmentTime((parsed.customer as Customer).time),
      scheduleAppointmentType: normalizeAppointmentType(parsed.scheduleAppointmentType || (parsed.customer as Customer).appointmentType),
      view: safeReturnView(parsed.view),
      editCustomer: Boolean(parsed.editCustomer),
      allowWorkResourceEdit: Boolean(parsed.allowWorkResourceEdit),
      at,
    };
  } catch {
    removeStored(key);
    return null;
  }
}

export function writeCustomerDraft(draft: CustomerDraft, scope: DraftScope) {
  const key = storageKey(CUSTOMER_DRAFT_KEY, scope);
  if (typeof window === "undefined" || !key || !draft.customer?.id) return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // A sessionStorage csak kényelmi biztonsági mentés. Ha megtelik vagy tiltott, az app működjön tovább.
  }
}

export function clearCustomerDraft(scope: DraftScope, customerId?: string) {
  const key = storageKey(CUSTOMER_DRAFT_KEY, scope);
  if (typeof window === "undefined" || !key) return;
  if (!customerId) {
    removeStored(key);
    return;
  }
  const current = readCustomerDraft(scope);
  if (current?.customer.id === customerId) removeStored(key);
}

export function draftForCustomer(customer: Customer, scope: DraftScope) {
  const draft = readCustomerDraft(scope);
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
