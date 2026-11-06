import type { Customer } from "./types";
import type { SharedMaintenanceInstallation } from "./shared-maintenance";

export type PhoneCallScope =
  | { type: "own"; workspaceId: string; customerId: string; appointmentId?: string }
  | { type: "shared"; workspaceId: string; grantId: string; installationId: string };

export type PhoneCallKind = "initiated" | "recorded";
export type PhoneCallRecord = {
  id: string;
  kind: PhoneCallKind;
  occurredAt: string;
  recordedAt: string;
  actorName: string;
  installationId?: string | null;
};

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function dateParts(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return Object.fromEntries(dateFormatter.formatToParts(date).map(part => [part.type, part.value]));
}

export function budapestPhoneCallInputValue(value: string | Date = new Date()) {
  const part = dateParts(value);
  return part ? `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}` : "";
}

export function formatPhoneCallTime(value: string) {
  const part = dateParts(value);
  return part ? `${part.year}.${part.month}.${part.day}. ${part.hour}:${part.minute}` : "";
}

/** datetime-local has no zone. Resolve Budapest explicitly; do not silently
 * normalize a spring DST gap or choose one of two autumn occurrences. */
export function budapestPhoneCallTimeToIso(value: string, now: Date = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Add meg a hívás dátumát és időpontját.");
  const [, year, month, day, hour, minute] = match;
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (new Date(wall).toISOString().slice(0, 16) !== value) throw new Error("Adj meg érvényes dátumot és időpontot.");
  const offsets = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const probe = new Date(wall + delta);
    const part = dateParts(probe)!;
    offsets.add(Date.UTC(Number(part.year), Number(part.month) - 1, Number(part.day), Number(part.hour), Number(part.minute)) - probe.getTime());
  }
  const candidates = Array.from(offsets).map(offset => new Date(wall - offset))
    .filter(candidate => budapestPhoneCallInputValue(candidate) === value);
  if (!candidates.length) throw new Error("Ez az időpont az óraátállítás miatt nem létezett. Ellenőrizd az időpontot.");
  if (candidates.length > 1) throw new Error("Ez az időpont az óraátállítás miatt nem egyértelmű. Ellenőrizd az időpontot.");
  if (candidates[0].getTime() > now.getTime()) throw new Error("Jövőbeli hívást még nem lehet rögzíteni.");
  return candidates[0].toISOString();
}

export function isPhoneCallRecord(value: unknown): value is PhoneCallRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && Boolean(record.id)
    && (record.kind === "initiated" || record.kind === "recorded")
    && typeof record.occurredAt === "string" && Boolean(formatPhoneCallTime(record.occurredAt))
    && typeof record.recordedAt === "string" && Boolean(formatPhoneCallTime(record.recordedAt))
    && typeof record.actorName === "string"
    && (record.installationId == null || typeof record.installationId === "string");
}

export function mergePhoneCallRecords(...groups: PhoneCallRecord[][]) {
  const records = new Map<string, PhoneCallRecord>();
  groups.flat().forEach(record => { if (isPhoneCallRecord(record)) records.set(record.id, record); });
  return Array.from(records.values()).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id));
}

export function phoneCallScopeKey(scope: PhoneCallScope) {
  return scope.type === "own" ? `${scope.workspaceId}:customer:${scope.customerId}`
    : `${scope.workspaceId}:shared:${scope.grantId}:${scope.installationId}`;
}

/** A maintenance appointment has its own ID: resolve its accepted source
 * installation before recording a call, without guessing across sources. */
export function resolveCustomerPhoneCallScope(workspaceId: string, customer: Customer,
  received: SharedMaintenanceInstallation[]): PhoneCallScope | undefined {
  if (!workspaceId || !customer.id || customer.id.startsWith("shared:")) return undefined;
  const own: PhoneCallScope = { type: "own", workspaceId, customerId: customer.id, appointmentId: customer.activeAppointmentId };
  const candidates = Array.from(new Map(received.filter(item => item.targetCustomerId === customer.id
    && item.targetInstallationId && item.grantId && item.installationId)
    .map(item => [`${item.grantId}:${item.installationId}`, item])).values());
  const scoped = (items: SharedMaintenanceInstallation[]): PhoneCallScope => items.length === 1
    ? { type: "shared", workspaceId, grantId: items[0].grantId, installationId: items[0].installationId } : own;
  const exact = candidates.filter(item => item.targetInstallationId === customer.activeAppointmentId);
  if (exact.length) return scoped(exact);
  const linkedIds = (customer.maintenanceInstallationIds || []).filter(Boolean);
  if (linkedIds.length) return scoped(candidates.filter(item => linkedIds.includes(item.targetInstallationId!)));
  // A different explicit installation is not a customer-level shared call.
  if (customer.activeAppointmentId && (!customer.appointmentType || customer.appointmentType === "installation")) return own;
  return scoped(candidates);
}
