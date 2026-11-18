import type { Customer } from "./types";

type AttemptIdentity = { id: string; issuedAt: string };

export function manualQuoteScope(workspaceId: string | null, userId: string | null, customer: Customer) {
  return JSON.stringify([workspaceId, userId, customer.id, customer.activeQuoteId, customer.activeAppointmentId]);
}

export function storedManualQuoteAttempt(scope: string): AttemptIdentity | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem("alinflow:manual-quote:" + scope) || "null");
    if (typeof saved?.id === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(saved.id)
      && typeof saved.issuedAt === "string" && Number.isFinite(Date.parse(saved.issuedAt))) {
      return { id: saved.id, issuedAt: saved.issuedAt };
    }
  } catch { /* Storage can be unavailable on a restricted browser. */ }
}

/** Keep only the retry token and issue time across a reload in this tab. */
export function manualQuoteAttemptIdentity(scope: string, issuedAt: string): AttemptIdentity {
  const saved = storedManualQuoteAttempt(scope);
  if (saved) return saved;
  const identity = { id: crypto.randomUUID(), issuedAt };
  try { sessionStorage.setItem("alinflow:manual-quote:" + scope, JSON.stringify(identity)); } catch { /* In-memory retries still work. */ }
  return identity;
}

export function finishManualQuoteAttempt(scope: string) {
  try { sessionStorage.removeItem("alinflow:manual-quote:" + scope); } catch { /* Optional browser storage. */ }
}
