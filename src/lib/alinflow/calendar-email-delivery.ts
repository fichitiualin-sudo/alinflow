import { normalizeAppointmentType } from "./appointments";
import { isQuoteItemFilled } from "./products";
import type { Customer } from "./types";

export type CalendarEmailKind = "quote" | "appointment";

export type CalendarEmailDeliveryStep = {
  kind: CalendarEmailKind;
  sentAt?: string;
  logged: boolean;
  error?: string;
};

export type CalendarEmailDelivery = {
  readonly id: string;
  readonly createdAt: string;
  readonly workspaceId: string;
  readonly customer: Customer;
  readonly payload: Record<string, unknown>;
  steps: CalendarEmailDeliveryStep[];
  busy: boolean;
};

type DeliveryActions = {
  send: (kind: CalendarEmailKind, delivery: CalendarEmailDelivery) => Promise<void>;
  record: (kind: CalendarEmailKind, sentAt: string, delivery: CalendarEmailDelivery) => Promise<void>;
  onChange?: () => void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

function snapshot<T>(value: T): T {
  // These are JSON request data. A detached, frozen snapshot keeps every retry
  // identical even if the user edits the active customer or workspace settings.
  return freezeSnapshot(JSON.parse(JSON.stringify(value)) as T);
}

export function createCalendarEmailDelivery(
  customer: Customer,
  payload: Record<string, unknown>,
  workspaceId: string,
): CalendarEmailDelivery {
  if (!UUID.test(workspaceId || "")) {
    throw new Error("Az emailküldéshez előbb válassz munkaterületet.");
  }
  if (!UUID.test(customer.id || "") || !UUID.test(customer.activeAppointmentId || "")) {
    throw new Error("Az emailküldés előtt mentsd el az ügyfelet és az időpontot.");
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const customerSnapshot = snapshot(customer);
  const includeQuote = normalizeAppointmentType(customerSnapshot.appointmentType) === "installation"
    && (customerSnapshot.quoteItems || []).some(isQuoteItemFilled);

  return {
    id,
    createdAt,
    workspaceId,
    customer: customerSnapshot,
    payload: snapshot({ ...payload, workspaceId, calendarEmailDelivery: { id, createdAt } }),
    steps: [
      ...(includeQuote ? [{ kind: "quote" as const, logged: false }] : []),
      { kind: "appointment", logged: false },
    ],
    busy: false,
  };
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error
    && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}

export async function runCalendarEmailDelivery(
  delivery: CalendarEmailDelivery,
  { send, record, onChange }: DeliveryActions,
): Promise<void> {
  // Set the guard before invoking any callback or yielding to a promise. The
  // caller keeps this same job in a ref and only copies it for rendering.
  if (delivery.busy) return;
  delivery.busy = true;
  const notify = () => {
    // Rendering cannot interrupt delivery bookkeeping or leave the job busy.
    try { onChange?.(); } catch { /* Observer errors do not change delivery state. */ }
  };

  try {
    notify();
    if (!delivery.customer.email?.trim()) {
      for (const step of delivery.steps) {
        if (!step.sentAt || !step.logged) step.error = "Az emailküldéshez előbb add meg az ügyfél email címét.";
      }
      notify();
      return;
    }

    for (const step of delivery.steps) {
      if (step.sentAt && step.logged) continue;
      delete step.error;
      try {
        if (!step.sentAt) {
          const age = Date.now() - Date.parse(delivery.createdAt);
          if (!Number.isFinite(age) || age >= RETRY_WINDOW_MS) {
            throw new Error("Az emailküldés 23 órás újrapróbálási ideje lejárt. Új küldés előtt ellenőrizd a korábbi küldés eredményét.");
          }
          await send(step.kind, delivery);
          // Remember provider acceptance before any document write. A failed
          // record operation must never send this email a second time.
          step.sentAt = new Date().toISOString();
          notify();
        }
        await record(step.kind, step.sentAt, delivery);
        step.logged = true;
      } catch (error) {
        step.error = errorMessage(error, step.sentAt
          ? "Az email elküldve, de a küldés naplózása nem sikerült."
          : "Nem sikerült elküldeni az emailt.");
      }
      notify();
    }
  } finally {
    delivery.busy = false;
    notify();
  }
}
