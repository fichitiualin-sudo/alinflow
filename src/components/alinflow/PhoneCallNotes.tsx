"use client";

import { useState, type ReactNode } from "react";
import { budapestPhoneCallInputValue, budapestPhoneCallTimeToIso, formatPhoneCallTime, mergePhoneCallRecords, type PhoneCallRecord } from "@/lib/alinflow/phone-calls";

export function PhoneCallNotes({ records, legacyLastCalledAt, busy = false, loading = false, error, onRecord, children }: {
  records: PhoneCallRecord[];
  legacyLastCalledAt?: string;
  busy?: boolean;
  loading?: boolean;
  error?: string;
  onRecord?: (occurredAt: string) => Promise<void> | void;
  children?: ReactNode;
}) {
  const [manualTime, setManualTime] = useState("");
  const [manualError, setManualError] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const sorted = mergePhoneCallRecords(records);
  const visible = expanded ? sorted : sorted.slice(0, 5);
  const legacyLabel = legacyLastCalledAt && formatPhoneCallTime(legacyLastCalledAt);
  const showLegacy = legacyLabel && !sorted.some(record => Date.parse(record.occurredAt) === Date.parse(legacyLastCalledAt!));
  const disabled = busy || saving || loading;

  async function saveManualCall() {
    if (disabled || !onRecord) return;
    setManualError("");
    try {
      const occurredAt = budapestPhoneCallTimeToIso(manualTime);
      setSaving(true);
      await onRecord(occurredAt);
      setManualTime("");
    } catch (failure) {
      setManualError(failure instanceof Error ? failure.message : "A hívás rögzítése nem sikerült.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="mt-3 space-y-3">
    {children}
    {visible.length || showLegacy ? <ul className="space-y-1.5 text-sm text-slate-300" aria-label="Hívásnapló">
      {visible.map(record => <li key={record.id} className="break-words">
        <span className="font-bold">{record.kind === "initiated" ? "Hívás indítva" : "Hívás rögzítve"}: </span>
        <time dateTime={record.occurredAt}>{formatPhoneCallTime(record.occurredAt)}</time>
        {record.actorName ? <span className="text-slate-400"> · {record.actorName}</span> : null}
      </li>)}
      {showLegacy ? <li>Korábbi hívásrögzítés: <time dateTime={legacyLastCalledAt}>{legacyLabel}</time></li> : null}
    </ul> : null}
    {sorted.length > 5 ? <button type="button" onClick={() => setExpanded(value => !value)} className="rounded-xl px-2 py-1 text-sm font-bold text-cyan-200">
      {expanded ? "Kevesebb" : `Korábbi hívások (${sorted.length - 5})`}
    </button> : null}
    {loading ? <p className="text-sm text-slate-400" role="status">Hívásnapló betöltése…</p> : null}
    {error ? <p className="text-sm font-bold text-amber-200" role="alert">{error}</p> : null}
    {onRecord ? <details className="rounded-xl border border-white/10 p-3">
      <summary className="cursor-pointer text-sm font-bold text-cyan-200">Korábbi hívás rögzítése</summary>
      <div className="mt-3 flex min-w-0 flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm font-bold">Hívás időpontja
          <input type="datetime-local" value={manualTime} max={budapestPhoneCallInputValue()} disabled={disabled}
            onInput={event => { setManualTime(event.currentTarget.value); setManualError(""); }}
            onChange={event => { setManualTime(event.target.value); setManualError(""); }}
            className="input mt-1 min-w-0 w-full" aria-label="Hívás időpontja (budapesti idő)" />
        </label>
        <button type="button" onClick={() => void saveManualCall()} disabled={disabled}
          className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-50">{saving || busy ? "Mentés…" : "Rögzítés"}</button>
      </div>
      {manualError ? <p className="mt-2 text-sm font-bold text-amber-200" role="alert">{manualError}</p> : null}
    </details> : null}
  </div>;
}
