"use client";

import type { AppointmentType, Customer, DocumentPreviewType } from "@/lib/alinflow/types";

type DocumentRow = {
  action: string;
  title: string;
  status: string;
  appointmentType?: AppointmentType;
  reportId?: string;
  purchaseDeclarationId?: string;
  reportDate?: string;
  reportTime?: string;
};

function actionCustomerFor(customer: Customer, row: DocumentRow): Customer {
  return {
    ...customer,
    appointmentType: row.appointmentType || customer.appointmentType,
    date: row.reportDate || customer.date,
    time: row.reportTime || customer.time,
    activeWorkReportId: row.reportId,
  };
}

export function documentStatusClass(status: string) {
  if (status.toLowerCase().includes("aláírásra vár")) return "bg-amber-400/20 text-amber-200";
  if (status.includes("Lemond")) return "bg-red-500/20 text-red-200";
  if (status.includes("Elküld") || status.includes("Kész") || status.includes("Lezár") || status.includes("Aláírva") || status.includes("Elkészült")) {
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
  onPreview: (customer: Customer, type: DocumentPreviewType, purchaseDeclarationId?: string) => void;
}) {
  if (!ready && row.action !== "MaintenanceBundle") return null;

  const actionCustomer = actionCustomerFor(customer, row);
  const buttonRow = "flex flex-wrap items-center gap-2";
  const baseButton = "document-action-button rounded-xl px-3 py-2 text-xs font-black transition";
  const viewButton = `${baseButton} bg-white/10 text-white hover:bg-white/15`;
  const bundleButton = `${baseButton} bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/30`;
  const quoteButton = `${baseButton} bg-blue-400/20 text-blue-100 hover:bg-blue-400/30`;
  const appointmentButton = `${baseButton} bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/25`;

  if (row.action === "MunkalapNyilatkozat") {
    return (
      <div className={buttonRow}>
        <button onClick={() => onPreview(actionCustomer, "work_report")} className={viewButton}>Munkalap</button>
        <button onClick={() => onPreview(actionCustomer, "purchase_declaration", row.purchaseDeclarationId)} className={viewButton}>Nyilatkozat</button>
      </div>
    );
  }
  if (row.action === "MaintenanceBundle") {
    return <div className={buttonRow}><button onClick={() => onPreview(actionCustomer, "all_work_reports")} className={bundleButton}>Összes munkalap megtekintése / nyomtatása</button></div>;
  }
  if (row.action === "MaintenanceReport" || row.action === "Munkalap") {
    return <div className={buttonRow}><button onClick={() => onPreview(actionCustomer, "work_report")} className={viewButton}>Megtekintés / nyomtatás</button></div>;
  }
  if (row.action === "Nyilatkozat") {
    return <div className={buttonRow}><button onClick={() => onPreview(actionCustomer, "purchase_declaration", row.purchaseDeclarationId)} className={viewButton}>Megtekintés / nyomtatás</button></div>;
  }
  if (row.action === "Ajánlat") {
    return <div className={buttonRow}><button onClick={() => onPreview(actionCustomer, "quote_document")} className={quoteButton}>Ajánlat megtekintése</button></div>;
  }
  if (row.action === "Időpont") {
    return <div className={buttonRow}><button onClick={() => onPreview(actionCustomer, "appointment_confirmation")} className={appointmentButton}>Időpont megtekintése</button></div>;
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
  onSendThankYou,
  quoteEmailBusy,
  thankYouEmailBusy,
  appointmentEmailBusy,
}: {
  customer: Customer;
  row: DocumentRow;
  onPreview: (customer: Customer, type: DocumentPreviewType, purchaseDeclarationId?: string) => void;
  onEditWorkReport: (customer: Customer) => void;
  onSendQuote: () => void;
  onSendAppointment: (customer: Customer) => void;
  onSendThankYou?: (customer: Customer) => void;
  quoteEmailBusy: boolean;
  thankYouEmailBusy?: boolean;
  appointmentEmailBusy: boolean;
}) {
  const actionCustomer = actionCustomerFor(customer, row);
  const baseButton = "document-action-button rounded-2xl px-4 py-3 text-sm font-black transition disabled:cursor-wait disabled:opacity-60";
  const viewButton = `${baseButton} bg-white/10 text-white hover:bg-white/15`;
  const editButton = `${baseButton} email-action-button bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/30`;
  const helperButton = `${baseButton} bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/25`;
  const thankButton = `${baseButton} email-action-button bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/30`;
  const gridClass = "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2";

  if (row.action === "MunkalapNyilatkozat") {
    return (
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button onClick={() => onPreview(actionCustomer, "work_report")} className={viewButton}>Munkalap</button>
        <button onClick={() => onPreview(actionCustomer, "purchase_declaration", row.purchaseDeclarationId)} className={viewButton}>Nyilatkozat</button>
        <button onClick={() => onEditWorkReport(actionCustomer)} className={`${editButton} sm:col-span-2`}>Szerkesztés / aláírás</button>
      </div>
    );
  }
  if (row.action === "MaintenanceBundle") {
    return <button onClick={() => onPreview(actionCustomer, "all_work_reports")} className="document-action-button mt-3 w-full rounded-2xl bg-emerald-400/20 px-4 py-3 text-sm font-black text-emerald-100 hover:bg-emerald-400/30">Összes munkalap letöltése / nyomtatása</button>;
  }
  if (row.action === "MaintenanceReport") {
    return (
      <div className={gridClass}>
        <button onClick={() => onPreview(actionCustomer, "work_report")} className={viewButton}>Megtekintés</button>
        <button onClick={() => onEditWorkReport(actionCustomer)} className={editButton}>Szerkesztés / aláírás</button>
      </div>
    );
  }
  if (row.action === "Munkalap") {
    return <div className={gridClass}><button onClick={() => onPreview(actionCustomer, "work_report")} className={viewButton}>Megtekintés</button><button onClick={() => onEditWorkReport(actionCustomer)} className={editButton}>Szerkesztés / aláírás</button></div>;
  }
  if (row.action === "Nyilatkozat") {
    return <div className={gridClass}><button onClick={() => onPreview(actionCustomer, "purchase_declaration", row.purchaseDeclarationId)} className={viewButton}>Megtekintés</button><button onClick={() => onEditWorkReport(actionCustomer)} className={helperButton}>Aláíráshoz</button></div>;
  }
  if (row.action === "Ajánlat") {
    return <div className={gridClass}><button onClick={() => onPreview(actionCustomer, "quote_document")} className={viewButton}>Megtekintés</button><button onClick={onSendQuote} disabled={quoteEmailBusy} className={thankButton}>{quoteEmailBusy ? "Küldés..." : "Email"}</button></div>;
  }
  if (row.action === "Időpont") {
    return <div className={gridClass}><button onClick={() => onPreview(actionCustomer, "appointment_confirmation")} className={viewButton}>Megtekintés</button><button onClick={() => onSendAppointment(actionCustomer)} disabled={appointmentEmailBusy} className={thankButton}>{appointmentEmailBusy ? "Küldés..." : "Email"}</button></div>;
  }
  if (row.action === "KoszonoEmail") {
    return <button onClick={() => onSendThankYou?.(actionCustomer)} disabled={thankYouEmailBusy} className={`mt-3 w-full ${thankButton}`}>{thankYouEmailBusy ? "Küldés..." : "Köszönő email küldése"}</button>;
  }
  return null;
}
