"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ft } from "@/lib/alinflow/format";
import { quotePricingModeFromNotes } from "@/lib/alinflow/products";

type HistoryProps = { workspaceId: string; customerId: string; revision?: number };
type HistoryKind = "sent" | "saved";
type Line = { name: string; quantity: number | null; unitPrice: number | null; totalPrice: number | null };
type Entry = {
  id: string;
  timestamp: string | null;
  recipient?: string;
  alternatives: boolean;
  items: Line[];
  total: number | null;
};

const PAGE_SIZE = 10;
const dateFormatter = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", dateStyle: "short", timeStyle: "short" });

function savedNumber(value: unknown) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function readItem(value: unknown, kind: HistoryKind): Line {
  const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const name = kind === "sent" ? item.name : item.product_name;
  const quantity = savedNumber(item.quantity);
  const unitPrice = savedNumber(kind === "sent" ? item.unitPrice : item.unit_price);
  const totalPrice = savedNumber(kind === "sent" ? item.totalPrice : item.total_price);
  return { name: typeof name === "string" && name.trim() ? name : "Tétel megnevezés nélkül",
    quantity, unitPrice, totalPrice: totalPrice ?? (quantity !== null && unitPrice !== null ? quantity * unitPrice : null) };
}

async function historyPage(workspaceId: string, customerId: string, kind: HistoryKind, page: number) {
  const start = page * PAGE_SIZE;
  if (kind === "sent") {
    const { data, error } = await supabase.from("quote_delivery_history")
      .select("id,sent_at,recipient,pricing_mode,items,total_amount")
      .eq("workspace_id", workspaceId).eq("customer_id", customerId).not("sent_at", "is", null)
      .order("sent_at", { ascending: false }).order("id", { ascending: false }).range(start, start + PAGE_SIZE);
    if (error) throw error;
    return (data ?? []).map((row): Entry => ({ id: row.id, timestamp: row.sent_at, recipient: row.recipient,
      alternatives: row.pricing_mode === "alternatives", total: savedNumber(row.total_amount),
      items: Array.isArray(row.items) ? row.items.map((item: unknown) => readItem(item, kind)) : [] }));
  }
  const { data, error } = await supabase.from("quotes")
    .select("id,created_at,notes,total_amount,quote_items(product_name,quantity,unit_price,total_price)")
    .eq("workspace_id", workspaceId).eq("customer_id", customerId).eq("quote_items.workspace_id", workspaceId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).range(start, start + PAGE_SIZE);
  if (error) throw error;
  return (data ?? []).map((row): Entry => ({ id: row.id, timestamp: row.created_at, alternatives: quotePricingModeFromNotes(row.notes) === "alternatives",
    total: savedNumber(row.total_amount), items: (row.quote_items ?? []).map(item => readItem(item, kind)) }));
}

function QuoteEntry({ entry, kind }: { entry: Entry; kind: HistoryKind }) {
  const date = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
  const firstItem = entry.items[0]?.name ?? "Árajánlat";
  return <details className="min-w-0 rounded-xl border border-white/10 bg-white/5 p-3">
    <summary className="cursor-pointer break-words font-bold">
      {firstItem}{entry.items.length > 1 ? ` + ${entry.items.length - 1} tétel` : ""}
      <span className="mt-1 block text-sm font-medium text-slate-300">
        {kind === "sent" ? "Elküldve" : "Létrehozva"} · {Number.isFinite(date) ? dateFormatter.format(date) : "A dátum hiányzik"}
      </span>
    </summary>
    <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-sm">
      {entry.recipient ? <p className="break-all"><b>Címzett</b> · {entry.recipient}</p> : null}
      {entry.alternatives ? <p className="font-bold">Választható változatok</p> : null}
      {entry.items.length ? <ul className="space-y-2">{entry.items.map((item, index) => <li key={index} className="break-words">
        <strong>{item.name}</strong>
        <span className="block text-slate-300">{item.quantity === null ? "Hiányzó mennyiség" : `${item.quantity} db`}
          {item.unitPrice !== null && (item.quantity !== 1 || item.totalPrice !== item.unitPrice) ? ` · ${ft(item.unitPrice)} / db` : ""}
          {item.totalPrice !== null ? ` · ${ft(item.totalPrice)}` : " · Tételár nincs rögzítve"}</span>
      </li>)}</ul> : <p>A tételsorok nem állnak rendelkezésre.</p>}
      {!entry.alternatives && entry.total !== null ? <p className="font-black">Összesen {ft(entry.total)}</p> : null}
    </div>
  </details>;
}

function QuoteHistory({ workspaceId, customerId, revision = 0 }: HistoryProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<HistoryKind>("sent");
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; entries?: Entry[]; error?: boolean }>();
  const key = [kind, page, revision, attempt].join(":");
  useEffect(() => {
    if (!open) return;
    let current = true;
    void historyPage(workspaceId, customerId, kind, page).then(
      entries => { if (current) setResult({ key, entries }); },
      () => { if (current) setResult({ key, error: true }); },
    );
    return () => { current = false; };
  }, [open, workspaceId, customerId, kind, page, key]);
  const loaded = result?.key === key ? result : undefined;
  const entries = loaded?.entries;
  const actionClass = "rounded-xl border border-white/10 px-3 py-2 text-sm font-bold disabled:opacity-50";
  return <section className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-4">
    <button type="button" aria-expanded={open} className="flex w-full items-center justify-between gap-2 text-left font-black"
      onClick={() => { setOpen(!open); if (!open) setAttempt(value => value + 1); }}>Korábbi árajánlatok <span aria-hidden="true">{open ? "−" : "+"}</span></button>
    {open ? <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Ajánlatok típusa">
        {(["sent", "saved"] as const).map(tab => <button key={tab} type="button" aria-pressed={tab === kind}
          className={`${actionClass} ${tab === kind ? "bg-cyan-300 text-slate-950" : "text-cyan-100"}`}
          onClick={() => { setKind(tab); setPage(0); }}>{tab === "sent" ? "Elküldött változatok" : "Mentett ajánlatok"}</button>)}
      </div>
      {kind === "saved" ? <p className="text-sm text-slate-300">Az ajánlatok utoljára mentett tételei és árai.</p> : null}
      {loaded?.error ? <p role="alert">A betöltés nem sikerült. <button className={actionClass} type="button" onClick={() => setAttempt(value => value + 1)}>Újrapróbálás</button></p>
        : !entries ? <p role="status">Ajánlatok betöltése…</p> : !entries.length ? <p>{kind === "sent"
          ? "Még nincs archivált elküldött változat. A korábbi tételeket a Mentett ajánlatok között keresheted."
          : "Nincs mentett ajánlat."}</p> : entries.slice(0, PAGE_SIZE).map(entry => <QuoteEntry key={entry.id} entry={entry} kind={kind} />)}
      {(page > 0 || (entries?.length ?? 0) > PAGE_SIZE) ? <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={actionClass} disabled={!page} onClick={() => setPage(page - 1)}>Előző</button>
        <span className="text-sm">{page + 1}. oldal</span>
        <button type="button" className={actionClass} disabled={(entries?.length ?? 0) <= PAGE_SIZE} onClick={() => setPage(page + 1)}>Következő</button>
      </div> : null}
    </div> : null}
  </section>;
}

export function QuoteHistoryPanel(props: HistoryProps) {
  return <QuoteHistory key={`${props.workspaceId}:${props.customerId}`} {...props} />;
}
