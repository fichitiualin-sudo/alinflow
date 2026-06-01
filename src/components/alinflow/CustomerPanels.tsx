"use client";

import type { ReactNode, RefObject } from "react";
import type { Customer, LeadImportCandidate } from "@/lib/alinflow/types";
import { STATUS_OPTIONS } from "@/lib/alinflow/constants";
import { climateSummary } from "@/lib/alinflow/products";
import { formatPostalCity } from "@/lib/alinflow/postal-codes";

function PanelCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl">
      <h2 className="mb-5 text-2xl font-black">{title}</h2>
      {children}
    </section>
  );
}

const PANEL_PAGE_SIZE = 20;

function formatCustomerCreatedAt(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("hu-HU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function customerCreatedLabel(customer: Customer) {
  const created = formatCustomerCreatedAt(customer.createdAt);
  if (!created) return "";
  const source = (customer.source || "").toLocaleLowerCase("hu-HU");
  return source.includes("csv") || source.includes("import") ? `CSV import · Érdeklődött: ${created}` : `Érdeklődött: ${created}`;
}

function importCandidateInquiredAt(row: LeadImportCandidate) {
  const candidate = row as LeadImportCandidate & { inquiredAt?: string; createdAt?: string };
  return candidate.inquiredAt || candidate.createdAt || "";
}

export function CustomerSearchPanel({
  title = "Ügyfélkereső",
  search,
  statusFilter,
  filteredCustomers,
  hasFilter,
  onSearchChange,
  onStatusFilterChange,
  onClearFilter,
  onOpenCustomer,
  customerStatusLabel,
}: {
  title?: string;
  search: string;
  statusFilter: string;
  filteredCustomers: Customer[];
  hasFilter: boolean;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onClearFilter: () => void;
  onOpenCustomer: (customer: Customer) => void;
  customerStatusLabel: (customer: Customer) => string;
}) {
  const results = filteredCustomers.slice(0, PANEL_PAGE_SIZE);

  return (
    <PanelCard title={title}>
      <div className="space-y-3">
        <input
          className="input"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Keresés név, telefon, irányítószám, település, cím, klíma alapján..."
        />
        <select
          className="input"
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value)}
        >
          <option value="all">Összes státusz</option>
          {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        {hasFilter ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-400">
              <span>{filteredCustomers.length} találat</span>
              <button onClick={onClearFilter} className="rounded-xl bg-white/10 px-3 py-2 text-cyan-100">Szűrő törlése</button>
            </div>
            {results.length === 0 ? <div className="rounded-2xl bg-white/10 p-4 text-sm font-black text-slate-300">Nincs találat.</div> : null}
            {results.map((customer) => (
              <button
                key={customer.id}
                onClick={() => onOpenCustomer(customer)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-left transition hover:border-cyan-300/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-white">{customer.name || "Névtelen ügyfél"}</p>
                    <p className="mt-1 text-xs text-slate-400">{formatPostalCity(customer.postalCode, customer.city)} · {customer.phone || customer.email || "nincs elérhetőség"}</p>
                    <p className="mt-1 text-xs text-cyan-200/80">{climateSummary(customer.quoteItems)}</p>
                    {customerCreatedLabel(customer) ? <p className="mt-1 text-xs font-bold text-emerald-200/80">{customerCreatedLabel(customer)}</p> : null}
                  </div>
                  <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-[11px] font-black text-slate-200">{customerStatusLabel(customer)}</span>
                </div>
              </button>
            ))}
            {filteredCustomers.length > results.length ? <p className="text-xs text-slate-500">Csak az első {results.length} találat látszik. Pontosíts a keresésen.</p> : null}
          </div>
        ) : null}
      </div>
    </PanelCard>
  );
}

export function LeadImportPanel({
  inputRef,
  rows,
  message,
  busy,
  onFileSelected,
  onImport,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  rows: LeadImportCandidate[];
  message: string;
  busy: boolean;
  onFileSelected: (file?: File | null) => void;
  onImport: () => void;
}) {
  const importable = rows.filter((row) => !row.duplicate && !row.invalid);
  const skipped = rows.filter((row) => row.duplicate || row.invalid);
  const merged = rows.filter((row) => !row.duplicate && !row.invalid && (row.mergedRows || 1) > 1).length;
  const previewRows = rows.slice(0, PANEL_PAGE_SIZE);

  return (
    <PanelCard title="Meta lead import">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          onFileSelected(file);
          event.currentTarget.value = "";
        }}
      />
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950"
        >
          CSV feltöltése
        </button>
        {message ? <div className="rounded-2xl bg-slate-950/60 p-3 text-sm font-bold text-slate-200">{message}</div> : null}

        {rows.length ? (
          <div className="space-y-2">
            {previewRows.map((row) => {
              const inquiredAt = importCandidateInquiredAt(row);

              return (
                <div key={row.id} className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-white">{row.name || "Névtelen sor"}</p>
                      <p className="mt-1 text-xs text-slate-400">{row.phone || "nincs telefonszám"} · {row.email || "nincs email"}</p>
                      {row.city || row.postalCode ? <p className="mt-1 text-xs text-slate-400">{formatPostalCity(row.postalCode, row.city)}</p> : null}
                      {inquiredAt ? <p className="mt-1 text-xs font-bold text-emerald-200/80">Érdeklődött: {formatCustomerCreatedAt(inquiredAt)}</p> : null}
                      {!row.duplicate && !row.invalid && (row.mergedRows || 1) > 1 ? <p className="mt-1 text-xs font-bold text-cyan-200">{row.mergedRows} azonos lead összevonva egy ügyféllé</p> : null}
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black ${row.invalid ? "bg-red-400/20 text-red-200" : row.duplicate ? "bg-amber-400/20 text-amber-200" : "bg-emerald-400/20 text-emerald-200"}`}>
                      {row.invalid ? "hibás" : row.duplicate ? "kihagyva" : "új"}
                    </span>
                  </div>
                  {row.duplicateReason || row.invalidReason ? <p className="mt-2 text-xs font-bold text-slate-500">{row.duplicateReason || row.invalidReason}</p> : null}
                </div>
              );
            })}
            {rows.length > previewRows.length ? <p className="text-xs text-slate-500">+ {rows.length - previewRows.length} további sor az előnézetben.</p> : null}
            <button
              type="button"
              disabled={busy || !importable.length}
              onClick={onImport}
              className="w-full rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Importálás..." : `${importable.length} új érdeklődő importálása`}
            </button>
            {merged ? <p className="text-xs text-cyan-200/80">A CSV-n belüli duplikációkból egy ügyfél készül, a hiányzó adatokat összevonja.</p> : null}
            {skipped.length ? <p className="text-xs text-slate-500">A már meglévő ügyfeleket és hibás sorokat a rendszer kihagyja.</p> : null}
          </div>
        ) : null}
      </div>
    </PanelCard>
  );
}
