import { ApiError } from "./server-auth";

const MAX_DELIVERY_AGE_MS = 23 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CalendarEmailAuthorization = {
  workspaceId: string;
  appointment: { id?: unknown; appointment_type?: unknown } | null;
};

export type CalendarEmailDelivery = {
  createdAt: string;
  idempotencyKey: string;
};

export const CALENDAR_EMAIL_CONFLICT_MESSAGE = "A korábbi naptáras emailküldés tartalma megváltozott vagy még feldolgozás alatt áll. Új küldés előtt ellenőrizd az előző küldés eredményét.";

// The caller keeps one frozen delivery per calendar job. Resend retains keys
// for 24 hours; the shorter retry window leaves room for clock/network skew.
export function calendarEmailDeliveryForRequest(
  body: { calendarEmailDelivery?: unknown },
  authorization: CalendarEmailAuthorization,
  kind: "quote" | "appointment",
  now = Date.now(),
): CalendarEmailDelivery | null {
  if (body.calendarEmailDelivery === undefined) return null;
  const delivery = body.calendarEmailDelivery;
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) {
    throw new ApiError("A naptáras emailküldés azonosítója hibás.", 400);
  }
  const { id, createdAt } = delivery as Record<string, unknown>;
  if (typeof id !== "string" || !UUID.test(id)) {
    throw new ApiError("A naptáras emailküldés azonosítója hibás.", 400);
  }
  const timestampMatch = typeof createdAt === "string"
    ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(createdAt)
    : null;
  const timestamp = timestampMatch ? Date.parse(String(createdAt)) : NaN;
  const normalizedCreatedAt = timestampMatch ? `${timestampMatch[1]}.${(timestampMatch[2] || "").padEnd(3, "0")}Z` : "";
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== normalizedCreatedAt) {
    throw new ApiError("A naptáras emailküldés időbélyege hibás.", 400);
  }
  if (timestamp > now + MAX_FUTURE_SKEW_MS) {
    throw new ApiError("A naptáras emailküldés időbélyege a jövőben van. Ellenőrizd az eszköz óráját.", 400);
  }
  if (now - timestamp > MAX_DELIVERY_AGE_MS) {
    throw new ApiError("A naptáras emailküldés biztonságos újrapróbálási ideje lejárt. Új küldés előtt ellenőrizd a korábbi küldés eredményét.", 409);
  }
  const appointmentId = authorization.appointment?.id;
  if (typeof appointmentId !== "string" || !appointmentId || !authorization.workspaceId) {
    throw new ApiError("A naptáras emailküldéshez mentett, ellenőrzött időpont szükséges.", 400);
  }
  if (kind === "quote" && authorization.appointment?.appointment_type !== "installation") {
    throw new ApiError("A naptárból árajánlat csak szerelési időponthoz küldhető.", 400);
  }
  return {
    createdAt: normalizedCreatedAt,
    idempotencyKey: `alinflow-calendar/${authorization.workspaceId}/${appointmentId}/${kind}/${id.toLowerCase()}`,
  };
}
