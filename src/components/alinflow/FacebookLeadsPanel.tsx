"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatCustomerCreatedAt, LIST_PAGE_SIZE } from "@/lib/alinflow/customers";
import { formatPostalCity } from "@/lib/alinflow/postal-codes";
import {
  facebookReviewReason,
  facebookSyncSummary,
  runFacebookLeadSync,
  type FacebookConnectionStatus,
  type FacebookLeadImport,
  type FacebookSyncCheckpoint,
  type FacebookSyncPage,
} from "@/lib/alinflow/facebook-leads-client";

const LEAD_FIELDS = "id,workspace_id,customer_id,name,phone,email,city,postal_code,climate_name,submitted_at,received_at,status,review_reason,acknowledged_at";
const secondaryButton = "rounded-xl bg-white/10 px-3 py-2 text-sm font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40";

export function FacebookLeadsPanel({ workspaceId, userId, onCustomersChanged, onOpenCustomer }: {
  workspaceId: string;
  userId: string;
  onCustomersChanged: () => Promise<void>;
  onOpenCustomer: (customerId: string) => Promise<void>;
}) {
  const [connection, setConnection] = useState<FacebookConnectionStatus | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [rows, setRows] = useState<FacebookLeadImport[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [ledgerAvailable, setLedgerAvailable] = useState<boolean | null>(null);
  const [readError, setReadError] = useState("");
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [checkpoint, setCheckpoint] = useState<FacebookSyncCheckpoint | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const context = `${workspaceId}:${userId}`;
  const currentContext = useRef(context);
  currentContext.current = context;
  const mounted = useRef(false);
  const callbacks = useRef({ onCustomersChanged, onOpenCustomer });
  callbacks.current = { onCustomersChanged, onOpenCustomer };
  const ledgerRequest = useRef<AbortController | null>(null);
  const statusRequest = useRef<AbortController | null>(null);
  const syncRequest = useRef<AbortController | null>(null);
  const fingerprint = useRef("");

  const isCurrent = useCallback(() => mounted.current && currentContext.current === context, [context]);

  const post = useCallback(async <T,>(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T> => {
    const { data, error } = await supabase.auth.getSession();
    if (signal.aborted || !isCurrent()) throw new DOMException("Megszakítva", "AbortError");
    if (error || !data.session || data.session.user.id !== userId) throw new Error("A bejelentkezés lejárt. Jelentkezz be újra.");
    const response = await fetch(`/api/facebook-leads/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ ...body, workspaceId }),
      signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "A Facebook-adatok most nem érhetők el. Próbáld újra később.");
    if (!result) throw new Error("A Facebook-adatok válasza hiányos. Próbáld újra később.");
    return result as T;
  }, [isCurrent, userId, workspaceId]);

  const loadStatus = useCallback(async () => {
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    try {
      const result = await post<FacebookConnectionStatus>("status", {}, controller.signal);
      if (!isCurrent() || controller.signal.aborted) return;
      setConnection(result);
      setConnectionError("");
    } catch (error) {
      if (!isCurrent() || controller.signal.aborted) return;
      setConnection(null);
      setConnectionError(error instanceof Error ? error.message : "A kapcsolat állapota most nem olvasható.");
    }
  }, [isCurrent, post]);

  const loadLedger = useCallback(async () => {
    ledgerRequest.current?.abort();
    const controller = new AbortController();
    ledgerRequest.current = controller;
    setLoading(true);
    try {
      let query = supabase.from("facebook_lead_imports").select(LEAD_FIELDS, { count: "exact" }).eq("workspace_id", workspaceId);
      if (pendingOnly) query = query.is("acknowledged_at", null);
      const { data, error, count } = await query.order("received_at", { ascending: false }).order("id", { ascending: false })
        .range((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE - 1).abortSignal(controller.signal);
      if (!isCurrent() || controller.signal.aborted) return;
      if (error) {
        setLedgerAvailable(false);
        setRows([]);
        setTotal(0);
        setReadError(error.code === "42P01" || error.code === "PGRST205"
          ? "A Facebook-beérkezések még nincsenek előkészítve ezen a munkaterületen."
          : "A Facebook-beérkezések nem tölthetők be. Frissíts később.");
        return;
      }
      const nextRows = (data || []) as FacebookLeadImport[];
      const nextTotal = count || 0;
      const lastPage = Math.max(1, Math.ceil(nextTotal / LIST_PAGE_SIZE));
      setLedgerAvailable(true);
      setReadError("");
      setTotal(nextTotal);
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setRows(nextRows);
      const nextFingerprint = JSON.stringify([pendingOnly, page, nextTotal, nextRows.map((row) => [row.id, row.customer_id, row.acknowledged_at])]);
      if (nextFingerprint !== fingerprint.current) {
        if (nextRows.length) await callbacks.current.onCustomersChanged();
        if (isCurrent() && !controller.signal.aborted) fingerprint.current = nextFingerprint;
      }
    } catch {
      if (isCurrent() && !controller.signal.aborted) setReadError("A beérkezések frissítése nem sikerült. Próbáld újra.");
    } finally {
      if (isCurrent() && !controller.signal.aborted) setLoading(false);
    }
  }, [isCurrent, page, pendingOnly, workspaceId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ledgerRequest.current?.abort();
      statusRequest.current?.abort();
      syncRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    void loadStatus();
    return () => statusRequest.current?.abort();
  }, [loadStatus]);

  useEffect(() => {
    void loadLedger();
    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible" || syncRequest.current) return;
      void loadLedger();
      void loadStatus();
    };
    const timer = window.setInterval(refreshIfVisible, 60_000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      ledgerRequest.current?.abort();
    };
  }, [loadLedger, loadStatus]);

  async function syncLeads() {
    if (syncRequest.current) return;
    const controller = new AbortController();
    syncRequest.current = controller;
    setSyncing(true);
    setMessage("Facebook-jelentkezések beolvasása...");
    let summary = "";
    try {
      const result = await runFacebookLeadSync({
        checkpoint: checkpoint || {},
        signal: controller.signal,
        requestPage: (next, signal) => post<FacebookSyncPage>("sync", next, signal),
        onPage: ({ checkpoint: next, totals }) => {
          if (!isCurrent()) return;
          summary = facebookSyncSummary(totals);
          setCheckpoint(next);
          setMessage(summary);
        },
      });
      if (!isCurrent()) return;
      setMessage(`${result.complete ? "Beolvasás kész." : "Beolvasás szüneteltetve; folytatható."} ${facebookSyncSummary(result.totals)}`);
    } catch (error) {
      if (!isCurrent()) return;
      setMessage(controller.signal.aborted
        ? `Beolvasás megállítva. A már beolvasott jelentkezések megmaradnak.${summary ? ` ${summary}` : ""}`
        : `${error instanceof Error ? error.message : "Nem sikerült a beolvasás."}${summary ? ` ${summary}` : ""}`);
    } finally {
      if (syncRequest.current === controller) syncRequest.current = null;
      if (isCurrent()) {
        setSyncing(false);
        void loadLedger();
        void callbacks.current.onCustomersChanged().catch(() => {
          if (isCurrent()) setMessage("Az ügyféllista frissítése nem sikerült. Frissíts később.");
        });
      }
    }
  }

  async function acknowledge(row: FacebookLeadImport) {
    if (actingId) return;
    setActingId(row.id);
    setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!isCurrent()) return;
      if (!data.session || data.session.user.id !== userId) throw new Error("A bejelentkezés lejárt. Jelentkezz be újra.");
      const { error } = await supabase.rpc("acknowledge_facebook_lead", { p_workspace_id: workspaceId, p_import_id: row.id });
      if (!isCurrent()) return;
      if (error) throw new Error("Nem sikerült feldolgozottnak jelölni. Próbáld újra.");
      setMessage("Az érdeklődés feldolgozottnak jelölve.");
      await loadLedger();
    } catch (error) {
      if (isCurrent()) setMessage(error instanceof Error ? error.message : "A jelölés nem sikerült.");
    } finally {
      if (isCurrent()) setActingId(null);
    }
  }

  async function openLead(row: FacebookLeadImport) {
    if (!row.customer_id || actingId) return;
    setActingId(row.id);
    setMessage("");
    try {
      await callbacks.current.onOpenCustomer(row.customer_id);
    } catch (error) {
      if (isCurrent()) setMessage(error instanceof Error ? error.message : "Az ügyfél nem nyitható meg.");
    } finally {
      if (isCurrent()) setActingId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  return (
    <section className="min-w-0 rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-2xl sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black">Facebook-érdeklődők</h2>
          <p className="mt-1 text-xs font-bold text-slate-400">{connection?.ready ? "Beolvasás elérhető" : connection ? "Kapcsolat előkészítése" : connectionError ? "Állapot nem elérhető" : "Kapcsolat ellenőrzése..."}</p>
        </div>
        <button type="button" disabled={loading || syncing} className={secondaryButton} onClick={() => { void loadLedger(); void loadStatus(); }}>Frissítés</button>
      </div>
      {connection?.message || connectionError ? <p className="mb-4 text-sm text-slate-400">{connectionError || connection?.message}</p> : null}
      {connection?.climateNames?.length ? <p className="mb-4 break-words text-xs font-bold text-cyan-200/80">{connection.climateNames.join(" · ")}</p> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" aria-pressed={pendingOnly} className={`${secondaryButton} ${pendingOnly ? "ring-1 ring-cyan-300/50" : ""}`} onClick={() => { setPendingOnly(true); setPage(1); }}>Feldolgozandó</button>
        <button type="button" aria-pressed={!pendingOnly} className={`${secondaryButton} ${!pendingOnly ? "ring-1 ring-cyan-300/50" : ""}`} onClick={() => { setPendingOnly(false); setPage(1); }}>Összes</button>
      </div>
      {readError ? <p className="mb-3 rounded-2xl bg-amber-400/10 p-3 text-sm text-amber-100" role="status">{readError}</p> : null}
      <div className="space-y-3" aria-busy={loading}>
        {!rows.length && !readError ? <p className="rounded-2xl bg-slate-950/60 p-4 text-sm text-slate-300">{loading ? "Beérkezések betöltése..." : pendingOnly ? "Nincs feldolgozandó Facebook-érdeklődés." : "Még nincs beolvasott Facebook-érdeklődés."}</p> : null}
        {rows.map((row) => (
          <article key={row.id} className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 break-words font-black">{row.name || "Név nélkül"}</p>
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-black ${row.status === "review" ? "bg-amber-400/15 text-amber-200" : "bg-cyan-300/15 text-cyan-200"}`}>
                  {row.status === "matched" ? "Ismételt érdeklődés" : row.status === "review" ? "Ellenőrizendő" : "Új érdeklődés"}
                </span>
                {row.acknowledged_at ? <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black text-slate-300">Feldolgozva</span> : null}
              </div>
            </div>
            <p className="mt-2 break-words text-sm font-bold text-slate-200">{formatPostalCity(row.postal_code || undefined, row.city || undefined) || "Település nincs megadva"}</p>
            <p className={`mt-1 break-words text-sm font-bold ${row.climate_name ? "text-cyan-200" : "text-amber-200"}`}>{row.climate_name || "Klíma nincs azonosítva"}</p>
            <p className="mt-1 break-words text-xs text-slate-400">{[row.phone, row.email].filter(Boolean).join(" · ") || "Nincs elérhetőség"}</p>
            <p className="mt-1 text-xs text-slate-400">Érdeklődött: {formatCustomerCreatedAt(row.submitted_at || row.received_at)}</p>
            {row.status === "review" ? <p className="mt-3 text-sm text-amber-100">{facebookReviewReason(row.review_reason)}</p> : null}
            {!row.customer_id && row.status !== "review" ? <p className="mt-3 text-sm text-amber-100">A kapcsolódó ügyfél már nem érhető el.</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {row.customer_id ? <button type="button" disabled={Boolean(actingId)} onClick={() => void openLead(row)} className="rounded-xl bg-cyan-300 px-3 py-2 text-sm font-black text-slate-950 disabled:opacity-40">{actingId === row.id ? "Betöltés..." : "Ügyfél megnyitása"}</button> : null}
              {!row.acknowledged_at ? <button type="button" disabled={Boolean(actingId)} onClick={() => void acknowledge(row)} className={secondaryButton}>Feldolgozva</button> : null}
            </div>
          </article>
        ))}
      </div>
      {total > 0 ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        <span>{total} érdeklődés · {page}/{pageCount}. oldal</span>
        {pageCount > 1 ? <div className="flex gap-2">
          <button type="button" disabled={loading || page <= 1} className={secondaryButton} onClick={() => setPage((value) => value - 1)}>Előző</button>
          <button type="button" disabled={loading || page >= pageCount} className={secondaryButton} onClick={() => setPage((value) => value + 1)}>Következő</button>
        </div> : null}
      </div> : null}
      <div className="mt-5 border-t border-white/10 pt-4">
        <button type="button" disabled={!connection?.ready || ledgerAvailable !== true || syncing} onClick={() => void syncLeads()} className="w-full rounded-2xl bg-blue-500 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{syncing ? "Beolvasás..." : checkpoint ? "Beolvasás folytatása" : "Korábbi jelentkezések beolvasása"}</button>
        {syncing ? <button type="button" className={`${secondaryButton} mt-2 w-full`} onClick={() => syncRequest.current?.abort()}>Beolvasás megállítása</button> : null}
        {message ? <p className="mt-3 rounded-2xl bg-white/10 p-3 text-sm text-slate-200" role="status">{message}</p> : null}
      </div>
    </section>
  );
}
