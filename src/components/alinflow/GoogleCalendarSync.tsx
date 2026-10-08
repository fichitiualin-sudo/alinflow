"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export type GoogleCalendarStatus = {
  configured: boolean;
  connected: boolean;
  status: "not_connected" | "connected" | "paused" | "reauth_required";
  email?: string;
  calendarName?: string;
  pending: number;
  lastError?: string;
  canManage: boolean;
  syncFrom?: string;
  managedAppointmentIds: string[];
};

const APPOINTMENTS_CHANGED = "alinflow:google-calendar-appointments-changed";
const CONNECTION_CHANGED = "alinflow:google-calendar-connection-changed";

export function notifyGoogleCalendarAppointmentsChanged(workspaceId: string | null, newAppointmentId?: string) {
  if (workspaceId) window.dispatchEvent(new CustomEvent(APPOINTMENTS_CHANGED, { detail: { workspaceId, newAppointmentId } }));
}

export function refreshGoogleCalendarConnection(workspaceId: string) {
  window.dispatchEvent(new CustomEvent(CONNECTION_CHANGED, { detail: { workspaceId } }));
}

export async function requestGoogleCalendar<T>(
  path: "status" | "connect" | "disconnect" | "sync",
  workspaceId: string,
  userId: string,
  signal: AbortSignal,
  body: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (signal.aborted) throw new DOMException("Megszakítva", "AbortError");
  if (error || !data.session || data.session.user.id !== userId) throw new Error("A bejelentkezés lejárt. Jelentkezz be újra.");
  const readOnly = path === "status";
  const response = await fetch(`/api/google-calendar/${path}${readOnly ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`, {
    method: readOnly ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
    ...(!readOnly ? { body: JSON.stringify({ ...body, workspaceId }) } : {}),
    signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "A Google Naptár most nem érhető el. Próbáld újra később.");
  if (!result) throw new Error("A naptár válasza hiányos. Próbáld újra később.");
  return result as T;
}

const RETURN_MESSAGES: Record<string, string> = {
  connected: "A Google Naptár összekapcsolása sikerült.",
  denied: "A Google Naptár engedélyezése elmaradt. Az AlinFlow-időpontok változatlanok.",
  failed: "A Google Naptár összekapcsolása nem sikerült. Próbáld újra.",
  permissions_missing: "A Google Naptár engedélye kimaradt. Indítsd újra az összekapcsolást, és a Google oldalán jelöld be a naptáresemények kezeléséhez tartozó jelölőnégyzetet.",
  wrong_account: "Másik Google-fiókot választottál. Próbáld újra a megadott email-címmel.",
  expired: "Az összekapcsolásra rendelkezésre álló idő lejárt. Indítsd újra.",
};

export function useGoogleCalendarSync({ workspaceId, userId, enabled, onReturn }: {
  workspaceId?: string;
  userId?: string;
  enabled: boolean;
  onReturn: () => void;
}) {
  const context = `${workspaceId || ""}:${userId || ""}`;
  const [state, setState] = useState<{ context: string; status: GoogleCalendarStatus | null; loading: boolean; error: string }>({ context: "", status: null, loading: false, error: "" });
  const [returnMessage, setReturnMessage] = useState("");
  const onReturnRef = useRef(onReturn);
  onReturnRef.current = onReturn;

  useEffect(() => {
    if (!enabled) return;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("googleCalendar");
    if (!outcome || !RETURN_MESSAGES[outcome]) return;
    url.searchParams.delete("googleCalendar");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setReturnMessage(RETURN_MESSAGES[outcome]);
    onReturnRef.current();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !workspaceId || !userId) return;
    let active = true;
    let connection: GoogleCalendarStatus | null = null;
    let syncing = false;
    let queued = false;
    let statusVersion = 0;
    const optimisticManagedIds = new Set<string>();
    const controller = new AbortController();
    setState({ context, status: null, loading: true, error: "" });

    async function loadStatus() {
      const version = ++statusVersion;
      try {
        const result = await requestGoogleCalendar<GoogleCalendarStatus>("status", workspaceId!, userId!, controller.signal);
        if (!active || version !== statusVersion) return;
        for (const id of result.managedAppointmentIds) optimisticManagedIds.delete(id);
        connection = { ...result, managedAppointmentIds: [...new Set([...result.managedAppointmentIds, ...optimisticManagedIds])] };
        setState({ context, status: connection, loading: false, error: "" });
      } catch (error) {
        if (active && version === statusVersion) setState((current) => ({ ...current, context, loading: false, error: error instanceof Error ? error.message : "A naptárkapcsolat állapota nem tölthető be." }));
      }
    }

    async function sync(appointmentChanged = false) {
      if (!active) return;
      if (syncing) {
        queued ||= appointmentChanged;
        return;
      }
      syncing = true;
      try {
        await loadStatus();
        if (!active || !connection?.connected) return;
        await requestGoogleCalendar("sync", workspaceId!, userId!, controller.signal);
        if (active) await loadStatus();
      } catch (error) {
        if (active) await loadStatus();
        if (active) setState((current) => ({ ...current, error: error instanceof Error ? error.message : "A naptárfrissítés nem sikerült. Automatikusan újrapróbáljuk." }));
      } finally {
        syncing = false;
        if (active && queued) {
          queued = false;
          void sync();
        }
      }
    }

    function handleAppointmentChanged(event: Event) {
      const detail = (event as CustomEvent<{ workspaceId: string; newAppointmentId?: string }>).detail;
      if (detail?.workspaceId !== workspaceId) return;
      if (detail.newAppointmentId && connection && connection.status !== "not_connected") {
        optimisticManagedIds.add(detail.newAppointmentId);
        connection = { ...connection, managedAppointmentIds: [...new Set([...connection.managedAppointmentIds, detail.newAppointmentId])] };
        setState((current) => ({ ...current, status: connection }));
      }
      void sync(true);
    }
    function handleConnectionChanged(event: Event) {
      if ((event as CustomEvent<{ workspaceId: string }>).detail?.workspaceId !== workspaceId) return;
      void loadStatus().then(() => { if (active) void sync(true); });
    }
    function refreshIfVisible() {
      if (document.visibilityState === "visible") void sync();
    }

    void sync();
    const timer = window.setInterval(refreshIfVisible, 60_000);
    window.addEventListener(APPOINTMENTS_CHANGED, handleAppointmentChanged);
    window.addEventListener(CONNECTION_CHANGED, handleConnectionChanged);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener(APPOINTMENTS_CHANGED, handleAppointmentChanged);
      window.removeEventListener(CONNECTION_CHANGED, handleConnectionChanged);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [context, enabled, userId, workspaceId]);

  return {
    status: enabled && state.context === context ? state.status : null,
    loading: enabled && (state.context !== context || state.loading),
    error: enabled && state.context === context ? state.error : "",
    returnMessage,
  };
}
