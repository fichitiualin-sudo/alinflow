export type FacebookLeadImport = {
  id: string;
  workspace_id: string;
  customer_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  postal_code: string | null;
  climate_name: string | null;
  submitted_at: string | null;
  received_at: string;
  status: "created" | "matched" | "review";
  review_reason: "no_contact" | "ambiguous_contact" | "missing_name" | null;
  acknowledged_at: string | null;
};

export type FacebookConnectionStatus = {
  configured: boolean;
  ready: boolean;
  message: string;
  climateNames: string[];
};

export type FacebookSyncCheckpoint = { formId?: string; cursor?: string };
export type FacebookSyncTotals = { imported: number; matched: number; review: number; duplicates: number };
export type FacebookSyncPage = FacebookSyncTotals & {
  nextCursor: string | null;
  nextFormId: string | null;
  hasMore: boolean;
};

// Only advance the checkpoint after a successful page. A cancelled or failed
// request can safely be repeated because the server deduplicates Meta lead IDs.
export async function runFacebookLeadSync({
  requestPage,
  checkpoint = {},
  signal,
  onPage,
  maxPages = 100,
}: {
  requestPage: (checkpoint: FacebookSyncCheckpoint, signal: AbortSignal) => Promise<FacebookSyncPage>;
  checkpoint?: FacebookSyncCheckpoint;
  signal: AbortSignal;
  onPage: (result: { checkpoint: FacebookSyncCheckpoint | null; totals: FacebookSyncTotals; pages: number }) => void;
  maxPages?: number;
}) {
  const totals: FacebookSyncTotals = { imported: 0, matched: 0, review: 0, duplicates: 0 };
  let next = checkpoint;
  const visited = new Set<string>();
  for (let pages = 1; pages <= maxPages; pages += 1) {
    if (signal.aborted) throw new DOMException("Megszakítva", "AbortError");
    const key = JSON.stringify(next);
    if (visited.has(key)) throw new Error("A beolvasás nem tudott továbblépni. Próbáld újra később.");
    visited.add(key);
    const page = await requestPage(next, signal);
    if (signal.aborted) throw new DOMException("Megszakítva", "AbortError");
    const counts = [page.imported, page.matched, page.review, page.duplicates];
    if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)
      || typeof page.hasMore !== "boolean"
      || (page.hasMore && (typeof page.nextFormId !== "string" || !page.nextFormId
        || (page.nextCursor !== null && typeof page.nextCursor !== "string")))) {
      throw new Error("A beolvasás válasza hiányos. A megmaradt jelentkezések később újra beolvashatók.");
    }
    totals.imported += page.imported;
    totals.matched += page.matched;
    totals.review += page.review;
    totals.duplicates += page.duplicates;
    const following = page.hasMore ? { formId: page.nextFormId!, ...(page.nextCursor ? { cursor: page.nextCursor } : {}) } : null;
    onPage({ checkpoint: following, totals: { ...totals }, pages });
    if (!following) return { complete: true, totals };
    next = following;
  }
  return { complete: false, totals };
}

export function facebookSyncSummary(totals: FacebookSyncTotals) {
  return `${totals.imported} új ügyfél · ${totals.matched} ismételt érdeklődés · ${totals.review} ellenőrizendő · ${totals.duplicates} már beolvasva`;
}

export function facebookReviewReason(reason: FacebookLeadImport["review_reason"]) {
  if (reason === "ambiguous_contact") return "Több ügyfélhez illő elérhetőség. Keresd meg a megfelelő ügyfelet.";
  if (reason === "no_contact") return "Hiányzik a használható telefonszám és email.";
  if (reason === "missing_name") return "Hiányzik a jelentkező neve.";
  return "Az ügyfél rögzítéséhez ellenőrizd az adatokat.";
}
