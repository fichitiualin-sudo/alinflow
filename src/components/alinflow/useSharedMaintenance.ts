"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { listMaintenanceResults, listReceivedMaintenance } from "@/lib/alinflow/shared-maintenance-client";
import type { SharedMaintenanceInstallation, SharedMaintenanceResult } from "@/lib/alinflow/shared-maintenance";

export function useSharedMaintenance(workspaceId?: string, enabled = false, userId?: string) {
  const identity = workspaceId && userId ? `${workspaceId}:${userId}` : undefined;
  const [state, setState] = useState<{identity?: string; received: SharedMaintenanceInstallation[]; results: SharedMaintenanceResult[]; error: string; loading: boolean}>({received: [], results: [], error: "", loading: false});
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++request.current;
    if (!workspaceId || !identity || !enabled) { setState({identity, received: [], results: [], error: "", loading: false}); return; }
    setState({identity, received: [], results: [], error: "", loading: true});
    try {
      const [received, results] = await Promise.all([listReceivedMaintenance(workspaceId), listMaintenanceResults(workspaceId)]);
      if (!Array.isArray(received) || !Array.isArray(results)) throw new Error("A megosztott karbantartások válasza nem olvasható.");
      if (ticket === request.current) setState({identity, received, results, error: "", loading: false});
    } catch (error) {
      if (ticket === request.current) setState({identity, received: [], results: [], error: error instanceof Error ? error.message : "A megosztott karbantartások betöltése nem sikerült.", loading: false});
    }
  }, [workspaceId, enabled, identity]);
  useEffect(() => {
    void refresh();
    if (!enabled) return () => { request.current++; };
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(onFocus, 60000);
    return () => { request.current++; window.removeEventListener("focus", onFocus); window.clearInterval(interval); };
  }, [refresh, enabled]);
  return { ...(identity && state.identity === identity && enabled ? state : {received: [], results: [], error: "", loading: false}), refresh };
}
