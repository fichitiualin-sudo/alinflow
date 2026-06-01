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

function toneClasses(tone: CustomerTimelineTone = "slate", muted = false) {
  if (muted) return "border-white/10 bg-slate-950/50 text-slate-500";
  const tones: Record<CustomerTimelineTone, string> = {
    emerald: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
    cyan: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
    violet: "border-violet-300/20 bg-violet-400/10 text-violet-100",
    blue: "border-blue-300/20 bg-blue-400/10 text-blue-100",
    amber: "border-amber-300/20 bg-amber-400/10 text-amber-100",
    slate: "border-white/10 bg-white/5 text-slate-100",
  };
  return tones[tone];
}

export function CustomerTimeline({ items }: { items: CustomerTimelineItem[] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!items.length) return null;

  const filledItems = items.filter((item) => item.value).length;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full flex-col gap-2 rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 text-left transition hover:border-cyan-300/35 hover:bg-slate-900/80 sm:flex-row sm:items-center sm:justify-between"
      >
        <span>
          <span className="block text-sm font-black text-slate-100">Ügyfél idővonal</span>
          <span className="block text-xs font-bold text-slate-500">{filledItems}/{items.length} rögzített esemény</span>
        </span>
        <span className="inline-flex w-fit items-center rounded-full bg-cyan-300/15 px-3 py-1 text-xs font-black text-cyan-100 ring-1 ring-cyan-200/20">
          {isOpen ? "Elrejtés" : "Megnyitás"}
        </span>
      </button>

      {isOpen ? (
        <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            {items.map((item) => (
              <div key={item.label} className={`rounded-2xl border px-3 py-2 ${toneClasses(item.tone, item.muted)}`}>
                <p className="text-[10px] font-black uppercase tracking-wide opacity-70">{item.label}</p>
                <p className="mt-1 text-[11px] font-black leading-snug sm:text-xs">{formatTimelineValue(item.value)}</p>
                {item.hint ? <p className="mt-1 text-[10px] font-bold leading-snug opacity-70">{item.hint}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
