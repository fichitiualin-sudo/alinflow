"use client";
import { useEffect, useRef, useState } from "react";
import { requestGoogleContacts, type GoogleContactsStatus, type ContactsPreview } from "./GoogleContactsSync";

const button = "min-h-11 rounded-2xl px-4 py-3 text-sm font-black transition disabled:cursor-wait disabled:opacity-50";
const field = "w-full min-w-0 rounded-2xl border border-slate-400/50 bg-slate-950/70 px-4 py-3 text-base text-slate-50";
const stateLabel = { new: "Új névjegy", match: "Meglévő névjegy", ambiguous: "Több lehetséges egyezés", linked: "Összekapcsolva", review: "Ellenőrzendő" };
const searchText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("hu-HU");
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
  const [groupMode, setGroupMode] = useState(false);
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [anchorCustomerId, setAnchorCustomerId] = useState("");
  const [samePerson, setSamePerson] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupPage, setGroupPage] = useState(0);
  const lifecycle = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController(); lifecycle.current = controller;
    setStatus(null); setEmail(""); setPreview(null); setChoices({}); setPage(0); setError(""); setMessage(""); setBusy(""); busyRef.current = false;
    resetGrouping(); setShowAll(false);
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
  function resetGrouping() {
    setGroupMode(false); setGroupMemberIds([]); setAnchorCustomerId(""); setSamePerson(false); setGroupSearch(""); setGroupPage(0);
  }
  async function loadPreview(signal: AbortSignal) {
    setPreview(null); setChoices({}); setPage(0); resetGrouping();
    const result = await requestGoogleContacts<ContactsPreview>("preview", workspaceId, userId, signal);
    if (!signal.aborted) setPreview(result);
  }
  const rows = preview?.items.filter(item => showAll || item.state !== "linked") || [];
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(currentPage * 10, (currentPage + 1) * 10);
  const selected = visible.filter(item => choices[item.customerId]);
  const selectedCustomers = selected.reduce((count, item) => count + (item.memberCustomerIds?.length || 1), 0);
  const selectedHasGroup = selected.some(item => (item.memberCustomerIds?.length || 0) > 1);
  const expired = Boolean(preview && Date.parse(preview.expiresAt) <= Date.now());
  const groupable = preview?.items.filter(item => item.groupable && !item.memberCustomerIds?.length && item.state !== "linked") || [];
  const groupMembers = groupMemberIds.flatMap(id => groupable.find(item => item.customerId === id) || []);
  const groupRows = groupable.filter(item => searchText([item.name, item.phone, item.email, item.address].join(" ")).includes(searchText(groupSearch.trim())));
  const groupPages = Math.max(1, Math.ceil(groupRows.length / 10));
  const currentGroupPage = Math.min(groupPage, groupPages - 1);
  const canPreviewGroup = groupMembers.length >= 2 && groupMembers.length <= 10 && groupMembers.length === groupMemberIds.length
    && groupMemberIds.includes(anchorCustomerId) && samePerson && !expired;
  function toggleGroupMember(customerId: string) {
    const included = groupMemberIds.includes(customerId);
    if (busy || expired || !groupable.some(item => item.customerId === customerId) || (!included && groupMemberIds.length >= 10)) return;
    setGroupMemberIds(included ? groupMemberIds.filter(id => id !== customerId) : [...groupMemberIds, customerId]);
    if (anchorCustomerId === customerId) setAnchorCustomerId("");
    setSamePerson(false);
  }

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
        <p className="mt-1 text-sm text-slate-300">{status.connected ? `${status.linkedCount} névjegy · ${status.coveredCustomerCount ?? status.linkedCount} ügyféladatlap · ${status.pendingCount} feldolgozásra vár` : status.status === "paused" ? "Frissítés szüneteltetve" : status.status === "reauth_required" ? "Új Google-engedély szükséges" : "Kapcsold hozzá a telefonodon használt Google-fiókot."}</p>
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
            setPreview(null); setChoices({}); resetGrouping();
            await requestGoogleContacts("sync", workspaceId, userId, signal); await refreshStatus(signal);
            if (!signal.aborted) setMessage("A frissítést ellenőriztem. A kapcsolt ügyfelek változásait a rendszer a háttérben is feldolgozza.");
          })}>{busy === "sync" ? "Frissítés…" : "Kapcsolt névjegyek frissítése"}</button>
          <button type="button" className={`${button} text-slate-300 underline`} disabled={Boolean(busy)} onClick={() => void action("pause", async signal => {
            await requestGoogleContacts("disconnect", workspaceId, userId, signal); await refreshStatus(signal);
            if (!signal.aborted) { setPreview(null); setChoices({}); resetGrouping(); setMessage("A frissítés szünetel. A már áttöltött Google-névjegyek megmaradnak."); }
          })}>Szüneteltetés</button>
        </div>
        <p className="text-sm text-slate-300">Az első összerendelést te választod ki; később ugyanaz a névjegy frissül. A személyes beírásaid és egyéb adataid megmaradnak. Az új ügyfelek mindig külön jóváhagyást kérnek.</p>
        <details className="rounded-2xl border border-white/10 p-4 text-sm"><summary className="cursor-pointer font-bold">Megjelenítés iPhone-on</summary><p className="mt-3">Beállítások → Appok → Kontaktok → Kontaktfiókok → Google-fiókod → Kontaktok bekapcsolása. Ugyanazt a fiókot válaszd, amelyet itt összekapcsoltál. A telefon frissítése eltarthat néhány percig.</p></details>
      </>}
    </> : null}
    {preview && status?.connected ? <div className="space-y-3 border-t border-white/10 pt-4">
      <h4 className="text-lg font-black">Áttöltés ellenőrzése</h4>
      <p className="break-all text-sm text-slate-300">Célfiók: {preview.googleEmail}</p>
      {expired ? <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">Az előnézet lejárt. Kérj új előnézetet az áttöltés előtt.</p> : null}
      {groupable.length >= 2 && !groupMode ? <button type="button" className={`${button} border border-cyan-300/40 text-cyan-100`} disabled={Boolean(busy || expired)} onClick={() => { setChoices({}); setGroupMode(true); }}>Ugyanahhoz a személyhez tartozó adatlapok</button> : null}
      {groupMode ? <section aria-label="Közös névjegy összeállítása" className="min-w-0 space-y-4 rounded-2xl border border-cyan-300/30 p-4">
        <h5 className="font-black">Több adatlap → egy Google-névjegy</h5>
        <p className="text-sm text-slate-300">Jelölj ki 2–10 adatlapot, amelyek biztosan ugyanahhoz a személyhez tartoznak. Az AlinFlow-ügyfelek és minden munkájuk külön megmaradnak. Ez még nem indít áttöltést.</p>
        <label className="block"><span className="mb-2 block text-sm font-bold">Keresés a még nem kapcsolt ügyfelek között</span><input type="search" className={field} value={groupSearch} disabled={Boolean(busy)} placeholder="Név, telefon, email vagy cím" onChange={event => { setGroupSearch(event.target.value); setGroupPage(0); }} /></label>
        {!groupRows.length ? <p className="text-sm text-slate-300">Nincs találat.</p> : null}
        <div className="space-y-2">{groupRows.slice(currentGroupPage * 10, (currentGroupPage + 1) * 10).map(item => <label key={item.customerId} className="flex min-h-11 items-start gap-3 rounded-xl border border-white/10 p-3">
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" aria-label={`${item.name} hozzáadása a közös névjegyhez`} checked={groupMemberIds.includes(item.customerId)} disabled={Boolean(busy || expired || (groupMemberIds.length >= 10 && !groupMemberIds.includes(item.customerId)))} onChange={() => toggleGroupMember(item.customerId)} />
          <span className="min-w-0"><span className="block break-words text-sm font-bold">{item.name}</span><span className="block break-words text-xs text-slate-300">{[item.phone, item.email, item.address].filter(Boolean).join(" · ") || "Nincs elérhetőség"}</span></span>
        </label>)}</div>
        {groupRows.length > 10 ? <nav aria-label="Csoporthoz választható ügyfelek lapozása" className="flex flex-wrap items-center justify-between gap-2"><button type="button" className={`${button} border border-white/20`} disabled={Boolean(busy || currentGroupPage === 0)} onClick={() => setGroupPage(currentGroupPage - 1)}>← Előző adatlapok</button><span className="text-sm">{currentGroupPage + 1}. / {groupPages}</span><button type="button" className={`${button} border border-white/20`} disabled={Boolean(busy || currentGroupPage + 1 >= groupPages)} onClick={() => setGroupPage(currentGroupPage + 1)}>Következő adatlapok →</button></nav> : null}
        <div className="space-y-2 border-t border-white/10 pt-3">
          <p className="text-sm font-black">{groupMembers.length} / 10 adatlap a közös névjegyhez</p>
          {groupMembers.length ? <ul className="space-y-2">{groupMembers.map(item => <li key={item.customerId} className="flex items-center justify-between gap-2"><span className="min-w-0 break-words text-sm">{item.name}<span className="block text-xs text-slate-400">{[item.phone, item.email, item.address].filter(Boolean).join(" · ")}</span></span><button type="button" className={`${button} shrink-0 text-slate-300`} aria-label={`${item.name} kivétele a csoportból`} disabled={Boolean(busy || expired)} onClick={() => toggleGroupMember(item.customerId)}>Kiveszem</button></li>)}</ul> : <p className="text-sm text-slate-400">A kijelölés lapozás és keresés közben is megmarad.</p>}
          <label className="block"><span className="mb-2 block text-sm font-bold">Melyik név jelenjen meg a Google-névjegyen?</span><select className={field} value={anchorCustomerId} disabled={Boolean(busy || expired || groupMembers.length < 2)} onChange={event => { setAnchorCustomerId(event.target.value); setSamePerson(false); }}><option value="">Válassz nevet</option>{groupMembers.map(item => <option key={item.customerId} value={item.customerId}>{item.name} · {item.address || item.phone || item.email || "Nincs elérhetőség"}</option>)}</select></label>
          <p className="text-xs text-slate-400">Meglévő Google-névjegynél a jelenlegi név megmarad.</p>
          <label className="flex min-h-11 items-start gap-3 py-2 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={samePerson} disabled={Boolean(busy || expired || groupMembers.length < 2 || !anchorCustomerId)} onChange={event => setSamePerson(event.target.checked)} /><span>Megerősítem, hogy a kijelölt adatlapok ugyanahhoz a személyhez tartoznak.</span></label>
        </div>
        <div className="flex flex-wrap gap-2"><button type="button" className={`${button} bg-cyan-300 text-slate-950`} disabled={Boolean(busy || !canPreviewGroup)} onClick={() => void action("group-preview", async signal => {
          if (!canPreviewGroup) return;
          setChoices({});
          const result = await requestGoogleContacts<ContactsPreview>("groups/preview", workspaceId, userId, signal, { groups: [{ anchorCustomerId, memberCustomerIds: groupMemberIds }] });
          if (!signal.aborted) { setPreview(result); setPage(0); setShowAll(false); resetGrouping(); }
        })}>{busy === "group-preview" ? "Közös névjegy ellenőrzése…" : "Közös névjegy előnézete"}</button><button type="button" className={`${button} border border-white/20`} disabled={Boolean(busy)} onClick={resetGrouping}>Mégsem csoportosítok</button></div>
      </section> : <>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showAll} onChange={event => { setShowAll(event.target.checked); setPage(0); setChoices({}); }} />Már összekapcsolt ügyfelek is</label>
      {!rows.length ? <p className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-950">Nincs új összekapcsolandó ügyfél.</p> : null}
      {visible.map(item => <article key={item.customerId} className="min-w-0 space-y-3 rounded-2xl border border-white/15 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><h5 className="min-w-0 break-words font-black">{item.name}</h5><span className="rounded-full bg-cyan-300/15 px-3 py-1 text-xs font-bold text-cyan-100">{stateLabel[item.state]}</span></div>
        {(item.memberCustomerIds?.length || 0) > 1 ? <div className="space-y-3 text-sm">
          <p className="font-bold text-cyan-100">{item.memberCustomerIds!.length} ügyféladatlap → 1 Google-névjegy</p>
          <dl className="space-y-2">{([["Telefonszámok", item.phones], ["Email-címek", item.emails], ["Címek", item.addresses]] as const).map(([label, values]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="break-words text-slate-300">{values?.length ? <ul>{values.map(value => <li key={value}>{value}</li>)}</ul> : "Nincs megadva"}</dd></div>)}</dl>
          <div><p className="font-semibold">A közös névjegyhez tartozó adatlapok</p><ul className="mt-2 space-y-2">{item.members?.map(member => <li key={member.customerId} className="break-words border-l-2 border-cyan-300/40 pl-3"><span className="font-bold">{member.name}</span><span className="block text-slate-300">{[member.phone, member.email, member.address].filter(Boolean).join(" · ") || "Nincs elérhetőség"}</span></li>)}</ul></div>
          <p className="text-xs text-slate-400">Az ügyféladatlapok és munkák az AlinFlowban külön megmaradnak.</p>
        </div> : <p className="break-words text-sm text-slate-300">{[item.phone, item.email, item.address].filter(Boolean).join(" · ") || "Nincs elérhetőség"}</p>}
        <details className="text-sm"><summary className="cursor-pointer font-semibold text-cyan-200">Klímák és a névjegybe kerülő megjegyzés</summary><p className="mt-2 whitespace-pre-wrap break-words text-slate-300">{item.notes}</p></details>
        {item.lastError ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{item.lastError}</p> : null}
        {["new", "match", "ambiguous"].includes(item.state) ? <label className="block"><span className="mb-2 block text-sm font-bold">Mi történjen ezzel a névjeggyel?</span>
          <select className={field} value={choices[item.customerId] || ""} disabled={Boolean(busy || expired)} onChange={event => setChoices(current => ({ ...current, [item.customerId]: event.target.value }))}>
            <option value="">Most kihagyom</option>
            {item.state === "new" ? <option value="new">Új Google-névjegy létrehozása</option> : null}
            {item.candidates.map(candidate => <option key={candidate.resourceName} value={candidate.resourceName}>{candidate.name || "Névtelen névjegy"} · {[...candidate.phones, ...candidate.emails].join(" / ")}</option>)}
          </select>
          {item.state === "new" ? <span className="mt-2 block text-xs text-slate-400">Nincs azonos telefonú vagy email-című névjegy. Ellenőrizd, hogy nem szerepel-e más elérhetőséggel a telefonkönyvedben.</span> : <span className="mt-2 block text-xs text-slate-400">Telefonszám vagy email egyezik. Csak akkor kapcsolj össze, ha valóban ugyanaz az ügyfél.</span>}
        </label> : null}
      </article>)}
      {rows.length ? <>
        <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" className={`${button} border border-white/20`} disabled={Boolean(busy || expired)} onClick={() => setChoices(Object.fromEntries(visible.flatMap(item => item.state === "new" ? [[item.customerId, "new"]] : item.state === "match" && item.candidates.length === 1 ? [[item.customerId, item.candidates[0].resourceName]] : [])))}>Az oldal egyértelmű tételeinek kijelölése</button><span className="text-sm">{selected.length} névjegy · {selectedCustomers} ügyféladatlap kiválasztva</span></div>
        <button type="button" className={`${button} w-full bg-emerald-400 text-slate-950 sm:w-auto`} disabled={Boolean(busy || expired || !selected.length)} onClick={() => void action("approve", async signal => {
          const result = await requestGoogleContacts<{ approved: number }>("approve", workspaceId, userId, signal, { previewId: preview.previewId, items: selected.map(item => ({ customerId: item.customerId, sourceHash: item.sourceHash, resourceName: choices[item.customerId] === "new" ? null : choices[item.customerId] })) });
          if (!signal.aborted) { setPreview(null); setChoices({}); resetGrouping(); setMessage(selectedHasGroup ? `${result.approved} névjegy, ${selectedCustomers} ügyféladatlap összerendelése jóváhagyva. A névjegyek feldolgozása elindult.` : `${result.approved} ügyfél összerendelése jóváhagyva. A névjegyek feldolgozása elindult.`); }
          await requestGoogleContacts("sync", workspaceId, userId, signal);
          await refreshStatus(signal);
        })}>{busy === "approve" ? "Jóváhagyás…" : selectedHasGroup ? `${selected.length} névjegy áttöltésének jóváhagyása · ${selectedCustomers} adatlap` : `${selected.length} kiválasztott ügyfél áttöltésének jóváhagyása`}</button>
        <nav aria-label="Névjegyek lapozása" className="flex items-center justify-between gap-3"><button type="button" className={`${button} border border-white/20`} disabled={Boolean(busy || currentPage === 0)} onClick={() => { setPage(currentPage - 1); setChoices({}); }}>← Előző</button><span className="text-sm">{currentPage + 1}. / {pages}</span><button type="button" className={`${button} border border-white/20`} disabled={Boolean(busy || currentPage + 1 >= pages)} onClick={() => { setPage(currentPage + 1); setChoices({}); }}>Következő →</button></nav>
      </> : null}
      </>}
    </div> : null}
  </div>;
}
