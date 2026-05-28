import type { ReactNode } from "react";

import type { ClimateProduct, Customer, View } from "@/lib/alinflow/types";
import { isArchivedCustomer } from "@/lib/alinflow/constants";
import { offsetIso, todayIso } from "@/lib/alinflow/format";
import { climateSummary } from "@/lib/alinflow/products";
import { Back, Btn, Card, Hero, Layout, Main, Shell, Side } from "./LayoutPrimitives";

export type TaskFilter = "today" | "tomorrow" | "closing" | "stock" | "callback" | "quotes";

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
  const activeCustomers = customers.filter((customer) => !isArchivedCustomer(customer));
  const today = todayIso();
  const tomorrow = offsetIso(1);
  const todayList = activeCustomers.filter((customer) => customer.date === today);
  const tomorrowList = activeCustomers.filter((customer) => customer.date === tomorrow);
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

  return (
    <Shell>
      <Back onClick={onBack} />
      <Hero title={TASK_TITLE_MAP[taskFilter]} sub="Összegyűjtött teendők és figyelmeztetések" action="Vissza a főoldalra" onAction={onBack} />
      <Layout>
        <Main>
          {taskFilter === "stock" ? (
            <Card title="Készlethiányok">
              <div className="space-y-3">
                {stockList.length === 0 ? <div className="rounded-2xl bg-emerald-400/20 p-4 font-black text-emerald-200">Nincs készlethiány ✅</div> : null}
                {stockList.map((product) => (
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
            </Card>
          ) : (
            <Card title={TASK_TITLE_MAP[taskFilter]}>
              <div className="space-y-3">
                {activeList.length === 0 ? <div className="rounded-2xl bg-white/10 p-4 font-black text-slate-300">Nincs ilyen teendő.</div> : null}
                {activeList.map((customer) => (
                  <button key={customer.id} onClick={() => onOpenCustomer(customer, customer.date ? "work" : "lead")} className="w-full rounded-3xl border border-white/10 bg-slate-900/80 p-4 text-left transition hover:border-cyan-300/40">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-lg font-black">{customer.name}</p>
                        <p className="text-sm text-slate-400">{customer.city} · {customer.email || "nincs email"}</p>
                        <p className="mt-1 text-xs text-slate-500">{customer.date ? `${customer.date} · ${customer.time}` : "nincs időpont"}</p>
                        <p className="mt-1 text-xs text-cyan-200/80">{climateSummary(customer.quoteItems)}</p>
                      </div>
                      <span className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold">{customerStatusLabel(customer)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </Main>
        <Side>
          <Card title="Gyors szűrők">
            <div className="space-y-3">
              <Btn onClick={() => onOpenTask("today")}>Mai munkák</Btn>
              <Btn onClick={() => onOpenTask("tomorrow")}>Holnapi munkák</Btn>
              <Btn onClick={() => onOpenTask("closing")}>Lezárásra vár</Btn>
              <Btn onClick={() => onOpenTask("stock")}>Készlethiány</Btn>
              <Btn onClick={() => onOpenTask("callback")}>Visszahívandó</Btn>
              <Btn onClick={() => onOpenTask("quotes")}>Kiküldött árajánlatok</Btn>
            </div>
          </Card>
        </Side>
      </Layout>
    </Shell>
  );
}
