"use client";

import { useEffect, useState } from "react";
import { ft } from "@/lib/alinflow/format";
import { loadQuoteDocuments, quoteDocumentRows, type QuoteDocumentReceipt, type QuoteDocumentVersion } from "@/lib/alinflow/quote-documents";
import { documentStatusClass } from "./DocumentCards";

type Props = {
  workspaceId: string;
  customerId: string;
  appointmentId?: string;
  activeQuoteId?: string;
  revision?: number;
  receipts?: QuoteDocumentReceipt[];
  onPreview: (document: QuoteDocumentVersion) => void;
};

const pageSize = 10;
const formatDate = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", dateStyle: "short", timeStyle: "short" });
const actionClass = "document-action-button rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/15 disabled:opacity-50";

function List({ workspaceId, customerId, appointmentId, activeQuoteId, receipts = [], onPreview }: Props) {
  const [sources, setSources] = useState<Awaited<ReturnType<typeof loadQuoteDocuments>>>();
  const [page, setPage] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void loadQuoteDocuments(workspaceId, customerId).then(result => {
      if (current) setSources(result);
    });
    return () => { current = false; };
  }, [workspaceId, customerId, attempt]);

  if (!sources) return <p role="status" className="text-sm text-slate-300">Árajánlatok betöltése…</p>;
  const rows = quoteDocumentRows(sources, receipts, { appointmentId, activeQuoteId });
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  return <div className="min-w-0 space-y-2">
    {sources.failed ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-amber-200">
      Az ajánlatok egy részét nem sikerült betölteni.
      <button type="button" className={actionClass} onClick={() => setAttempt(n => n + 1)}>Újrapróbálás</button>
    </div> : !rows.length ? <p className="text-sm text-slate-300">Még nincs mentett árajánlat.</p> : null}
    {rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(row => {
      const time = Date.parse(row.timestamp ?? "");
      const date = Number.isFinite(time) ? formatDate.format(time) : "A dátum hiányzik";
      const status = row.kind === "saved" ? "Mentve" : "Elküldve";
      return <article key={row.kind + row.id} className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="break-words font-black">{row.kind === "receipt" ? "Árajánlat – küldési nyugta"
              : (row.items[0]?.name || "Árajánlat") + (row.items.length > 1 ? ` + ${row.items.length - 1} tétel` : "")}</p>
            <p className="text-sm text-slate-300">{date}
              {row.kind !== "receipt" && (row.alternatives ? " · Választható ajánlatok" : row.total !== null ? ` · ${ft(row.total)}` : "")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-black ${documentStatusClass(status)}`}>{status}</span>
            {row.kind !== "receipt" && <button type="button" className={actionClass} onClick={() => onPreview(row)}>Megtekintés</button>}
          </div>
        </div>
        {row.kind === "receipt" && <p className="mt-2 text-sm text-slate-300">A nyugta az email elküldésének időpontját igazolja.</p>}
      </article>;
    })}
    {lastPage > 0 && <div className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" disabled={!currentPage} className={actionClass} onClick={() => setPage(currentPage - 1)}>Előző</button>
      <span>{currentPage + 1} / {lastPage + 1}</span>
      <button type="button" disabled={currentPage === lastPage} className={actionClass} onClick={() => setPage(currentPage + 1)}>Következő</button>
    </div>}
  </div>;
}

export function QuoteDocuments(props: Props) {
  return <List key={JSON.stringify([props.workspaceId, props.customerId, props.appointmentId, props.activeQuoteId, props.revision])} {...props} />;
}
