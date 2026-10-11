"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { listMaintenanceResults, listReceivedMaintenance } from "@/lib/alinflow/shared-maintenance-client";
import type { SharedMaintenanceInstallation, SharedMaintenanceResult } from "@/lib/alinflow/shared-maintenance";

type SharedMaintenanceState = {identity?: string; received: SharedMaintenanceInstallation[]; results: SharedMaintenanceResult[]; error: string; loading: boolean};
const EMPTY_STATE: SharedMaintenanceState = {received: [], results: [], error: "", loading: false};

export function useSharedMaintenance(workspaceId?: string, enabled = false, userId?: string) {
  const identity = workspaceId && userId ? `${workspaceId}:${userId}` : undefined;
  const [state, setState] = useState<SharedMaintenanceState>(EMPTY_STATE);
  const request = useRef(0);
  const inFlight = useRef<{identity: string; ticket: number} | null>(null);
  const refresh = useCallback(async () => {
    if (enabled && identity && inFlight.current?.identity === identity) return;
    const ticket = ++request.current;
    if (!workspaceId || !identity || !enabled) { inFlight.current = null; setState(EMPTY_STATE); return; }
    inFlight.current = {identity, ticket};
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
    void refresh();
    const cancel = () => { request.current++; inFlight.current = null; };
    if (!enabled) return cancel;
    const onFocus = () => { if (document.visibilityState !== "hidden") void refresh(); };
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(onFocus, 60000);
    return () => { cancel(); window.removeEventListener("focus", onFocus); window.clearInterval(interval); };
  }, [refresh, enabled]);
  return { ...(identity && state.identity === identity && enabled ? state : EMPTY_STATE), refresh };
}
