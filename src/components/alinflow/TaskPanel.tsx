"use client";

import { useEffect, useState } from "react";
import type { ClimateProduct, Customer, View } from "@/lib/alinflow/types";
import { isArchivedCustomer } from "@/lib/alinflow/constants";
import { offsetIso, todayIso } from "@/lib/alinflow/format";
import { climateSummary } from "@/lib/alinflow/products";
import { appointmentSummaryLabel } from "@/lib/alinflow/appointments";
import { formatPostalCity } from "@/lib/alinflow/postal-codes";
import { Back, Card, Layout, Shell } from "./LayoutPrimitives";

export type TaskFilter = "today" | "tomorrow" | "closing" | "stock" | "callback" | "quotes";

const TASK_PAGE_SIZE = 20;

const TASK_TITLE_MAP: Record<TaskFilter, string> = {
  today: "Mai munkák",
  tomorrow: "Holnapi munkák",
  closing: "Lezárásra vár",
  stock: "Készlethiány / raktár figyelmeztetés",
  callback: "Visszahívandó leadek",
  quotes: "Kiküldött árajánlatok",
};

type TaskPanelProps = {
  taskFilter: TaskFilter;
  customers: Customer[];
  products: ClimateProduct[];
  stockOf: (productId: string) => number;
  reservedForProduct: (productId: string) => number;
  customerStatusLabel: (customer: Customer) => string;
  customerHasSentQuote: (customer: Customer) => boolean;
  onBack: () => void;
  onOpenTask: (filter: TaskFilter) => void;
  onOpenCustomer: (customer: Customer, view: View) => void;
  onOpenWarehouse: () => void;
};


function timeToMinutes(value?: string) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return 24 * 60 + 1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function sortCustomersByTime(list: Customer[]) {
  return [...list].sort((a, b) => {
    const byTime = timeToMinutes(a.time) - timeToMinutes(b.time);
    if (byTime !== 0) return byTime;
    return (a.name || "").localeCompare(b.name || "", "hu");
  });
}

function paginate<T>(items: T[], page: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / TASK_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const start = (currentPage - 1) * TASK_PAGE_SIZE;
  return {
    currentPage,
    pageCount,
    items: items.slice(start, start + TASK_PAGE_SIZE),
  };
}

function Pagination({ currentPage, pageCount, totalCount, onPageChange }: { currentPage: number; pageCount: number; totalCount: number; onPageChange: (page: number) => void }) {
  if (totalCount <= TASK_PAGE_SIZE) return null;

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm font-bold text-slate-300 sm:flex-row sm:items-center sm:justify-between">
      <span>{currentPage}. oldal / {pageCount} · maximum {TASK_PAGE_SIZE} tétel oldalanként</span>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="rounded-xl bg-white/10 px-4 py-2 font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Előző
        </button>
        <button
          type="button"
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(currentPage + 1)}
          className="rounded-xl bg-cyan-300 px-4 py-2 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Következő
        </button>
      </div>
    </div>
  );
}

export function TaskPanel({
  taskFilter,
  customers,
  products,
  stockOf,
  reservedForProduct,
  customerStatusLabel,
  customerHasSentQuote,
  onBack,
  onOpenTask,
  onOpenCustomer,
  onOpenWarehouse,
}: TaskPanelProps) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [taskFilter]);

  const activeCustomers = customers.filter((customer) => !isArchivedCustomer(customer));
  const today = todayIso();
  const tomorrow = offsetIso(1);
  const todayList = sortCustomersByTime(activeCustomers.filter((customer) => customer.date === today));
  const tomorrowList = sortCustomersByTime(activeCustomers.filter((customer) => customer.date === tomorrow));
  const closingList = activeCustomers.filter((customer) => customer.status === "Szerelés kész – admin folyamatban");
  const callbackList = activeCustomers.filter((customer) => !customer.date && customer.status === "Visszahívandó");
  const quoteSentList = activeCustomers.filter(customerHasSentQuote);
  const stockList = products.filter((product) => reservedForProduct(product.id) > stockOf(product.id));

  const activeList =
    taskFilter === "today" ? todayList :
    taskFilter === "tomorrow" ? tomorrowList :
    taskFilter === "closing" ? closingList :
    taskFilter === "callback" ? callbackList :
    taskFilter === "quotes" ? quoteSentList :
    [];

  const activePagination = paginate(activeList, page);
  const stockPagination = paginate(stockList, page);

  return (
    <Shell>
      <Back onClick={onBack} />
      <Layout>
        <div className="space-y-6 xl:col-span-3">
          {taskFilter === "stock" ? (
            <Card title="Készlethiányok">
              <div className="mb-4 text-sm font-bold text-slate-400">
                {stockList.length} tétel · max. {TASK_PAGE_SIZE} tétel oldalanként
              </div>
              <div className="space-y-3">
                {stockList.length === 0 ? <div className="rounded-2xl bg-emerald-400/20 p-4 font-black text-emerald-200">Nincs készlethiány ✅</div> : null}
                {stockPagination.items.map((product) => (
                  <button key={product.id} onClick={onOpenWarehouse} className="w-full rounded-3xl border border-red-400/30 bg-red-500/15 p-4 text-left">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-lg font-black text-red-100">{product.name}</p>
                        <p className="text-sm text-red-200">Raktáron: {stockOf(product.id)} db · Lefoglalva: {reservedForProduct(product.id)} db</p>
                      </div>
                      <span className="rounded-2xl bg-red-500/30 px-4 py-3 font-black text-red-100">{reservedForProduct(product.id) - stockOf(product.id)} db hiány</span>
                    </div>
                  </button>
                ))}
              </div>
              <Pagination currentPage={stockPagination.currentPage} pageCount={stockPagination.pageCount} totalCount={stockList.length} onPageChange={setPage} />
            </Card>
          ) : (
            <Card title={TASK_TITLE_MAP[taskFilter]}>
              <div className="mb-4 text-sm font-bold text-slate-400">
                {activeList.length} tétel · max. {TASK_PAGE_SIZE} tétel oldalanként
              </div>
              <div className="space-y-3">
                {activeList.length === 0 ? <div className="rounded-2xl bg-white/10 p-4 font-black text-slate-300">Nincs ilyen teendő.</div> : null}
                {activePagination.items.map((customer) => (
                  <button key={customer.id} onClick={() => onOpenCustomer(customer, customer.date ? "work" : "lead")} className="w-full rounded-3xl border border-white/10 bg-slate-900/80 p-4 text-left transition hover:border-cyan-300/40">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-lg font-black">{customer.name}</p>
                        <p className="text-sm text-slate-400">{formatPostalCity(customer.postalCode, customer.city)} · {customer.email || "nincs email"}</p>
                        <p className="mt-1 text-xs text-slate-500">{customer.date ? appointmentSummaryLabel(customer) : "nincs időpont"}</p>
                        <p className="mt-1 text-xs text-cyan-200/80">{climateSummary(customer.quoteItems)}</p>
                      </div>
                      <span className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold">{customerStatusLabel(customer)}</span>
                    </div>
                  </button>
                ))}
              </div>
              <Pagination currentPage={activePagination.currentPage} pageCount={activePagination.pageCount} totalCount={activeList.length} onPageChange={setPage} />
            </Card>
          )}
        </div>
      </Layout>
    </Shell>
  );
}
