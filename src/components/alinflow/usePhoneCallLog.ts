"use client";

import { useEffect, useState } from "react";
import type { PhoneCallRecord, PhoneCallScope } from "@/lib/alinflow/phone-calls";
import { mergePhoneCallRecords } from "@/lib/alinflow/phone-calls";
import { listPhoneCalls } from "@/lib/alinflow/phone-calls-client";

/** Fetch only for the open customer/dialog; stale sessions never expose a prior log. */
export function usePhoneCallLog(scopes: PhoneCallScope[], userId: string | undefined, revision: number) {
  const scopeKey = JSON.stringify(scopes);
  const key = `${userId || ""}:${scopeKey}:${revision}`;
  const [state, setState] = useState<{ key: string; records: PhoneCallRecord[]; loading: boolean; error?: string }>({ key: "", records: [], loading: false });
  useEffect(() => {
    let current = true;
    const requestedScopes = JSON.parse(scopeKey) as PhoneCallScope[];
    if (!userId || !requestedScopes.length) {
      setState({ key, records: [], loading: false });
      return;
    }
    setState({ key, records: [], loading: true });
    Promise.all(requestedScopes.map(scope => listPhoneCalls(scope))).then(lists => {
      if (!current) return;
      const records = mergePhoneCallRecords(...lists).slice(0, 100);
      setState({ key, records, loading: false });
    }).catch(error => {
      if (current) setState({ key, records: [], loading: false, error: error instanceof Error ? error.message : "A hívásnapló nem tölthető be." });
    });
    return () => { current = false; };
  }, [key, scopeKey, userId]);
  if (!userId || !scopes.length) return { records: [], loading: false };
  return state.key === key ? state : { records: [], loading: true };
}
