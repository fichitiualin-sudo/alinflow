"use client";

import { useMemo } from "react";
import type { CalendarMode, Customer } from "@/lib/alinflow/types";
import { climateSummary } from "@/lib/alinflow/products";
import { iso } from "@/lib/alinflow/format";
import { calLabel, googleCalendarHref, weekStart } from "@/lib/alinflow/calendar";

type CalendarProps = {
  mode: CalendarMode;
  date: Date;
  customers: Customer[];
  onMode: (mode: CalendarMode) => void;
  onStep: (direction: number) => void;
  onOpen: (customer: Customer) => void;
  selectable?: boolean;
  selectedDate?: string;
  onSelect?: (date: string) => void;
};


function timeToMinutes(value?: string) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return 24 * 60 + 1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function sortJobsByTime(jobs: Customer[]) {
  return [...jobs].sort((a, b) => {
    const byTime = timeToMinutes(a.time) - timeToMinutes(b.time);
    if (byTime !== 0) return byTime;
    return (a.name || "").localeCompare(b.name || "", "hu");
  });
}

function calendarStatusStyle(status: string) {
  if (status === "Lezárva") return "border border-emerald-700/70 bg-emerald-950/90 text-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]";
  if (status === "Szerelés kész – admin folyamatban") return "border border-amber-300/45 bg-amber-400/20 text-amber-50 shadow-[0_0_0_1px_rgba(251,191,36,0.10)]";
  if (status === "Időpont foglalva") return "border border-sky-300/45 bg-sky-400/20 text-sky-50 shadow-[0_0_0_1px_rgba(56,189,248,0.10)]";
  if (status === "Ajánlat elküldve") return "border border-violet-300/40 bg-violet-400/15 text-violet-50";
  return "border border-white/10 bg-white/10 text-white";
}


function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl">
      <h2 className="mb-5 text-2xl font-black">{title}</h2>
      {children}
    </section>
  );
}

export function Calendar({
  mode,
  date,
  customers,
  onMode,
  onStep,
  onOpen,
  selectable,
  selectedDate,
  onSelect,
}: CalendarProps) {
  const start = weekStart(date);
  const weekdayNames = ["Hétfő", "Kedd", "Szerda", "Csütörtök", "Péntek", "Szombat", "Vasárnap"];
  const days = useMemo(() => {
    if (mode === "week") {
      return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(start);
        day.setDate(start.getDate() + index);
        return { d: day, current: true };
      });
    }

    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const total = Math.ceil((offset + last.getDate()) / 7) * 7;

    return Array.from({ length: total }, (_, index) => {
      const day = new Date(date.getFullYear(), date.getMonth(), index - offset + 1);
      return { d: day, current: day.getMonth() === date.getMonth() };
    });
  }, [mode, date, start]);

  return (
    <Card title={selectable ? "Válassz napot a naptárból" : mode === "week" ? "Heti naptár" : "Havi naptár"}>
      <div className="mb-5 flex flex-col gap-4">
        <div className="flex justify-end gap-2">
          <button onClick={() => onMode("week")} className={mode === "week" ? "tab-active" : "tab"}>Heti</button>
          <button onClick={() => onMode("month")} className={mode === "month" ? "tab-active" : "tab"}>Havi</button>
        </div>
        <div className="grid grid-cols-[46px_minmax(0,1fr)_46px] items-center gap-2 sm:grid-cols-[52px_minmax(0,1fr)_52px] sm:gap-3">
          <button onClick={() => onStep(-1)} className="arrow">‹</button>
          <div className="min-w-0 rounded-2xl bg-cyan-300 px-3 py-3 text-center text-base font-black text-slate-950 sm:px-5 sm:text-lg md:text-xl">
            {calLabel(mode, date)}
          </div>
          <button onClick={() => onStep(1)} className="arrow">›</button>
        </div>
      </div>

      <div className="mb-2 hidden grid-cols-7 gap-2 text-center text-[11px] font-black text-slate-400 md:grid">
        {weekdayNames.map((day) => <div key={day}>{day}</div>)}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-7">
        {days.map(({ d, current }) => {
          const dayIso = iso(d);
          const jobs = sortJobsByTime(customers.filter((customer) => customer.date === dayIso));
          const isSelected = selectable && selectedDate === dayIso;
          const weekdayName = weekdayNames[(d.getDay() + 6) % 7];

          return (
            <div
              key={dayIso}
              onClick={() => selectable && onSelect?.(dayIso)}
              className={`min-h-[96px] rounded-3xl border p-3 md:min-h-[125px] ${isSelected ? "border-emerald-300 bg-emerald-400/20" : current ? "border-white/10 bg-slate-900/80" : "border-white/5 bg-slate-950/40 opacity-40"} ${selectable ? "cursor-pointer hover:ring-2 hover:ring-emerald-300/50" : ""}`}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-400 md:hidden">{weekdayName}</p>
                  <b className="text-2xl leading-none md:text-base">{d.getDate()}</b>
                </div>
                {jobs.length === 0 && current ? <span className="shrink-0 rounded-full bg-cyan-300/10 px-2 py-1 text-[11px] text-cyan-200 md:text-[10px]">üres</span> : null}
              </div>
              <div className="space-y-2">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className={`w-full rounded-2xl p-3 text-left transition hover:ring-2 hover:ring-cyan-300/50 md:p-2 ${calendarStatusStyle(job.status)}`}
                  >
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); onOpen(job); }}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-black">{job.time}</p>
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold md:text-xs">{job.name}</p>
                      <p className="truncate text-xs text-cyan-100/80 md:text-[11px]">{climateSummary(job.quoteItems)}</p>
                      <p className="truncate text-xs opacity-70 md:text-[11px]">{job.city}</p>
                    </button>
                    {mode === "week" && !selectable ? (
                      <a
                        href={googleCalendarHref(job)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="mt-2 inline-flex items-center justify-center rounded-full border border-amber-200/20 bg-amber-300/15 px-2.5 py-1 text-[10px] font-black text-amber-100 transition hover:bg-amber-300/25"
                        title="Hozzáadás Google Naptárhoz"
                      >
                        + Naptár
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
