"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { listMaintenanceResults, listReceivedMaintenance } from "@/lib/alinflow/shared-maintenance-client";
import type { SharedMaintenanceInstallation, SharedMaintenanceResult, SharedMaintenanceOptOut } from "@/lib/alinflow/shared-maintenance";

type SharedMaintenanceState = {identity?: string; received: SharedMaintenanceInstallation[]; results: SharedMaintenanceResult[]; error: string; loading: boolean};
const EMPTY_STATE: SharedMaintenanceState = {received: [], results: [], error: "", loading: false};

export function useSharedMaintenance(workspaceId?: string, enabled = false, userId?: string) {
  const identity = workspaceId && userId ? `${workspaceId}:${userId}` : undefined;
  const [state, setState] = useState<SharedMaintenanceState>(EMPTY_STATE);
  const request = useRef(0);
  const inFlight = useRef<{identity: string; ticket: number} | null>(null);
  const lastRefresh = useRef<{identity: string; at: number} | null>(null);
  const applyOptOut = useCallback((item: SharedMaintenanceInstallation, saved: SharedMaintenanceOptOut) => {
    // Discard a refresh started before the save: it may contain the old choice.
    request.current++;
    inFlight.current = null;
    setState(current => current.identity === identity && enabled ? {
      ...current, loading: false,
      received: current.received.map(row => row.sourceWorkspaceId === item.sourceWorkspaceId
        && row.installationId === item.installationId ? {...row, ...saved} : row),
    } : current);
  }, [identity, enabled]);
  const refresh = useCallback(async () => {
    if (enabled && identity && inFlight.current?.identity === identity) return;
    const ticket = ++request.current;
    if (!workspaceId || !identity || !enabled) { inFlight.current = null; setState(EMPTY_STATE); return; }
    inFlight.current = {identity, ticket};
    lastRefresh.current = {identity, at: Date.now()};
    // A background permission check must not briefly remove every map marker.
    // Scope changes still hide old data synchronously in the returned state.
    setState(current => current.identity === identity
      ? {...current, error: "", loading: true}
      : {...EMPTY_STATE, identity, loading: true});
    try {
      const [received, results] = await Promise.all([listReceivedMaintenance(workspaceId), listMaintenanceResults(workspaceId)]);
      if (!Array.isArray(received) || !Array.isArray(results)) throw new Error("A megosztott karbantartások válasza nem olvasható.");
      if (ticket === request.current) setState(current => ({identity,
        received: current.identity === identity && JSON.stringify(current.received) === JSON.stringify(received) ? current.received : received,
        results: current.identity === identity && JSON.stringify(current.results) === JSON.stringify(results) ? current.results : results,
        error: "", loading: false}));
    } catch (error) {
      if (ticket === request.current) setState({...EMPTY_STATE, identity, error: error instanceof Error ? error.message : "A megosztott karbantartások betöltése nem sikerült."});
    } finally {
      if (inFlight.current?.ticket === ticket) inFlight.current = null;
    }
  }, [workspaceId, enabled, identity]);
  useEffect(() => {
    const cancel = () => { request.current++; inFlight.current = null; lastRefresh.current = null; };
    if (!enabled || !identity) { void refresh(); return cancel; }
    const refreshIfVisible = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const onWake = () => {
      // Focus and visibility events often arrive together. Manual refresh and the
      // one-minute permission check remain immediate and are never throttled.
      if (lastRefresh.current?.identity === identity && Date.now() - lastRefresh.current.at < 15_000) return;
      refreshIfVisible();
    };
    refreshIfVisible();
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    const interval = window.setInterval(refreshIfVisible, 60000);
    return () => {
      cancel(); window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake); window.clearInterval(interval);
    };
  }, [refresh, enabled, identity]);
  return { ...(identity && state.identity === identity && enabled ? state : EMPTY_STATE), refresh, applyOptOut };
}
