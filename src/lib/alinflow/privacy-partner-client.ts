"use client";

import { supabase } from "@/lib/supabase";
import type { PrivacyPartnerCandidate } from "./privacy-partner";

async function requestPartner(body: Record<string, string>) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("A partner kiválasztásához jelentkezz be újra.");
  const response = await fetch("/api/privacy-partner", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || "A karbantartó adatai most nem kérhetők le. Próbáld újra.");
  return result;
}

export async function lookupPrivacyPartners(workspaceId: string, email: string): Promise<PrivacyPartnerCandidate[]> {
  const result = await requestPartner({ workspaceId, email: email.trim().toLowerCase() });
  if (!Array.isArray(result.candidates)) throw new Error("A keresés válasza nem olvasható. Próbáld újra.");
  return result.candidates;
}

export async function resolvePrivacyPartner(workspaceId: string, partnerUserId: string, partnerWorkspaceId: string): Promise<PrivacyPartnerCandidate> {
  const result = await requestPartner({ workspaceId, partnerUserId, partnerWorkspaceId });
  const candidate = result.candidate as PrivacyPartnerCandidate | undefined;
  if (!candidate || candidate.userId !== partnerUserId || candidate.workspaceId !== partnerWorkspaceId
      || !candidate.party || !Array.isArray(candidate.issues) || candidate.issues.length) {
    throw new Error("A kiválasztott partner nem ellenőrizhető. Keresd meg és válaszd ki újra.");
  }
  return candidate;
}
