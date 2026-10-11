"use client";
import { useEffect, useRef, useState } from "react";
import type { SharedMaintenanceInstallation } from "@/lib/alinflow/shared-maintenance";

export function SharedMaintenanceDialog({item, busy, onClose, onAccept}: {
  item: SharedMaintenanceInstallation; busy: boolean; onClose: () => void; onAccept: () => void;
}) {
  const [ordered, setOrdered] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {dialog.current?.showModal();}, []);
  const destination = [item.customer.postalCode,item.customer.city,item.customer.address].filter(Boolean).join(" ");
  return <dialog ref={dialog} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}
    aria-labelledby="shared-maintenance-title" className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl border border-slate-600 bg-slate-900 p-5 text-slate-100 backdrop:bg-black/60 sm:p-7">
    <div className="flex items-start justify-between gap-3"><h2 id="shared-maintenance-title" className="text-xl font-black">{item.customer.name}</h2><button type="button" disabled={busy} onClick={onClose} className="rounded-xl px-3 py-2" aria-label="Bezárás">×</button></div>
    <p className="mt-2 text-sm text-violet-200">Egyeztetés {item.sourceWorkspaceName} nevében</p>
    <p className="mt-3 break-words">{destination}</p><p className="mt-2 break-words">{item.climates.map(c=>`${c.quantity} db ${c.productName}`).join(" · ")}</p>
    <p className="mt-2 text-sm text-slate-300">Telepítés: {item.installationDate} · Utolsó karbantartás: {item.lastMaintenanceDate || "Nincs rögzítve"}</p>
    <div className="my-5 grid grid-cols-2 gap-3">
      {item.customer.phone ? <a href={`tel:${item.customer.phone.replace(/[^+\d]/g,"")}`} className="rounded-2xl bg-cyan-300 p-3 text-center font-black text-slate-950">Hívás</a> : <span>Nincs telefonszám</span>}
      {destination ? <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`} target="_blank" rel="noopener noreferrer" className="rounded-2xl bg-emerald-300 p-3 text-center font-black text-slate-950">Útvonal</a> : null}
    </div>
    {item.customer.email ? <p className="break-words text-sm">{item.customer.email}</p> : null}
    <label className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-600 p-4 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={ordered} onChange={event=>setOrdered(event.target.checked)} disabled={busy}/>
      <span>Az ügyfél a saját vállalkozásomtól megrendelte a karbantartást, és tájékoztattam a szolgáltatóról és az adatkezeléséről.</span></label>
    <button type="button" disabled={!ordered || busy} onClick={onAccept} className="mt-4 w-full rounded-2xl bg-emerald-400 p-4 font-black text-slate-950 disabled:opacity-40">{busy ? "Előkészítés..." : "Saját karbantartási időpont"}</button>
    <p className="mt-3 text-sm text-slate-300">Az elfogadott megrendelés szükséges adatai a saját munkaterületedre kerülnek. A munkalap és az adatkezelési tájékoztató új ügyfélaláírással készül.</p>
  </dialog>;
}
