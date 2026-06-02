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
  if (muted) return "bg-slate-700 ring-slate-600/40";
  const tones: Record<CustomerTimelineTone, string> = {
    emerald: "bg-emerald-300 ring-emerald-300/30",
    cyan: "bg-cyan-300 ring-cyan-300/30",
    violet: "bg-violet-300 ring-violet-300/30",
    blue: "bg-blue-300 ring-blue-300/30",
    amber: "bg-amber-300 ring-amber-300/30",
    slate: "bg-slate-300 ring-slate-300/30",
  };
  return tones[tone];
}

export function CustomerTimeline({ items }: { items: CustomerTimelineItem[] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!items.length) return null;

  const filledItems = items.filter((item) => item.value || item.hint);
  const visibleItems = isOpen ? items : filledItems.slice(0, 2);

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 p-3">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1 text-left transition hover:bg-white/[0.03]"
      >
        <span className="min-w-0">
          <span className="block text-sm font-black text-slate-100">Ügyfél idővonal</span>
          <span className="block text-xs font-bold text-slate-500">
            {filledItems.length ? `${filledItems.length} rögzített esemény` : "Még nincs rögzített esemény"}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-cyan-300/15 px-3 py-1 text-xs font-black text-cyan-100 ring-1 ring-cyan-200/20">
          {isOpen ? "Elrejtés" : "Megnyitás"}
        </span>
      </button>

      <div className="mt-3 space-y-1.5">
        {visibleItems.map((item) => (
          <div key={item.label} className={`flex items-start gap-3 rounded-xl px-2 py-2 ${item.muted ? "text-slate-500" : "text-slate-100"}`}>
            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${dotClass(item.tone, item.muted)}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{item.label}</p>
                <p className={`text-xs font-black leading-snug ${item.muted ? "text-slate-500" : "text-slate-100"}`}>{formatTimelineValue(item.value)}</p>
              </div>
              {item.hint ? <p className="mt-0.5 text-[11px] font-bold leading-snug text-slate-500">{item.hint}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
