"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { countSmsSegments, normalizeSmsPhone, smsComposerHref, type SmsComposerPlatform } from "@/lib/alinflow/sms-reminders";
import type { MaintenanceContactSmsDraft, MaintenanceContactSmsTarget } from "@/lib/alinflow/maintenance-contact-sms";

const controlClass = "rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-40";

function composerPlatform(): SmsComposerPlatform | null {
  if (typeof navigator === "undefined") return null;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/i.test(navigator.userAgent) ? "android" : null;
}

export function MaintenanceContactSmsDialog({ workspaceId, userId, target, onClose }: {
  workspaceId: string; userId: string; target: MaintenanceContactSmsTarget; onClose: () => void;
}) {
  const identity = JSON.stringify([workspaceId, userId, target]);
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<MaintenanceContactSmsDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const live = useRef({ identity, draft, active: true });
  live.current = { identity, draft, active: true };
  const request = useRef<AbortController | null>(null);
  const platform = composerPlatform();

  useEffect(() => {
    dialog.current?.showModal();
    return () => { live.current.active = false; dialog.current?.close(); };
  }, []);

  useEffect(() => {
    let active = true;
    let lastRefresh = 0;
    async function load() {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      live.current.draft = null;
      setDraft(null); setLoading(true); setError(""); setNotice("");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error("A betöltés túl sokáig tartott. Próbáld újra."));
            controller.abort();
          }, 20_000);
        });
        const fetchDraft = async () => {
          const { data, error: sessionError } = await supabase.auth.getSession();
          if (!active || controller.signal.aborted || live.current.identity !== identity) throw new DOMException("Aborted", "AbortError");
          if (sessionError || !data.session?.access_token || data.session.user.id !== userId) {
            throw new Error("A bejelentkezés lejárt. Jelentkezz be újra.");
          }
          const query = new URLSearchParams({ workspaceId, ...target });
          const response = await fetch(`/api/maintenance-contact-sms?${query}`, {
            signal: controller.signal, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}` },
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload?.error || "Az SMS-előnézet nem tölthető be.");
          const next = payload?.draft;
          if (!next || typeof next.customerName !== "string" || typeof next.text !== "string" || !next.text.trim()
            || !(next.phone === null || (typeof next.phone === "string" && normalizeSmsPhone(next.phone) === next.phone))) {
            throw new Error("Az SMS-előnézet válasza hiányos. Próbáld újra.");
          }
          return { ...next, encoding: countSmsSegments(next.text) } as MaintenanceContactSmsDraft;
        };
        const next = await Promise.race([fetchDraft(), timeout]);
        if (active && request.current === controller && live.current.identity === identity && !controller.signal.aborted) setDraft(next);
      } catch (failure) {
        if (active && request.current === controller && live.current.identity === identity) {
          setError(failure instanceof Error ? failure.message : "Az SMS-előnézet nem tölthető be.");
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (active && request.current === controller) { request.current = null; setLoading(false); }
      }
    }
    const onVisible = () => {
      if (document.visibilityState !== "visible" || request.current || Date.now() - lastRefresh < 500) return;
      lastRefresh = Date.now();
      void load();
    };
    void load();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      request.current?.abort();
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [identity, refresh]); // Identity freezes the full recipient and workspace scope.

  function isCurrent(expected: MaintenanceContactSmsDraft) {
    return live.current.active && live.current.identity === identity && live.current.draft === expected && !request.current;
  }

  async function copyText() {
    if (!draft || !isCurrent(draft)) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(draft.text);
      if (isCurrent(draft)) setNotice("Szöveg kimásolva. Illeszd be a telefon Üzenetek alkalmazásába.");
    } catch {
      if (!isCurrent(draft)) return;
      preview.current?.focus(); preview.current?.select();
      setNotice("A másolás nem sikerült. Jelöld ki és másold ki kézzel a fenti szöveget.");
    }
  }

  const href = draft?.phone && platform ? smsComposerHref(draft.phone, draft.text, platform) : null;
  return <dialog ref={dialog} aria-label="SMS sikertelen hívás után" onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => event.stopPropagation()}
    className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-3xl border border-slate-200 bg-slate-50 p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60">
    <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white p-4 sm:p-5">
      <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Karbantartási megkeresés</p>
        <h2 className="mt-1 text-xl font-black">Nem vette fel?</h2>
        <p className="mt-2 text-sm leading-5 text-slate-600">Jelezd SMS-ben, miért kerested. A küldést a telefonodon hagyod jóvá.</p></div>
      <button type="button" onClick={onClose} aria-label="SMS-előnézet bezárása" className="shrink-0 rounded-xl px-3 py-2 text-lg font-bold text-slate-600">×</button>
    </div>
    <div className="space-y-4 p-4 sm:p-5">
      {loading ? <p role="status" className="py-6 text-center text-sm text-slate-500">SMS-előnézet betöltése…</p> : null}
      {error ? <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}
        <button type="button" onClick={() => setRefresh(value => value + 1)} className="ml-2 font-bold underline">Újrapróbálás</button></div> : null}
      {draft && !loading ? <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><p className="break-words font-black">{draft.customerName}</p>
            <p className="mt-1 break-all text-sm text-slate-600">{draft.phone || "Hiányzó vagy hibás telefonszám"}</p></div>
          <button type="button" onClick={() => setRefresh(value => value + 1)} className="text-xs font-bold text-emerald-700">Frissítés</button>
        </div>
        {!draft.phone ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Az SMS megnyitásához javítsd az ügyfél mentett telefonszámát.</p> : null}
        <label className="block text-sm font-bold text-slate-700">Az üzenet szövege
          <textarea ref={preview} readOnly rows={7} value={draft.text} aria-label="SMS szövege"
            style={{ "--form-field-background": "#ffffff", "--form-field-border": "#cbd5e1", opacity: 1 } as CSSProperties}
            className="mt-2 w-full resize-y rounded-2xl border border-slate-200 bg-white p-4 text-base font-normal leading-6 text-slate-800" /></label>
        <p className="text-xs text-slate-500">Becsült hossz: {draft.encoding.segments} SMS-rész · {draft.encoding.encoding}. A díjat a mobil-előfizetésed határozza meg.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {href ? <a href={href} onClick={event => { if (!isCurrent(draft)) event.preventDefault(); }}
            className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-black text-white">Megnyitás az Üzenetekben</a> : null}
          <button type="button" onClick={() => void copyText()} className={controlClass}>Szöveg másolása</button>
        </div>
        {!platform ? <p className="text-xs leading-5 text-slate-500">Telefonon az Üzenetek alkalmazásban nyílik meg. Itt a szöveget tudod kimásolni.</p> : null}
        {notice ? <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{notice}</p> : null}
      </> : null}
    </div>
  </dialog>;
}
