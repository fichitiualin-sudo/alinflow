"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PrivacyParty } from "@/lib/alinflow/privacy-notice";
import type { PrivacyPartnerCandidate } from "@/lib/alinflow/privacy-partner";
import { lookupPrivacyPartners } from "@/lib/alinflow/privacy-partner-client";

type PrivacyPartnerPickerProps = {
  workspaceId?: string;
  value: PrivacyParty;
  partnerUserId?: string;
  partnerWorkspaceId?: string;
  disabled?: boolean;
  onSelect: (candidate: PrivacyPartnerCandidate | null) => void;
};

function PartnerDetails({ party }: { party: PrivacyParty }) {
  return <div className="min-w-0 space-y-1 break-words text-sm text-slate-300">
    <p className="font-black text-slate-100">{party.legalName || "Nincs vállalkozásnév"}</p>
    {party.address ? <p>{party.address}</p> : null}
    {party.taxNumber ? <p>Adószám: {party.taxNumber}</p> : null}
    {party.email ? <p>{party.email}</p> : null}
    {party.phone ? <p>{party.phone}</p> : null}
  </div>;
}

export function PrivacyPartnerPicker({ workspaceId, value, partnerUserId, partnerWorkspaceId, disabled = false, onSelect }: PrivacyPartnerPickerProps) {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [candidates, setCandidates] = useState<PrivacyPartnerCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const requestSequence = useRef(0);
  const mounted = useRef(true);
  const hasPartner = Object.values(value).some(Boolean);
  const hasLinkedPartner = Boolean(partnerUserId && partnerWorkspaceId);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
    };
  }, []);

  function changeEmail(next: string) {
    requestSequence.current += 1;
    setEmail(next);
    setCandidates(null);
    setSearching(false);
    setError("");
    setFeedback("");
  }

  async function search() {
    if (disabled || !workspaceId || searching) return;
    const query = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query)) {
      setError("Add meg az AlinFlow-fiók teljes email-címét.");
      return;
    }
    const requestId = ++requestSequence.current;
    setSearching(true);
    setCandidates(null);
    setError("");
    setFeedback("");
    try {
      const result = await lookupPrivacyPartners(workspaceId, query);
      if (!mounted.current || requestId !== requestSequence.current) return;
      setCandidates(result);
    } catch (cause) {
      if (!mounted.current || requestId !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : "A partner keresése nem sikerült. Próbáld újra.");
    } finally {
      if (mounted.current && requestId === requestSequence.current) setSearching(false);
    }
  }

  function select(candidate: PrivacyPartnerCandidate | null) {
    if (disabled || (candidate && candidate.issues.length > 0)) return;
    onSelect(candidate);
    setFeedback(candidate ? "Partner kiválasztva. Véglegesítéshez mentsd a beállításokat." : "Partner eltávolítva. Véglegesítéshez mentsd a beállításokat.");
  }

  return <fieldset disabled={disabled} className="min-w-0 space-y-4 rounded-2xl border border-white/10 p-4">
    <legend className="px-2 font-black">Karbantartó partner – opcionális</legend>
    {hasPartner ? <div className="space-y-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/5 p-4">
      <p className="text-xs font-black uppercase tracking-wide text-cyan-200">{hasLinkedPartner ? "Kiválasztott AlinFlow-partner" : "Korábban megadott partner"}</p>
      <PartnerDetails party={value} />
      <button type="button" onClick={() => select(null)} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-black text-slate-100 disabled:cursor-not-allowed disabled:opacity-50">Partner eltávolítása</button>
    </div> : <p className="text-sm text-slate-300">Még nincs kijelölt karbantartó partner.</p>}
    <div className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-end">
      <label htmlFor={emailId} className="min-w-0 flex-1">
        <span className="text-sm font-bold text-slate-300">AlinFlow-fiók email-címe</span>
        <input id={emailId} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={254}
          value={email} onChange={(event) => changeEmail(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }}
          className="mt-2 w-full min-w-0 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-slate-50 outline-none transition focus:border-cyan-300" />
      </label>
      <button type="button" disabled={disabled || searching || !workspaceId || !email.trim()} onClick={() => void search()} className="shrink-0 rounded-2xl bg-cyan-300 px-4 py-3 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{searching ? "Keresés..." : "Keresés"}</button>
    </div>
    {!workspaceId ? <p className="text-sm text-slate-400">A partner kiválasztásához nyiss meg egy munkaterületet.</p> : null}
    {error ? <p role="alert" className="rounded-xl border border-red-300/30 bg-red-300/10 p-3 text-sm font-bold text-red-200">{error}</p> : null}
    {candidates?.length === 0 ? <p role="status" className="text-sm text-slate-300">Ezzel az email-címmel nincs kiválasztható AlinFlow-partner.</p> : null}
    {candidates?.length ? <div className="space-y-3" aria-label="Talált karbantartó partnerek">
      {candidates.map((candidate) => {
        const selected = candidate.userId === partnerUserId && candidate.workspaceId === partnerWorkspaceId;
        return <div key={`${candidate.userId}:${candidate.workspaceId}`} className={`min-w-0 space-y-3 rounded-2xl border p-4 ${selected ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/10 bg-slate-950/40"}`}>
          <p className="break-words text-sm font-black text-cyan-200">{candidate.workspaceName}</p>
          <PartnerDetails party={candidate.party} />
          {candidate.issues.length ? <div className="text-sm text-amber-200">
            <p className="font-bold">A partner saját beállításaiban még szükséges:</p>
            <ul className="mt-1 list-inside list-disc space-y-1">{candidate.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          </div> : null}
          <button type="button" disabled={disabled || candidate.issues.length > 0} onClick={() => select(candidate)} className="rounded-xl bg-cyan-300 px-3 py-2 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{selected ? "Partneradatok frissítése" : "Kiválasztás"}</button>
        </div>;
      })}
    </div> : null}
    {feedback ? <p role="status" className="text-sm font-bold text-cyan-200">{feedback}</p> : null}
    <p className="text-sm text-slate-400">A partner az új adatkezelési nyilatkozatokban jelenik meg. A korábban aláírt dokumentumok változatlanok maradnak. Kiválasztása önmagában nem ad hozzáférést az ügyfelekhez.</p>
  </fieldset>;
}
