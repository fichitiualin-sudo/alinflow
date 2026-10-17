"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { smsComposerHref, smsReminderToday, type SmsComposerPlatform, type SmsReminderDays } from "@/lib/alinflow/sms-reminders";
import type { SmsReminderEntry } from "@/lib/alinflow/sms-reminders-client";

type Props = {
  workspaceId: string;
  userId: string;
  appointmentId?: string;
  customerId?: string;
  disabled?: boolean;
  compact?: boolean;
  calendarCard?: boolean;
};

const PAGE_SIZE = 10;
const TYPE_LABELS = { installation: "Szerelés", maintenance: "Karbantartás", survey: "Felmérés", other: "Egyéb munka" };
const controlClass = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40";

function composerPlatform(): SmsComposerPlatform | null {
  if (typeof navigator === "undefined") return null;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/i.test(navigator.userAgent) ? "android" : null;
}

function entryKey(entry: SmsReminderEntry) {
  return `${entry.appointmentId}:${entry.contentKey}`;
}

function displayDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("hu-HU", { timeZone: "UTC", month: "long", day: "numeric", weekday: "long" }).format(date)
    : value;
}

export function AppointmentSmsRemindersButton({ workspaceId, userId, appointmentId, customerId, disabled, compact, calendarCard }: Props) {
  const identity = JSON.stringify([workspaceId, userId, appointmentId || "", customerId || ""]);
  const [openIdentity, setOpenIdentity] = useState<string | null>(null);
  const [days, setDays] = useState<SmsReminderDays>(1);
  const [entries, setEntries] = useState<SmsReminderEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loadedDay, setLoadedDay] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prepared, setPrepared] = useState<Record<string, boolean>>({});
  const [manualCopy, setManualCopy] = useState<Record<string, boolean>>({});
  const [copyMessages, setCopyMessages] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const open = openIdentity === identity;
  const live = useRef({ identity, open, entries, loadedDay, loading });
  live.current = { identity, open, entries, loadedDay, loading };
  const loadController = useRef<AbortController | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const saveLock = useRef(false);
  const requestVersion = useRef(0);
  const lastFocusRefreshAt = useRef(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previewRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const platform = composerPlatform();

  function current(expectedIdentity: string) {
    return live.current.open && live.current.identity === expectedIdentity;
  }

  function currentEntry(entry: SmsReminderEntry) {
    return current(identity) && !live.current.loading
      && live.current.loadedDay === smsReminderToday()
      && live.current.entries.some((candidate) => entryKey(candidate) === entryKey(entry));
  }

  async function authenticatedFetch(url: string, signal: AbortSignal, body?: object) {
    const controller = new AbortController();
    let rejectInterrupted: (reason: Error) => void = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
    const onAbort = () => {
      controller.abort();
      rejectInterrupted(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const timeout = window.setTimeout(() => {
      controller.abort();
      rejectInterrupted(new Error(body
        ? "A jelölés visszaigazolása nem érkezett meg. Frissítsd az előnézetet az állapot ellenőrzéséhez."
        : "A betöltés túl sokáig tartott. Próbáld újra."));
    }, 20_000);
    const request = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (signal.aborted || controller.signal.aborted || !current(identity)) throw new DOMException("Aborted", "AbortError");
      if (sessionError || !data.session?.access_token || data.session.user.id !== userId) {
        throw new Error("A bejelentkezés lejárt. Jelentkezz be újra.");
      }
      const response = await fetch(url, {
        method: body ? "POST" : "GET", signal: controller.signal, cache: "no-store",
        headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { response, payload: await response.json() };
    };
    try {
      if (signal.aborted) onAbort();
      return await Promise.race([request(), interrupted]);
    } finally {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
    }
  }

  useEffect(() => {
    setOpenIdentity(null);
    setEntries([]);
    setPrepared({});
    setManualCopy({});
    setCopyMessages({});
    setError("");
    setNotice("");
    setLoadedDay("");
    setDays(1);
    setPage(0);
    return () => {
      loadController.current?.abort();
      saveController.current?.abort();
      saveLock.current = false;
    };
  }, [identity]);

  useEffect(() => {
    if (!open) return;
    const expectedIdentity = identity;
    async function load() {
      loadController.current?.abort();
      saveController.current?.abort();
      saveLock.current = false;
      setSaving(null);
      const controller = new AbortController();
      loadController.current = controller;
      const version = ++requestVersion.current;
      const dayAtStart = smsReminderToday();
      setLoading(true);
      setError("");
      const query = new URLSearchParams({ workspaceId });
      if (appointmentId) {
        query.set("appointmentId", appointmentId);
        if (customerId) query.set("customerId", customerId);
      } else query.set("days", String(days));
      try {
        const { response, payload } = await authenticatedFetch(`/api/sms-reminders?${query}`, controller.signal);
        if (controller.signal.aborted || !current(expectedIdentity) || version !== requestVersion.current) return;
        if (!response.ok) throw new Error(payload?.error || "Az SMS-emlékeztetők nem tölthetők be.");
        if (!Array.isArray(payload?.entries)) throw new Error("Az SMS-előnézet válasza hiányos. Próbáld újra.");
        // A request crossing local midnight must not unlock yesterday's text.
        if (dayAtStart !== smsReminderToday()) {
          setEntries([]);
          setLoadedDay("");
          setError("Közben új nap kezdődött. Frissítsd az emlékeztetőket.");
          return;
        }
        const next = payload.entries as SmsReminderEntry[];
        const keys = new Set(next.map(entryKey));
        setEntries(next);
        setSelectedDate(typeof payload.date === "string" ? payload.date : "");
        setLoadedDay(dayAtStart);
        setPrepared((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => keys.has(key))));
        setManualCopy({});
        setCopyMessages({});
        setPage((previous) => Math.min(previous, Math.max(0, Math.ceil(next.length / PAGE_SIZE) - 1)));
      } catch (caught) {
        if (!controller.signal.aborted && current(expectedIdentity) && version === requestVersion.current) {
          setEntries([]);
          setLoadedDay("");
          setError(caught instanceof Error ? caught.message : "Az SMS-emlékeztetők nem tölthetők be.");
        }
      } finally {
        if (!controller.signal.aborted && current(expectedIdentity) && version === requestVersion.current) setLoading(false);
        if (loadController.current === controller) loadController.current = null;
      }
    }
    const onVisible = () => {
      const now = Date.now();
      if (document.visibilityState !== "visible" || saveLock.current || loadController.current
        || now - lastFocusRefreshAt.current < 500) return;
      lastFocusRefreshAt.current = now;
      void load();
    };
    void load();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      loadController.current?.abort();
      saveController.current?.abort();
      saveLock.current = false;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Each effect owns the full request lifecycle for its frozen scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identity, days, refresh]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpenIdentity(null);
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], textarea, [tabindex='0']"));
      if (!controls.length) { event.preventDefault(); dialogRef.current.focus(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, identity]);

  function requireFresh(entry: SmsReminderEntry) {
    if (currentEntry(entry)) return true;
    setNotice("Az előnézet frissítése szükséges. Ellenőrizd az aktuális időpontot és szöveget.");
    setRefresh((previous) => previous + 1);
    return false;
  }

  function selectDay(day: SmsReminderDays) {
    if (day === days) return;
    setEntries([]);
    setLoadedDay("");
    setDays(day);
    setPage(0);
    setNotice("");
  }

  async function copyText(entry: SmsReminderEntry) {
    if (!requireFresh(entry)) return;
    const key = entryKey(entry);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(entry.text);
      if (!currentEntry(entry)) return;
      setPrepared((previous) => ({ ...previous, [key]: true }));
      setManualCopy((previous) => ({ ...previous, [key]: false }));
      setCopyMessages((previous) => ({ ...previous, [key]: "Szöveg kimásolva. Illeszd be a telefon Üzenetek alkalmazásába." }));
    } catch {
      if (!currentEntry(entry)) return;
      previewRefs.current[key]?.focus();
      previewRefs.current[key]?.select();
      setManualCopy((previous) => ({ ...previous, [key]: true }));
      setCopyMessages((previous) => ({ ...previous, [key]: "A másolás nem sikerült. Jelöld ki és másold ki kézzel a fenti szöveget." }));
    }
  }

  async function acknowledge(entry: SmsReminderEntry) {
    const key = entryKey(entry);
    if (!requireFresh(entry) || !entry.phone || !prepared[key] || saveLock.current
      || (entry.acknowledgedAt && !entry.changedSinceAcknowledgement)) return;
    saveLock.current = true;
    setSaving(key);
    setError("");
    const controller = new AbortController();
    saveController.current = controller;
    try {
      const { response, payload } = await authenticatedFetch("/api/sms-reminders", controller.signal, {
        workspaceId, customerId: entry.customerId, appointmentId: entry.appointmentId, contentKey: entry.contentKey,
      });
      if (controller.signal.aborted || !current(identity)) return;
      if (response.status === 409) {
        setNotice("Az időpont vagy az üzenet megváltozott. Frissítettük az előnézetet; ellenőrizd újra.");
        setPrepared((previous) => ({ ...previous, [key]: false }));
        setRefresh((previous) => previous + 1);
        return;
      }
      if (!response.ok) throw new Error(payload?.error || "Az elküldés jelölése nem menthető. Próbáld újra.");
      if (typeof payload?.acknowledgedAt !== "string" || !Number.isFinite(Date.parse(payload.acknowledgedAt))) {
        throw new Error("A mentés nem adott vissza érvényes visszaigazolást. Frissítsd az előnézetet.");
      }
      setEntries((previous) => previous.map((candidate) => entryKey(candidate) === key
        ? { ...candidate, acknowledgedAt: payload.acknowledgedAt, changedSinceAcknowledgement: false }
        : candidate));
      setNotice("Az „Elküldtem” visszajelzés mentve.");
    } catch (caught) {
      if (!controller.signal.aborted && current(identity)) setError(caught instanceof Error ? caught.message : "A jelölés nem menthető.");
    } finally {
      if (saveController.current === controller) {
        saveLock.current = false;
        saveController.current = null;
        if (current(identity)) setSaving(null);
      }
    }
  }

  const visibleEntries = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const buttonLabel = appointmentId ? "SMS-emlékeztető" : "SMS-emlékeztetők";
  return <>
    <button type="button" disabled={disabled || !workspaceId || !userId}
      title={calendarCard ? buttonLabel : undefined} aria-label={calendarCard ? buttonLabel : undefined}
      onClick={(event) => {
      event.stopPropagation();
      setLoading(true);
      setError(""); setNotice(""); setPage(0); setPrepared({}); setManualCopy({}); setCopyMessages({});
      setEntries([]); setLoadedDay(""); setSelectedDate(""); setOpenIdentity(identity);
    }} className={calendarCard
      ? "inline-flex shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/20 px-2 py-1 text-[10px] font-black text-emerald-100 transition hover:bg-emerald-400/30 disabled:opacity-40"
      : `${controlClass} ${compact ? "!px-2 !py-1.5 !text-xs" : ""}`}>
      {calendarCard ? "SMS" : buttonLabel}
    </button>
    {open && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-2 sm:p-4" onClick={(event) => {
      event.stopPropagation();
      if (event.target === event.currentTarget) setOpenIdentity(null);
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={buttonLabel} tabIndex={-1}
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl outline-none sm:max-h-[calc(100dvh-2rem)]">
        <div className="shrink-0 border-b border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><h2 className="text-lg font-black text-slate-900">{buttonLabel}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-600">A küldést a telefonodon hagyod jóvá. Az „Elküldtem” a saját visszajelzésedet menti.</p></div>
            <button type="button" aria-label="SMS-előnézet bezárása" onClick={() => setOpenIdentity(null)} className={controlClass}>Bezárás</button>
          </div>
          {!appointmentId && <div role="tablist" aria-label="Emlékeztető napja" className="mt-3 flex gap-2" onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const nextDay = (event.key === "Home" ? 1 : event.key === "End" ? 3
              : (days + (event.key === "ArrowRight" ? 1 : -1) + 2) % 3 + 1) as SmsReminderDays;
            selectDay(nextDay);
            event.currentTarget.querySelector<HTMLButtonElement>(`[data-sms-day="${nextDay}"]`)?.focus();
          }}>
            {([1, 2, 3] as const).map((day) => <button key={day} role="tab" type="button" aria-selected={days === day} data-sms-day={day} tabIndex={days === day ? 0 : -1}
              onClick={() => selectDay(day)} className={`${controlClass} flex-1 !px-2 !text-xs ${days === day ? "!border-emerald-600 !bg-emerald-50 !text-emerald-800" : ""}`}>
              {day === 1 ? "Holnap" : `${day} nap múlva`}
            </button>)}
          </div>}
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
            <span>{selectedDate ? displayDate(selectedDate) : "Mentett időpontok"}</span>
            <button type="button" disabled={loading || Boolean(saving)} onClick={() => setRefresh((previous) => previous + 1)} className="font-bold text-emerald-700 disabled:opacity-40">Frissítés</button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto p-3 sm:p-4">
          {notice && <p role="status" className="mb-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{notice}</p>}
          {error && <div role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}
            <button type="button" onClick={() => setRefresh((previous) => previous + 1)} className="ml-2 font-bold underline">Újrapróbálás</button>
          </div>}
          {loading ? <p role="status" className="py-8 text-center text-sm text-slate-500">Emlékeztetők betöltése…</p>
            : !entries.length && !error ? <p className="py-8 text-center text-sm text-slate-500">{appointmentId
              ? "Ehhez az időponthoz jelenleg nem készíthető SMS-emlékeztető."
              : "Erre a napra nincs elküldhető emlékeztető."}</p>
            : <div className="space-y-3">{visibleEntries.map((entry) => {
              const key = entryKey(entry);
              const acknowledged = Boolean(entry.acknowledgedAt && !entry.changedSinceAcknowledgement);
              const href = platform && entry.phone ? smsComposerHref(entry.phone, entry.text, platform) : null;
              return <article key={key} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
                <h3 className="break-words font-black text-slate-900">{entry.customerName}</h3>
                <p className="mt-1 text-xs text-slate-500">{TYPE_LABELS[entry.appointmentType]} · {displayDate(entry.date)} · Érkezés: {entry.arrivalWindow}</p>
                <p className="mt-2 break-all text-sm font-bold text-slate-700">{entry.phone || "Hiányzó vagy hibás telefonszám"}</p>
                {!entry.phone && <p className="mt-1 text-xs text-amber-800">Az SMS megnyitásához javítsd az ügyfél mentett telefonszámát.</p>}
                {entry.changedSinceAcknowledgement && <p role="status" className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">A korábbi jelölés óta változott az időpont vagy az üzenet. Ellenőrizd az új emlékeztetőt.</p>}
                {acknowledged && <p className="mt-2 text-xs font-bold text-emerald-700">Elküldöttnek jelölted · {new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(entry.acknowledgedAt!))}</p>}
                <textarea readOnly value={entry.text} ref={(element) => { previewRefs.current[key] = element; }}
                  aria-label={`${entry.customerName} SMS-előnézete`} rows={5}
                  className="mt-3 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-800 focus:border-emerald-500 focus:outline-none" />
                <p className="mt-1 text-xs text-slate-500">Becsült hossz: {entry.encoding.segments} SMS-rész{entry.encoding.encoding === "UCS-2" ? " · ékezetes szöveg" : ""}</p>
                {!platform && <p className="mt-2 text-xs text-slate-500">Másold a szöveget, majd illeszd be a telefon Üzenetek alkalmazásába.</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {href && <a href={href} onClick={(event) => {
                    if (saving || !requireFresh(entry)) { event.preventDefault(); return; }
                    setPrepared((previous) => ({ ...previous, [key]: true }));
                    setCopyMessages((previous) => ({ ...previous, [key]: "A küldést a telefon Üzenetek alkalmazásában fejezd be." }));
                  }} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white">SMS megnyitása</a>}
                  <button type="button" disabled={Boolean(saving)} onClick={() => void copyText(entry)} className={controlClass}>Szöveg másolása</button>
                  <button type="button" disabled={!entry.phone || !prepared[key] || acknowledged || Boolean(saving)}
                    onClick={() => void acknowledge(entry)} className={controlClass}>{saving === key ? "Jelölés mentése…" : "Elküldtem"}</button>
                </div>
                {copyMessages[key] && <p role="status" className="mt-2 text-xs text-slate-600">{copyMessages[key]}</p>}
                {manualCopy[key] && <button type="button" className={`${controlClass} mt-2`} onClick={() => {
                  if (!requireFresh(entry)) return;
                  setPrepared((previous) => ({ ...previous, [key]: true }));
                  setManualCopy((previous) => ({ ...previous, [key]: false }));
                  setCopyMessages((previous) => ({ ...previous, [key]: "Kézi másolás visszajelezve. A telefonodon küldd el az SMS-t." }));
                }}>Kimásoltam a szöveget</button>}
              </article>;
            })}</div>}
          {!loading && entries.length > PAGE_SIZE && <nav aria-label="SMS-emlékeztetők lapozása" className="mt-4 flex items-center justify-between gap-2">
            <button type="button" disabled={page === 0} onClick={() => setPage((previous) => previous - 1)} className={controlClass}>Előző</button>
            <span className="text-xs text-slate-500">{page + 1} / {pageCount} · {entries.length} időpont</span>
            <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((previous) => previous + 1)} className={controlClass}>Következő</button>
          </nav>}
        </div>
      </div>
    </div>, document.body)}
  </>;
}
