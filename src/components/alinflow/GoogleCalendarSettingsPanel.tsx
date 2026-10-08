"use client";

import { useEffect, useRef, useState } from "react";
import { refreshGoogleCalendarConnection, requestGoogleCalendar, type GoogleCalendarStatus } from "@/components/alinflow/GoogleCalendarSync";

const buttonClass = "min-h-11 rounded-2xl px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50";

export function GoogleCalendarSettingsPanel({ workspaceId, userId, status, loading, error, returnMessage }: {
  workspaceId: string;
  userId: string;
  status: GoogleCalendarStatus | null;
  loading: boolean;
  error: string;
  returnMessage?: string;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);

  useEffect(() => { setEmail(status?.email || ""); }, [status?.email]);
  useEffect(() => () => { request.current?.abort(); }, [workspaceId, userId]);

  async function changeConnection(path: "connect" | "disconnect") {
    if (request.current || !status?.canManage) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage("");
    try {
      const result = await requestGoogleCalendar<{ url?: string }>(path, workspaceId, userId, controller.signal, path === "connect" ? { email: email.trim().toLowerCase() } : {});
      if (controller.signal.aborted) return;
      if (path === "connect") {
        const destination = new URL(result.url || "");
        if (destination.origin !== "https://accounts.google.com") throw new Error("Az engedélyezési oldal most nem nyitható meg. Próbáld újra.");
        window.location.assign(destination.href);
      } else {
        setMessage("A szinkronizálás szünetel. A már meglévő naptáresemények megmaradtak.");
        refreshGoogleCalendarConnection(workspaceId);
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "A naptárkapcsolat módosítása nem sikerült.");
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  const notice = message || returnMessage;
  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-4" aria-labelledby="google-calendar-title">
      <h3 id="google-calendar-title" className="text-xl font-black">Google Naptár</h3>
      {loading ? <p className="text-sm text-slate-300">Naptárkapcsolat ellenőrzése…</p> : null}
      {status && !status.configured ? <p className="text-sm text-slate-300">Az automatikus Google Naptár-kapcsolat előkészítése még folyamatban van.</p> : null}
      {status?.configured ? (
        <>
          <div className="space-y-1 text-sm">
            <p className={`font-black ${status.connected ? "text-emerald-200" : "text-amber-200"}`}>
              {status.connected ? "Automatikus naptármentés bekapcsolva" : status.status === "paused" ? "Szinkronizálás szüneteltetve" : status.status === "reauth_required" ? "Új Google-engedélyezés szükséges" : "Még nincs összekapcsolva"}
            </p>
            {status.email ? <p className="break-all text-slate-200">{status.email}{status.calendarName ? ` · ${status.calendarName}` : ""}</p> : null}
            <p className="text-slate-300">Az összekapcsolás után létrehozott időpontok automatikusan bekerülnek a naptárba. Módosításuk és lemondásuk is követi az AlinFlow-t.</p>
            <p className="text-slate-400">A korábbi, kézzel felvett eseményeket nem tölti át újra.</p>
            {status.pending > 0 ? <p className="font-bold text-amber-200">{status.pending} időpont naptárfrissítése várakozik.</p> : null}
          </div>
          {status.canManage ? status.connected ? (
            <button type="button" disabled={busy} className={`${buttonClass} bg-white/10 text-slate-100`} onClick={() => void changeConnection("disconnect")}>{busy ? "Szüneteltetés…" : "Szinkronizálás szüneteltetése"}</button>
          ) : (
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void changeConnection("connect"); }}>
              <label className="block text-sm font-bold text-slate-300">
                Google-fiók email-címe
                <input type="email" required value={email} disabled={busy} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-slate-50 outline-none focus:border-cyan-300" />
              </label>
              <button type="submit" disabled={busy} className={`${buttonClass} bg-cyan-300 text-slate-950`}>{busy ? "Google megnyitása…" : status.status === "not_connected" ? "Google Naptár összekapcsolása" : "Google Naptár újraengedélyezése"}</button>
            </form>
          ) : <p className="text-sm text-slate-400">A kapcsolatot a munkaterület tulajdonosa vagy adminisztrátora kezelheti.</p>}
        </>
      ) : null}
      {notice ? <p role="status" className="rounded-2xl bg-slate-100 p-3 text-sm font-bold text-slate-950">{notice}</p> : null}
      {error || status?.lastError ? <p role="alert" className="rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-950">{error || status?.lastError} Az AlinFlow-ban mentett időpontok megmaradtak.</p> : null}
      <button type="button" disabled={busy || loading} className={`${buttonClass} bg-white/10 text-cyan-100`} onClick={() => refreshGoogleCalendarConnection(workspaceId)}>Állapot frissítése</button>
    </section>
  );
}
