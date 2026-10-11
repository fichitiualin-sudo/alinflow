"use client";
import { useEffect, useState } from "react";
import type { PrivacyNoticeConfig } from "@/lib/alinflow/privacy-notice";
import type { MaintenanceAccessGrant } from "@/lib/alinflow/shared-maintenance";
import { grantMaintenanceAccess, listMaintenanceGrants, revokeMaintenanceAccess } from "@/lib/alinflow/shared-maintenance-client";

export function MaintenanceAccessSettings({workspaceId, privacy}: {workspaceId: string; privacy?: PrivacyNoticeConfig}) {
  const [grants, setGrants] = useState<MaintenanceAccessGrant[]>([]);
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let current = true;
    listMaintenanceGrants(workspaceId).then(rows => { if(current) setGrants(rows); }).catch(error => {if(current) setMessage(error.message);});
    return () => {current = false;};
  }, [workspaceId]);
  async function act(operation: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await operation(); setGrants(await listMaintenanceGrants(workspaceId)); setMessage(success); setConfirmed(false); }
    catch (error) { setMessage(error instanceof Error ? error.message : "A művelet nem sikerült."); }
    finally {setBusy(false);}
  }
  return <section className="mt-5 space-y-4 rounded-2xl border border-white/10 p-4" aria-label="Karbantartói hozzáférés">
    <h3 className="font-black">Karbantartói hozzáférés</h3>
    <p className="text-sm text-slate-300">A kijelölt partner a vállalkozásod nevében egyeztethet a korábbi telepítések karbantartásáról. Saját munkát csak az ügyfél megrendelése után rögzíthet.</p>
    <p className="text-sm text-slate-300">A hozzáférés az ügyfél elérhetőségére, a munkacímre és a szükséges telepítési adatokra terjed ki. A számlák, árak, belső jegyzetek, fotók és aláírások megmaradnak nálad.</p>
    {privacy?.partnerUserId && privacy.partnerWorkspaceId ? <>
      <p className="font-bold">Karbantartó: {privacy.partner.legalName}</p>
      <label className="block text-sm font-bold">Aláírt adatfeldolgozási megállapodás dátuma / azonosítója
        <input className="input mt-2" value={reference} maxLength={300} onChange={e=>setReference(e.target.value)} disabled={busy}/>
      </label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy} className="mt-1 h-5 w-5 shrink-0"/>
        <span>A megállapodást mindkét vállalkozás aláírta; a partner az utasításaink szerint, kizárólag karbantartás-egyeztetésre kap hozzáférést.</span></label>
      <button type="button" disabled={busy || !confirmed || reference.trim().length < 3} onClick={()=>act(()=>grantMaintenanceAccess(workspaceId,privacy.partnerUserId!,privacy.partnerWorkspaceId!,reference),"Karbantartói hozzáférés bekapcsolva.")}
        className="rounded-2xl bg-emerald-400 px-4 py-3 font-black text-slate-950 disabled:opacity-40">{busy ? "Mentés..." : "Korábbi telepítések megosztása"}</button>
    </> : <p className="text-sm text-amber-200">Előbb válassz AlinFlow-partnert az adatkezelési beállításoknál, és mentsd a beállítást.</p>}
    {grants.map(grant=><div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/5 p-3">
      <div className="min-w-0 break-words"><b>{grant.targetWorkspaceName}</b><p className="text-sm">{grant.agreementReference}</p><p className="text-sm">{grant.revokedAt ? "Hozzáférés visszavonva" : `Aktív · telepítések ${grant.cutoffDate} napjáig`}</p></div>
      {!grant.revokedAt ? <button type="button" disabled={busy} onClick={()=>act(()=>revokeMaintenanceAccess(grant.id),"Hozzáférés visszavonva. A partner korábbi saját munkadokumentumai megmaradnak.")} className="rounded-xl bg-red-400/20 px-3 py-2 font-bold text-red-200">Visszavonás</button> : null}
    </div>)}
    {message ? <p role="status" className="rounded-xl bg-slate-800 p-3 text-sm text-slate-100">{message}</p> : null}
  </section>;
}
