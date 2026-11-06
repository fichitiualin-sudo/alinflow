"use client";

import { supabase } from "@/lib/supabase";
import { isPhoneCallRecord, mergePhoneCallRecords, type PhoneCallKind, type PhoneCallRecord, type PhoneCallScope } from "./phone-calls";

function scopeParameters(scope: PhoneCallScope) {
  if (!scope.workspaceId || (scope.type === "own" ? !scope.customerId || scope.customerId.startsWith("shared:") : !scope.grantId || !scope.installationId)) {
    throw new Error("A híváshoz tartozó ügyfél nem azonosítható. Nyisd meg újra az ügyfelet.");
  }
  return scope.type === "own" ? { p_workspace_id: scope.workspaceId, p_customer_id: scope.customerId }
    : { p_workspace_id: scope.workspaceId, p_grant_id: scope.grantId, p_installation_id: scope.installationId };
}

async function call(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") throw new Error("A hívásnapló még nincs bekapcsolva ezen a szerveren.");
    if (error.code === "42501") throw new Error("Az ügyfélhez már nincs aktív hozzáférésed. Frissítsd az adatokat.");
    if (error.code === "22023") throw new Error("Ellenőrizd a hívás dátumát és időpontját; jövőbeli hívás nem rögzíthető.");
    throw new Error("A hívásnapló művelete nem sikerült. Próbáld újra.");
  }
  return data;
}

export async function listPhoneCalls(scope: PhoneCallScope): Promise<PhoneCallRecord[]> {
  const rows = await call(scope.type === "own" ? "list_customer_phone_calls" : "list_shared_maintenance_phone_calls", scopeParameters(scope));
  if (!Array.isArray(rows) || rows.length > 100 || !rows.every(isPhoneCallRecord)) throw new Error("A hívásnapló válasza nem olvasható. Frissítsd az adatokat.");
  return mergePhoneCallRecords(rows);
}

export async function recordPhoneCall(scope: PhoneCallScope, kind: PhoneCallKind, occurredAt?: string, requestId = crypto.randomUUID()): Promise<PhoneCallRecord> {
  if ((kind !== "initiated" && kind !== "recorded") || (kind === "initiated" && occurredAt != null)
    || (kind === "recorded" && (!occurredAt || !Number.isFinite(Date.parse(occurredAt)) || Date.parse(occurredAt) > Date.now()))) {
    throw new Error("Add meg a hívás érvényes, nem jövőbeli időpontját.");
  }
  const saved = await call(scope.type === "own" ? "record_customer_phone_call" : "record_shared_maintenance_phone_call", {
    ...scopeParameters(scope), ...(scope.type === "own" ? { p_appointment_id: scope.appointmentId || null } : {}),
    p_kind: kind, p_occurred_at: kind === "recorded" ? occurredAt : null, p_request_id: requestId,
  });
  if (!isPhoneCallRecord(saved) || saved.id !== requestId || saved.kind !== kind
    || (kind === "recorded" && Date.parse(saved.occurredAt) !== Date.parse(occurredAt!))
    || (scope.type === "shared" && saved.installationId !== scope.installationId)) {
    throw new Error("A hívás rögzítése nem igazolható. Frissítsd a hívásnaplót.");
  }
  return saved;
}
