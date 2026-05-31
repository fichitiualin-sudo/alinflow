import type { ReactNode } from "react";

import type { Customer, View } from "@/lib/alinflow/types";
import { climateSummary } from "@/lib/alinflow/products";
import { Back, Card, Gradient, Layout, Main, Shell, Side } from "./LayoutPrimitives";

type ArchivePanelProps = {
  filteredArchivedCustomers: Customer[];
  visibleArchivedCustomers: Customer[];
  currentPage: number;
  pageCount: number;
  pageSize: number;
  hasCustomerFilter: boolean;
  searchPanel: ReactNode;
  onBack: () => void;
  onPageChange: (page: number) => void;
  onOpenCustomer: (customer: Customer, view: View) => void;
  onRestoreCustomer: (customer: Customer) => void;
};

export function ArchivePanel({
  filteredArchivedCustomers,
  visibleArchivedCustomers,
  currentPage,
  pageCount,
  pageSize,
  hasCustomerFilter,
  searchPanel,
  onBack,
  onPageChange,
  onOpenCustomer,
  onRestoreCustomer,
}: ArchivePanelProps) {
  return (
    <Shell>
      <Back onClick={onBack} />
      <Layout>
        <Main>
          {searchPanel}
          <Card title="Archív ügyfelek">
            <div className="mb-4 flex flex-col gap-2 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
              <span>{filteredArchivedCustomers.length} lezárt / lemondott ügyfél</span>
              {filteredArchivedCustomers.length > pageSize ? <span>{currentPage}. oldal / {pageCount} · max. {pageSize} ügyfél oldalanként</span> : null}
            </div>
            <div className="space-y-3">
              {filteredArchivedCustomers.length === 0 ? (
                <div className="rounded-2xl bg-white/10 p-4 font-black text-slate-300">Még nincs ilyen lezárt vagy lemondott ügyfél.</div>
              ) : null}
              {visibleArchivedCustomers.map((customer) => (
                <div key={customer.id} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-lg font-black">{customer.name || "Névtelen ügyfél"}</p>
                      <p className="text-sm text-slate-400">{customer.city || "nincs település"} · {customer.phone || "nincs telefonszám"}</p>
                      <p className="mt-1 text-xs text-cyan-200/80">{climateSummary(customer.quoteItems)}</p>
                      <p className="mt-1 text-xs text-slate-500">{customer.date ? `${customer.date} · ${customer.time || "nincs idő"}` : "nincs időpont"}</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <span className={`rounded-2xl px-4 py-3 text-sm font-black ${customer.status === "Lezárva" ? "bg-emerald-400/20 text-emerald-200" : "bg-red-500/20 text-red-200"}`}>
                        {customer.status}
                      </span>
                      <button
                        onClick={() => onOpenCustomer(customer, customer.date ? "work" : "lead")}
                        className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 font-black text-cyan-100"
                      >
                        Megnyitás
                      </button>
                      <button
                        onClick={() => onRestoreCustomer(customer)}
                        className="rounded-2xl bg-cyan-300 px-4 py-3 font-black text-slate-950"
                      >
                        Visszaállítás
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredArchivedCustomers.length > pageSize ? (
                <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm font-bold text-slate-300 sm:flex-row sm:items-center sm:justify-between">
                  <span>Maximum {pageSize} ügyfél jelenik meg egy oldalon.</span>
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
              ) : null}
            </div>
          </Card>
        </Main>
        <Side>
          <Gradient title="Archív" value={`${filteredArchivedCustomers.length} ügyfél`} />
          <Card title="Visszaállítás">
            <p className="text-sm leading-relaxed text-slate-400">A visszaállítás gombbal az ügyfél újra aktív lesz. Időpontos ügyfélnél „Időpont foglalva”, időpont nélkülinél „Visszahívandó” státuszra kerül.</p>
          </Card>
        </Side>
      </Layout>
    </Shell>
  );
}
