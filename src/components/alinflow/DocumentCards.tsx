"use client";

import type { Customer, DocumentPreviewType } from "@/lib/alinflow/types";

type DocumentRow = { action: string; title: string; status: string };

export function documentStatusClass(status: string) {
  if (status.includes("Elküld") || status.includes("Kész") || status.includes("Aláírva") || status.includes("Elkészült")) {
    return "bg-emerald-400/20 text-emerald-200";
  }
  if (status.includes("később")) return "bg-slate-500/20 text-slate-300";
  return "bg-amber-400/20 text-amber-200";
}

export function DocumentLibraryActionButtons({
  customer,
  row,
  ready,
  onPreview,
}: {
  customer: Customer;
  row: DocumentRow;
  ready: boolean;
  onPreview: (customer: Customer, type: DocumentPreviewType) => void;
}) {
  if (!ready) return null;

  if (row.action === "MunkalapNyilatkozat") {
    return (
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button onClick={() => onPreview(customer, "work_report")} className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-black text-white">Munkalap</button>
        <button onClick={() => onPreview(customer, "purchase_declaration")} className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-black text-white">Nyilatkozat</button>
      </div>
    );
  }
  if (row.action === "Munkalap") {
    return <button onClick={() => onPreview(customer, "work_report")} className="mt-3 w-full rounded-2xl bg-white/10 px-4 py-3 text-sm font-black text-white">Megtekintés / nyomtatás</button>;
  }
  if (row.action === "Nyilatkozat") {
    return <button onClick={() => onPreview(customer, "purchase_declaration")} className="mt-3 w-full rounded-2xl bg-white/10 px-4 py-3 text-sm font-black text-white">Megtekintés / nyomtatás</button>;
  }
  if (row.action === "Ajánlat") {
    return <button onClick={() => onPreview(customer, "quote_document")} className="mt-3 w-full rounded-2xl bg-blue-400/20 px-4 py-3 text-sm font-black text-blue-100">Ajánlat megtekintése</button>;
  }
  if (row.action === "Időpont") {
    return <button onClick={() => onPreview(customer, "appointment_confirmation")} className="mt-3 w-full rounded-2xl bg-cyan-300/15 px-4 py-3 text-sm font-black text-cyan-100">Időpont megtekintése</button>;
  }

  return null;
}

export function DocumentActionButtons({
  customer,
  row,
  onPreview,
  onEditWorkReport,
  onSendQuote,
  onSendAppointment,
  quoteEmailBusy,
  appointmentEmailBusy,
}: {
  customer: Customer;
  row: DocumentRow;
  onPreview: (customer: Customer, type: DocumentPreviewType) => void;
  onEditWorkReport: (customer: Customer) => void;
  onSendQuote: () => void;
  onSendAppointment: (customer: Customer) => void;
  quoteEmailBusy: boolean;
  appointmentEmailBusy: boolean;
}) {
  const baseButton = "rounded-2xl px-4 py-3 text-sm font-black transition disabled:cursor-wait disabled:opacity-60";
  const viewButton = `${baseButton} bg-white/10 text-white hover:bg-white/15`;
  const sendButton = `${baseButton} bg-blue-400/20 text-blue-100 hover:bg-blue-400/30`;
  const editButton = `${baseButton} bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/30`;
  const helperButton = `${baseButton} bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/25`;
  const gridClass = "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2";

  if (row.action === "MunkalapNyilatkozat") {
    return (
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button onClick={() => onPreview(customer, "work_report")} className={viewButton}>Munkalap</button>
        <button onClick={() => onPreview(customer, "purchase_declaration")} className={viewButton}>Nyilatkozat</button>
        <button onClick={() => onEditWorkReport(customer)} className={`${editButton} sm:col-span-2`}>Szerkesztés / aláírás</button>
      </div>
    );
  }
  if (row.action === "Munkalap") {
    return <div className={gridClass}><button onClick={() => onPreview(customer, "work_report")} className={viewButton}>Megtekintés</button><button onClick={() => onEditWorkReport(customer)} className={editButton}>Szerkesztés / aláírás</button></div>;
  }
  if (row.action === "Nyilatkozat") {
    return <div className={gridClass}><button onClick={() => onPreview(customer, "purchase_declaration")} className={viewButton}>Megtekintés</button><button onClick={() => onEditWorkReport(customer)} className={helperButton}>Aláíráshoz</button></div>;
  }
  if (row.action === "Ajánlat") {
    return <div className={gridClass}><button onClick={() => onPreview(customer, "quote_document")} className={viewButton}>Megtekintés</button><button onClick={onSendQuote} disabled={quoteEmailBusy} className={sendButton}>{quoteEmailBusy ? "Küldés..." : "Küldés"}</button></div>;
  }
  if (row.action === "Időpont") {
    return <div className={gridClass}><button onClick={() => onPreview(customer, "appointment_confirmation")} className={viewButton}>Megtekintés</button><button onClick={() => onSendAppointment(customer)} disabled={appointmentEmailBusy} className={helperButton}>{appointmentEmailBusy ? "Küldés..." : "Email"}</button></div>;
  }
  return null;
}
