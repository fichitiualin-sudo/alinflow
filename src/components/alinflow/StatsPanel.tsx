"use client";

import type { ClimateProduct, Customer } from "@/lib/alinflow/types";
import { offsetIso, todayIso } from "@/lib/alinflow/format";

type TaskFilter = "today" | "tomorrow" | "closing" | "stock" | "callback" | "quotes";

export function Stats({ products, customers, sentQuoteCount, stockOf, reservedForProduct, onSelect }: { products: ClimateProduct[]; customers: Customer[]; sentQuoteCount: number; stockOf: (productId: string) => number; reservedForProduct: (productId: string) => number; onSelect?: (filter: TaskFilter) => void }) {
  const today = todayIso();
  const tomorrow = offsetIso(1);
  const todayJobs = customers.filter((customer) => customer.date === today).length;
  const tomorrowJobs = customers.filter((customer) => customer.date === tomorrow).length;
  const closingJobs = customers.filter((customer) => customer.status === "Szerelés kész – admin folyamatban").length;
  const callbackLeads = customers.filter((customer) => !customer.date && customer.status === "Visszahívandó").length;
  const climateShortages = products.filter((product) => reservedForProduct(product.id) > stockOf(product.id)).length;

  const stats = [
    ["Mai munkák", String(todayJobs), "mai szerelés / felmérés", "bg-emerald-500", "today"],
    ["Holnapi munkák", String(tomorrowJobs), "következő nap", "bg-cyan-500", "tomorrow"],
    ["Lezárásra vár", String(closingJobs), "admin / dokumentum", "bg-purple-500", "closing"],
    ["Kiküldött árajánlatok", String(sentQuoteCount), "elküldött ajánlat", "bg-violet-500", "quotes"],
    ["Készlethiány", String(climateShortages), "raktár figyelmeztetés", "bg-red-500", "stock"],
    ["Visszahívandó", String(callbackLeads), "leadek", "bg-amber-500", "callback"],
  ] as const;

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {stats.map(([title, value, caption, color, filter]) => (
        <button key={title} onClick={() => onSelect?.(filter)} className="rounded-3xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-cyan-300/50 hover:bg-white/10">
          <div className={`mb-4 h-11 w-11 rounded-2xl ${color}`} />
          <p className="text-slate-300">{title}</p>
          <p className="text-3xl font-black">{value}</p>
          <p className="text-xs text-slate-400">{caption}</p>
        </button>
      ))}
    </section>
  );
}
