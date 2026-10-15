"use client";
import { useEffect, useRef, useState } from "react";
import { requestGoogleContacts, type GoogleContactsStatus, type ContactsPreview } from "./GoogleContactsSync";

const button = "min-h-11 rounded-2xl px-4 py-3 text-sm font-black transition disabled:cursor-wait disabled:opacity-50";
const field = "w-full min-w-0 rounded-2xl border border-slate-400/50 bg-slate-950/70 px-4 py-3 text-base text-slate-50";
const stateLabel = { new: "Új névjegy", match: "Meglévő névjegy", ambiguous: "Több lehetséges egyezés", linked: "Összekapcsolva", review: "Ellenőrzendő" };
export function GoogleContactsSettingsPanel({ workspaceId, userId, returnMessage = "", canConnect = true }: { workspaceId: string; userId: string; returnMessage?: string; canConnect?: boolean }) {
  const [status, setStatus] = useState<GoogleContactsStatus | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ContactsPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const lifecycle = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController(); lifecycle.current = controller;
    setStatus(null); setEmail(""); setPreview(null); setChoices({}); setPage(0); setError(""); setMessage(""); setBusy(""); busyRef.current = false;
    const refresh = async () => {
      if (busyRef.current || document.visibilityState !== "visible") return;
      try {
        const result = await requestGoogleContacts<GoogleContactsStatus>("status", workspaceId, userId, controller.signal);
        if (!controller.signal.aborted) { setStatus(result); if (result.email) setEmail(result.email); }
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "A kapcsolat nem tölthető be."); }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [workspaceId, userId]);

  async function action(name: string, run: (signal: AbortSignal) => Promise<void>) {
    const controller = lifecycle.current;
    if (!controller || controller.signal.aborted || busyRef.current) return;
    busyRef.current = true; setBusy(name); setError(""); setMessage("");
    try { await run(controller.signal); }
    catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "A művelet nem sikerült."); }
    finally { if (!controller.signal.aborted) { busyRef.current = false; setBusy(""); } }
  }
  async function refreshStatus(signal: AbortSignal) {
    const result = await requestGoogleContacts<GoogleContactsStatus>("status", workspaceId, userId, signal);
    if (!signal.aborted) setStatus(result);
  }
  async function loadPreview(signal: AbortSignal) {
    setPreview(null); setChoices({}); setPage(0);
    const result = await requestGoogleContacts<ContactsPreview>("preview", workspaceId, userId, signal);
    if (!signal.aborted) setPreview(result);
  }
  const rows = preview?.items.filter(item => showAll || item.state !== "linked") || [];
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(currentPage * 10, (currentPage + 1) * 10);
  const selected = visible.filter(item => choices[item.customerId]);
  const expired = Boolean(preview && Date.parse(preview.expiresAt) <= Date.now());

  return <div className="min-w-0 space-y-4">
    <p className="text-sm text-slate-300">A saját, már telepített ügyfelek neve, telefonja, email-címe és címe kerülhet a Google Névjegyekbe. A klímák és a karbantartások adatai a névjegy megjegyzésében jelennek meg.</p>
    {returnMessage ? <p role="status" className="rounded-2xl bg-cyan-50 p-4 text-sm font-bold text-cyan-950">{returnMessage}</p> : null}
    {error ? <p role="alert" className="break-words rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-950">{error}</p> : null}
    {message ? <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-950">{message}</p> : null}
    {!status && !error ? <p className="text-sm">Kapcsolat ellenőrzése…</p> : null}
    {status && !status.configured ? <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">A Google Névjegyek kapcsolatának előkészítése folyamatban van.</p> : null}
    {status?.configured ? <>
      <div className="rounded-2xl border border-white/10 p-4">
        <p className="break-all font-black">{status.email || "Még nincs összekapcsolva"}</p>
        <p className="mt-1 text-sm text-slate-300">{status.connected ? `${status.linkedCount} összekapcsolt ügyfél · ${status.pendingCount} feldolgozásra vár` : status.status === "paused" ? "Frissítés szüneteltetve" : status.status === "reauth_required" ? "Új Google-engedély szükséges" : "Kapcsold hozzá a telefonodon használt Google-fiókot."}</p>
        {status.errorCount > 0 ? <p className="mt-2 text-sm font-bold text-amber-300">{status.errorCount} névjegy ellenőrzést igényel. Nyisd meg az előnézetet a részletekhez.</p> : null}
        {status.lastError ? <p className="mt-2 break-words text-sm text-amber-300">{status.lastError}</p> : null}
        {status.lastSyncedAt ? <p className="mt-2 text-xs text-slate-400">Utolsó ellenőrzés: {new Date(status.lastSyncedAt).toLocaleString("hu-HU")}</p> : null}
      </div>
      {!status.connected ? <div className="space-y-3">
        {!canConnect ? <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">Az összekapcsolás előtt mentsd az oldal alján a módosított beállításokat.</p> : null}
        <label className="block"><span className="mb-2 block text-sm font-bold">Google-fiók email-címe</span><input type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} disabled={Boolean(busy || status.email)} onChange={event => setEmail(event.target.value)} className={field} placeholder="A telefonon használt Google-fiók" /></label>
        <p className="text-sm text-slate-300">A Google külön engedélyt kér a névjegyek megtekintésére és kezelésére. Az összekapcsolás után előnézetben dönthetsz az áttöltésről.</p>
        <a className="inline-block text-sm font-bold text-cyan-200 underline" href="/adatvedelem/google-nevjegyek" target="_blank" rel="noopener noreferrer">A névjegykapcsolat adatkezelése</a>
        <div><button type="button" disabled={Boolean(busy || !canConnect || !email.trim())} className={`${button} bg-cyan-300 text-slate-950`} onClick={() => void action("connect", async signal => {
          const result = await requestGoogleContacts<{ url: string }>("connect", workspaceId, userId, signal, { email: email.trim().toLowerCase() });
          if (!signal.aborted) { const url = new URL(result.url); if (url.origin !== "https://accounts.google.com") throw new Error("Hibás Google-válasz."); window.location.assign(url.href); }
        })}>{busy === "connect" ? "Kapcsolódás…" : status.email ? "Google-kapcsolat újraengedélyezése" : "Google Névjegyek összekapcsolása"}</button></div>
      </div> : <>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${button} bg-cyan-300 text-slate-950`} disabled={Boolean(busy)} onClick={() => void action("preview", loadPreview)}>{busy === "preview" ? "Egyezések keresése…" : "Ügyfelek áttöltése · előnézet"}</button>
          <button type="button" className={`${button} border border-white/20`} disabled={Boolean(busy)} onClick={() => void action("sync", async signal => {
            await requestGoogleContacts("sync", workspaceId, userId, signal); await refreshStatus(signal);
            if (!signal.aborted) setMessage("A frissítést ellenőriztem. A kapcsolt ügyfelek változásait a rendszer a háttérben is feldolgozza.");
          })}>{busy === "sync" ? "Frissítés…" : "Kapcsolt névjegyek frissítése"}</button>
          <button type="button" className={`${button} text-slate-300 underline`} disabled={Boolean(busy)} onClick={() => void action("pause", async signal => {
            await requestGoogleContacts("disconnect", workspaceId, userId, signal); await refreshStatus(signal);
            if (!signal.aborted) { setPreview(null); setChoices({}); setMessage("A frissítés szünetel. A már áttöltött Google-névjegyek megmaradnak."); }
          })}>Szüneteltetés</button>
        </div>
        <p className="text-sm text-slate-300">Az első összerendelést te választod ki; később ugyanaz a névjegy frissül. A személyes beírásaid és egyéb adataid megmaradnak. Az új ügyfelek mindig külön jóváhagyást kérnek.</p>
        <details className="rounded-2xl border border-white/10 p-4 text-sm"><summary className="cursor-pointer font-bold">Megjelenítés iPhone-on</summary><p className="mt-3">Beállítások → Appok → Kontaktok → Kontaktfiókok → Google-fiókod → Kontaktok bekapcsolása. Ugyanazt a fiókot válaszd, amelyet itt összekapcsoltál. A telefon frissítése eltarthat néhány percig.</p></details>
      </>}
    </> : null}
    {preview && status?.connected ? <div className="space-y-3 border-t border-white/10 pt-4">
      <h4 className="text-lg font-black">Áttöltés ellenőrzése</h4>
      <p className="break-all text-sm text-slate-300">Célfiók: {preview.googleEmail}</p>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showAll} onChange={event => { setShowAll(event.target.checked); setPage(0); setChoices({}); }} />Már összekapcsolt ügyfelek is</label>
      {expired ? <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">Az előnézet lejárt. Kérj új előnézetet az áttöltés előtt.</p> : null}
      {!rows.length ? <p className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-950">Nincs új összekapcsolandó ügyfél.</p> : null}
      {visible.map(item => <article key={item.customerId} className="min-w-0 space-y-3 rounded-2xl border border-white/15 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><h5 className="min-w-0 break-words font-black">{item.name}</h5><span className="rounded-full bg-cyan-300/15 px-3 py-1 text-xs font-bold text-cyan-100">{stateLabel[item.state]}</span></div>
        <p className="break-words text-sm text-slate-300">{[item.phone, item.email, item.address].filter(Boolean).join(" · ") || "Nincs elérhetőség"}</p>
        <details className="text-sm"><summary className="cursor-pointer font-semibold text-cyan-200">Klímák és a névjegybe kerülő megjegyzés</summary><p className="mt-2 whitespace-pre-wrap break-words text-slate-300">{item.notes}</p></details>
        {item.lastError ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{item.lastError}</p> : null}
        {["new", "match", "ambiguous"].includes(item.state) ? <label className="block"><span className="mb-2 block text-sm font-bold">Mi történjen ezzel az ügyféllel?</span>
          <select className={field} value={choices[item.customerId] || ""} disabled={Boolean(busy || expired)} onChange={event => setChoices(current => ({ ...current, [item.customerId]: event.target.value }))}>
            <option value="">Most kihagyom</option>
            {item.state === "new" ? <option value="new">Új Google-névjegy létrehozása</option> : null}
            {item.candidates.map(candidate => <option key={candidate.resourceName} value={candidate.resourceName}>{candidate.name || "Névtelen névjegy"} · {[...candidate.phones, ...candidate.emails].join(" / ")}</option>)}
          </select>
          {item.state === "new" ? <span className="mt-2 block text-xs text-slate-400">Nincs azonos telefonú vagy email-című névjegy. Ellenőrizd, hogy nem szerepel-e más elérhetőséggel a telefonkönyvedben.</span> : <span className="mt-2 block text-xs text-slate-400">Telefonszám vagy email egyezik. Csak akkor kapcsolj össze, ha valóban ugyanaz az ügyfél.</span>}
        </label> : null}
      </article>)}
      {rows.length ? <>
        <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" className={`${button} border border-white/20`} disabled={Boolean(busy || expired)} onClick={() => setChoices(Object.fromEntries(visible.flatMap(item => item.state === "new" ? [[item.customerId, "new"]] : item.state === "match" && item.candidates.length === 1 ? [[item.customerId, item.candidates[0].resourceName]] : [])))}>Az oldal egyértelmű tételeinek kijelölése</button><span className="text-sm">{selected.length} kiválasztva</span></div>
        <button type="button" className={`${button} w-full bg-emerald-400 text-slate-950 sm:w-auto`} disabled={Boolean(busy || expired || !selected.length)} onClick={() => void action("approve", async signal => {
          const result = await requestGoogleContacts<{ approved: number }>("approve", workspaceId, userId, signal, { previewId: preview.previewId, items: selected.map(item => ({ customerId: item.customerId, sourceHash: item.sourceHash, resourceName: choices[item.customerId] === "new" ? null : choices[item.customerId] })) });
          if (!signal.aborted) { setPreview(null); setChoices({}); setMessage(`${result.approved} ügyfél összerendelése jóváhagyva. A névjegyek feldolgozása elindult.`); }
          await requestGoogleContacts("sync", workspaceId, userId, signal);
          await refreshStatus(signal);
        })}>{busy === "approve" ? "Jóváhagyás…" : `${selected.length} kiválasztott ügyfél áttöltésének jóváhagyása`}</button>
        <nav aria-label="Névjegyek lapozása" className="flex items-center justify-between gap-3"><button type="button" className={`${button} border border-white/20`} disabled={Boolean(busy || currentPage === 0)} onClick={() => { setPage(currentPage - 1); setChoices({}); }}>← Előző</button><span className="text-sm">{currentPage + 1}. / {pages}</span><button type="button" className={`${button} border border-white/20`} disabled={Boolean(busy || currentPage + 1 >= pages)} onClick={() => { setPage(currentPage + 1); setChoices({}); }}>Következő →</button></nav>
      </> : null}
    </div> : null}
  </div>;
}
