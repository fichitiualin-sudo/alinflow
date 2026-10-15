"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export type GoogleContactsStatus = {
  configured: boolean; canManage: boolean; connected: boolean; email: string;
  status: "active" | "paused" | "reauth_required" | null;
  linkedCount: number; pendingCount: number; errorCount: number;
  lastSyncedAt: string | null; lastError: string | null;
};
export type ContactPreviewItem = {
  customerId: string; name: string; phone: string; email: string; address: string; notes: string; sourceHash: string;
  state: "new" | "match" | "ambiguous" | "linked" | "review"; resourceName: string | null; lastError?: string;
  candidates: { resourceName: string; name: string; phones: string[]; emails: string[]; evidence: ("phone" | "email")[] }[];
};
export type ContactsPreview = { previewId: string; expiresAt: string; googleEmail: string; items: ContactPreviewItem[] };
export async function requestGoogleContacts<T>(path: "status" | "connect" | "disconnect" | "preview" | "approve" | "sync", workspaceId: string,
  userId: string, signal: AbortSignal, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (signal.aborted) throw new DOMException("Megszakítva", "AbortError");
  if (error || !data.session || data.session.user.id !== userId) throw new Error("A bejelentkezés lejárt. Jelentkezz be újra.");
  const response = await fetch(`/api/google-contacts/${path}`, { method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ ...body, workspaceId }) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "A Google Névjegyek most nem érhető el. Próbáld újra később.");
  if (!result) throw new Error("A névjegykapcsolat válasza hiányos. Próbáld újra később.");
  return result as T;
}
const RETURN_MESSAGES: Record<string, string> = {
  connected: "A Google Névjegyek összekapcsolása sikerült. Az első áttöltéshez nézd át az előnézetet.",
  denied: "A névjegyek hozzáférését nem engedélyezted. Nem történt áttöltés.",
  failed: "A névjegykapcsolat nem sikerült. Próbáld újra.",
  permissions_missing: "A névjegyek kezelésének engedélye kimaradt. Indítsd újra az összekapcsolást, és jelöld be ezt a Google oldalán.",
  wrong_account: "Másik Google-fiókot választottál. Próbáld újra a megadott email-címmel.",
  expired: "Az összekapcsolásra rendelkezésre álló idő lejárt. Indítsd újra.",
};
export function useGoogleContactsReturn(enabled: boolean, workspaceId: string | undefined, onReturn: () => void) {
  const [result, setResult] = useState<{ workspaceId: string; message: string } | null>(null);
  const onReturnRef = useRef(onReturn); onReturnRef.current = onReturn;
  useEffect(() => {
    if (!enabled || !workspaceId) return;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("googleContacts");
    if (!outcome || !RETURN_MESSAGES[outcome]) return;
    const target = url.searchParams.get("googleContactsWorkspace") || workspaceId;
    url.searchParams.delete("googleContacts"); url.searchParams.delete("googleContactsWorkspace");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setResult({ workspaceId: target, message: RETURN_MESSAGES[outcome] });
    onReturnRef.current();
  }, [enabled, workspaceId]);
  return result && result.workspaceId === workspaceId ? result.message : "";
}
