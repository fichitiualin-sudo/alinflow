"use client";

import { useState } from "react";
import type { CustomerTimelineItem, CustomerTimelineTone } from "@/lib/alinflow/types";

function formatTimelineValue(value?: string) {
  if (!value) return "Még nincs";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dotClass(tone: CustomerTimelineTone = "slate", muted = false) {
  if (muted) return "bg-slate-600";
  const tones: Record<CustomerTimelineTone, string> = {
    emerald: "bg-emerald-300",
    cyan: "bg-cyan-300",
    violet: "bg-violet-300",
    blue: "bg-blue-300",
    amber: "bg-amber-300",
    slate: "bg-slate-300",
  };
  return tones[tone];
}

function rowClass(muted = false) {
  return muted
    ? "border-white/10 bg-slate-950/45 text-slate-500"
    : "border-white/10 bg-slate-900/70 text-slate-100";
}

export function CustomerTimeline({ items }: { items: CustomerTimelineItem[] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!items.length) return null;

  const filledItems = items.filter((item) => item.value || item.hint).length;

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 p-3">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="block text-sm font-black text-slate-100">Ügyfél idővonal</span>
          <span className="block text-xs font-bold text-slate-500">{filledItems}/{items.length} esemény</span>
        </span>
        <span className="rounded-full bg-cyan-300/15 px-3 py-1 text-xs font-black text-cyan-100 ring-1 ring-cyan-200/20">
          {isOpen ? "Elrejtés" : "Megnyitás"}
        </span>
      </button>

      {isOpen ? (
        <div className="mt-3 space-y-2">
          {items.map((item) => (
            <div key={item.label} className={`flex gap-3 rounded-2xl border px-3 py-2.5 ${rowClass(item.muted)}`}>
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(item.tone, item.muted)}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-400">{item.label}</p>
                  <p className="text-sm font-black leading-snug text-slate-100">{formatTimelineValue(item.value)}</p>
                </div>
                {item.hint ? <p className="mt-1 text-xs font-bold leading-snug text-slate-400">{item.hint}</p> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
