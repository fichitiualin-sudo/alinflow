"use client";

import { useState } from "react";
import type { AppointmentType, Customer, DocumentPreviewType, QuoteItem, ClimateProduct, WorkChecklistCompletedAt, WorkChecklistItemKey, WorkChecklistState } from "@/lib/alinflow/types";
import { Btn, Card, Field, Gradient, Layout, Main, Side } from "@/components/alinflow/LayoutPrimitives";
import { PostalCodeCityFields } from "@/components/alinflow/PostalCodeCityFields";
import { DocumentActionButtons, documentStatusClass } from "@/components/alinflow/DocumentCards";
import { displayAddress, ft, mapsHref, telHref, todayIso } from "@/lib/alinflow/format";
import {
  climateSummary,
  hasCustomProductPrice,
  isCustomQuoteItem,
  itemPriceLine,
  itemTotal,
  itemUnitPrice,
  prod,
  qty,
  sortProducts,
  total,
} from "@/lib/alinflow/products";
import type { View } from "@/lib/alinflow/types";
import { appointmentSummaryLabel, appointmentTypeLabel, firstAppointmentTime, isInstallationAppointment, normalizeAppointmentType } from "@/lib/alinflow/appointments";

type MaterialItem = {
  name: string;
  qty: string;
  unit: string;
  isExtra?: boolean;
};

type DocumentRow = { action: string; title: string; status: string; appointmentType?: AppointmentType; reportId?: string; reportDate?: string; reportTime?: string; reportDateLabel?: string };
type WorkActionDates = {
  appointmentEmail?: string;
  workReport?: string;
  workDone?: string;
  surveyDone?: string;
  maintenanceDone?: string;
  fullClose?: string;
  cancelled?: string;
};

type WorkPagePanelProps = {
  selected: Customer;
  scheduleDate: string;
  scheduleTime: string;
  shownTime: string;
  message: string;
  editCustomer: boolean;
  quoteItems: QuoteItem[];
  products: ClimateProduct[];
  materials: MaterialItem[];
  workResourceEditLocked: boolean;
  allowWorkResourceEdit: boolean;
  canEditWorkResources: boolean;
  quoteEmailBusy: boolean;
  appointmentEmailBusy: boolean;
  thankYouEmailBusy: boolean;
  currentWorkChecklist: WorkChecklistState;
  checklistDates: WorkChecklistCompletedAt;
  actionDates: WorkActionDates;
  documentRows: DocumentRow[];
  maintenanceRows: DocumentRow[];
  workHistory: Customer[];
  onBack: () => void;
  onCloseWork: () => void;
  onRememberExternalCustomer: (customer: Customer, returnView?: View) => void;
  onRecordCustomerPhoneCall: (customer: Customer, returnView?: View) => void;
  onSaveCustomerData: () => void;
  onSetEditCustomer: (value: boolean) => void;
  onUpdateSelectedField: (field: keyof Customer, value: string) => void;
  onSetScheduleDate: (value: string) => void;
  onSetScheduleTime: (value: string) => void;
  onSetScheduleAppointmentType: (value: AppointmentType) => void;
  onSetView: (view: View) => void;
  onUpdateQuoteItem: (index: number, key: keyof QuoteItem, value: string | number | boolean) => void;
  onUpdateQuoteProduct: (index: number, productId: string) => void;
  onRemoveQuoteItem: (index: number) => void;
  onSyncQuoteItemPrice: (index: number) => void;
  onAddQuoteItem: () => void;
  onSetAllowWorkResourceEdit: (value: boolean) => void;
  onSaveWorkChanges: () => void;
  onAddExtraMaterial: () => void;
  onUpdateMaterial: (index: number, key: "name" | "qty" | "unit", value: string) => void;
  onFinalMaterialQty: (material: MaterialItem) => string;
  onUpdateFinalMaterialQty: (materialName: string, value: string) => void;
  onMaterialDisplayUnit: (material: MaterialItem) => string;
  onClimateCountForMaterials: () => number;
  onOpenDocumentPreview: (customer: Customer, type: DocumentPreviewType, reportId?: string) => void;
  onOpenWorkReportFor: (customer: Customer, reportId?: string) => void;
  onSendQuoteEmail: () => void;
  onSendAppointmentEmailFor: (customer: Customer) => void;
  onSendThankYouEmailFor: (customer: Customer) => void;
  onOpenWorkReport: () => void;
  onMarkInstallationDone: () => void;
  onCancelAppointment: () => void;
  onStartMaintenanceForCustomer: (customer: Customer) => void;
  onToggleChecklist: (key: WorkChecklistItemKey) => void;
  onOpenWorkVersion: (customer: Customer) => void;
};

export function WorkPagePanel({
  selected,
  scheduleDate,
  scheduleTime,
  shownTime,
  message,
  editCustomer,
  quoteItems,
  products,
  materials,
  workResourceEditLocked,
  allowWorkResourceEdit,
  canEditWorkResources,
  quoteEmailBusy,
  appointmentEmailBusy,
  thankYouEmailBusy,
  currentWorkChecklist,
  checklistDates,
  actionDates,
  documentRows,
  maintenanceRows,
  workHistory,
  onBack,
  onCloseWork,
  onRememberExternalCustomer,
  onRecordCustomerPhoneCall,
  onSaveCustomerData,
  onSetEditCustomer,
  onUpdateSelectedField,
  onSetScheduleDate,
  onSetScheduleTime,
  onSetScheduleAppointmentType,
  onSetView,
  onUpdateQuoteItem,
  onUpdateQuoteProduct,
  onRemoveQuoteItem,
  onSyncQuoteItemPrice,
  onAddQuoteItem,
  onSetAllowWorkResourceEdit,
  onSaveWorkChanges,
  onAddExtraMaterial,
  onUpdateMaterial,
  onFinalMaterialQty,
  onUpdateFinalMaterialQty,
  onMaterialDisplayUnit,
  onClimateCountForMaterials,
  onOpenDocumentPreview,
  onOpenWorkReportFor,
  onSendQuoteEmail,
  onSendAppointmentEmailFor,
  onSendThankYouEmailFor,
  onOpenWorkReport,
  onMarkInstallationDone,
  onCancelAppointment,
  onStartMaintenanceForCustomer,
  onToggleChecklist,
  onOpenWorkVersion,
}: WorkPagePanelProps) {
  const currentAppointmentType = normalizeAppointmentType(selected.appointmentType);
  const isInstallation = isInstallationAppointment(currentAppointmentType);
  const isSurvey = currentAppointmentType === "survey";
  const isMaintenance = currentAppointmentType === "maintenance";
  const installationFinished = isInstallation && (selected.status === "Szerelés kész – admin folyamatban" || selected.status === "Lezárva");
  const maintenanceFinished = isMaintenance && selected.status === "Lezárva";
  const canStartMaintenance = installationFinished || maintenanceFinished;
  const [showMaterials, setShowMaterials] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [showWorkHistory, setShowWorkHistory] = useState(false);
  const previousInstallationWorks = workHistory.filter((work) => isInstallationAppointment(work.appointmentType) && work.activeAppointmentId !== selected.activeAppointmentId);
  const maintenanceWorks = workHistory.filter((work) => normalizeAppointmentType(work.appointmentType) === "maintenance");
  const messageIsError = message.toLocaleLowerCase("hu-HU").startsWith("nem zárható");
  const workItemsTitle = isSurvey
    ? "Felmérési időpont"
    : isMaintenance
    ? "Karbantartott klímák"
    : "Időponthoz tartozó klímák";

  return (
    <>
      <div className="sticky top-3 z-50 w-fit print:hidden">
        <button onClick={onBack} className="rounded-2xl border border-cyan-200/20 bg-slate-900/95 px-5 py-3 font-black text-cyan-100 shadow-2xl shadow-slate-950/40 backdrop-blur">
          ← Vissza
        </button>
      </div>
      {message ? (
        <div className={`rounded-2xl border p-4 font-black ${messageIsError ? "border-red-300/40 bg-red-500/20 text-red-100" : "border-emerald-300/30 bg-emerald-400/20 text-emerald-100"}`}>
          {message}
        </div>
      ) : null}
      <Layout>
        <Main>
          <Card title="Ügyféladatok">
            <div className="mb-4 flex flex-wrap gap-3">
              {selected.phone ? <a href={telHref(selected.phone)} onClick={() => onRecordCustomerPhoneCall(selected, "work")} className="rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950">Hívás</a> : null}
              {editCustomer ? <Btn color="green" onClick={onSaveCustomerData}>Ügyféladatok mentése</Btn> : <Btn color="blue" onClick={() => onSetEditCustomer(true)}>Ügyféladatok szerkesztése</Btn>}
              {editCustomer ? <button onClick={() => onSetEditCustomer(false)} className="rounded-2xl border border-white/10 bg-white/10 px-5 py-4 font-black text-cyan-200">Mégse</button> : null}
            </div>
            <CustomerGrid
              c={selected}
              editable={editCustomer}
              onChange={onUpdateSelectedField}
              onExternalOpen={() => onRememberExternalCustomer(selected, "work")}
            />
          </Card>

          {(previousInstallationWorks.length || maintenanceWorks.length) ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowWorkHistory((open) => !open)}
                className="rounded-2xl bg-white/10 px-5 py-4 font-black text-cyan-100 ring-1 ring-white/10"
              >
                {showWorkHistory ? "Korábbi munkák elrejtése" : "Korábbi munkák és karbantartások megjelenítése"}
              </button>
            </div>
          ) : null}

          {showWorkHistory ? (
            <Card title="Korábbi munkák">
              <div className="space-y-3">
                {previousInstallationWorks.map((work) => (
                  <button
                    key={work.activeAppointmentId || `${work.id}-${work.date}`}
                    type="button"
                    onClick={() => onOpenWorkVersion(work)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-left hover:border-cyan-300/40"
                  >
                    <p className="font-black">{climateSummary(work.quoteItems) || "Korábbi szerelés"}</p>
                    <p className="mt-1 text-sm font-bold text-slate-400">{work.date ? `${work.date.replaceAll("-", ".")} · ${work.time || ""}` : "dátum nélkül"} · {work.status || "Folyamatban"}</p>
                  </button>
                ))}
                {maintenanceWorks.map((work) => (
                  <button
                    key={work.activeAppointmentId || `${work.id}-${work.date}`}
                    type="button"
                    onClick={() => onOpenWorkVersion(work)}
                    className="w-full rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4 text-left hover:border-emerald-300/50"
                  >
                    <p className="font-black">Karbantartás</p>
                    <p className="mt-1 text-sm font-bold text-slate-400">{work.date ? `${work.date.replaceAll("-", ".")} · ${work.time || ""}` : "dátum nélkül"} · {work.status || "Folyamatban"}</p>
                    {work.quoteItems?.length ? <p className="mt-1 text-xs font-bold text-emerald-200/80">{climateSummary(work.quoteItems)}</p> : null}
                  </button>
                ))}
              </div>
            </Card>
          ) : null}

          <Card title={workItemsTitle}>
            {selected.date ? (
              <div className="mb-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Időpont</p>
                    <p className="text-base font-black text-slate-100">{appointmentSummaryLabel(selected) || `${selected.date.replaceAll("-", ".")} · ${selected.time || shownTime}`}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onSetScheduleDate(selected.date || todayIso());
                      onSetScheduleTime(firstAppointmentTime(selected.time));
                      onSetScheduleAppointmentType(normalizeAppointmentType(selected.appointmentType));
                      onSetView("schedule");
                    }}
                    className="shrink-0 rounded-2xl bg-cyan-300/15 px-4 py-3 text-sm font-black text-cyan-100 ring-1 ring-cyan-200/20"
                  >
                    Időpont módosítása
                  </button>
                </div>
              </div>
            ) : null}
            {isMaintenance ? (
              <div className="mb-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-100">
                Ez karbantartási időpont. A klímák csak tájékoztató jelleggel jelennek meg, készletet és szerelési anyagot nem foglalnak.
              </div>
            ) : null}
            {(isInstallation || isMaintenance) && quoteItems.length === 0 ? <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-sm font-bold text-slate-300">Nincs rögzített klíma.</div> : null}
            {isMaintenance && quoteItems.length ? (
              <div className="space-y-3">
                {quoteItems.map((it, i) => (
                  <div key={i} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                    <p className="font-black">{isCustomQuoteItem(it) ? it.customName || "Egyedi klíma" : prod(it.productId).name || "Klíma"}</p>
                    <p className="mt-1 text-sm text-slate-400">{Number(it.quantity) || 1} db</p>
                  </div>
                ))}
              </div>
            ) : null}
            {isInstallation ? <div className="space-y-3">
              {quoteItems.map((it, i) => (
                <div key={i} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_150px_44px]">
                    {isCustomQuoteItem(it) ? (
                      <input className="input disabled:cursor-not-allowed disabled:opacity-60" disabled={!canEditWorkResources} value={it.customName || ""} onChange={(event) => onUpdateQuoteItem(i, "customName", event.target.value)} placeholder="Klíma megnevezése" />
                    ) : (
                      <ProductSelect products={products} value={it.productId} onChange={(value) => onUpdateQuoteProduct(i, value)} disabled={!canEditWorkResources} />
                    )}
                    <input className="input disabled:cursor-not-allowed disabled:opacity-60" type="number" min={1} value={it.quantity} disabled={!canEditWorkResources} onChange={(event) => onUpdateQuoteItem(i, "quantity", numericInputValue(event.target.value))} />
                    <input className="input disabled:cursor-not-allowed disabled:opacity-60" type="number" min={0} disabled={!canEditWorkResources} value={it.customPrice ?? itemUnitPrice(it)} onChange={(event) => onUpdateQuoteItem(i, "customPrice", priceInputValue(event.target.value))} />
                    <button className="rounded-xl bg-white/10 font-black disabled:cursor-not-allowed disabled:opacity-40" disabled={!canEditWorkResources} onClick={() => onRemoveQuoteItem(i)}>×</button>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-white/5 p-3 text-sm md:flex-row md:items-center md:justify-between">
                    <span>{itemPriceLine(it)}{hasCustomProductPrice(it) ? " · kézzel módosított ár" : ""}</span>
                    <b>{ft(itemTotal(it))}</b>
                  </div>
                  {hasCustomProductPrice(it) ? (
                    <button type="button" disabled={!canEditWorkResources} onClick={() => onSyncQuoteItemPrice(i)} className="mt-2 w-full rounded-2xl bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 disabled:cursor-not-allowed disabled:opacity-40">
                      Ár frissítése a klíma listaárára: {ft(prod(it.productId).price)}
                    </button>
                  ) : null}
                </div>
              ))}
              <div className="flex flex-col gap-2 rounded-3xl bg-cyan-300 p-5 text-slate-950 md:flex-row md:items-center md:justify-between">
                <b className="text-xl">Összesen</b>
                <b className="text-2xl">{ft(total(quoteItems))}</b>
              </div>
            </div> : null}
            {isInstallation ? <div className="mt-4 flex flex-col gap-3 md:flex-row">
              <button className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canEditWorkResources} onClick={onAddQuoteItem}>+ Klíma hozzáadása</button>
              {workResourceEditLocked && !allowWorkResourceEdit ? <button className="rounded-2xl bg-amber-300 px-5 py-4 font-black text-slate-950" onClick={() => onSetAllowWorkResourceEdit(true)}>Módosítás engedélyezése</button> : null}
              {canEditWorkResources && isInstallation ? <button className="rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950" onClick={onSaveWorkChanges}>Módosítás mentése az időpontra</button> : null}
            </div> : null}
          </Card>

          {isInstallation ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowMaterials((open) => !open)}
                className="rounded-2xl bg-white/10 px-5 py-4 font-black text-cyan-100 ring-1 ring-white/10"
              >
                {showMaterials ? "Felhasznált anyagok elrejtése" : "Felhasznált anyagok megjelenítése"}
              </button>
            </div>
          ) : null}

          {isInstallation && showMaterials ? <Card title="Felhasznált anyagok">
            <div className="mb-4 flex justify-end">
              <button className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canEditWorkResources} onClick={onAddExtraMaterial}>+ Egyéb anyag</button>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {materials.map((material, index) => (
                <div key={index} className="rounded-3xl border border-white/10 bg-slate-900/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {material.isExtra ? <input className="input disabled:cursor-not-allowed disabled:opacity-60" disabled={!canEditWorkResources} value={material.name} onChange={(event) => onUpdateMaterial(index, "name", event.target.value)} /> : <p className="font-black">{material.name}</p>}
                      {material.isExtra ? <p className="mt-1 text-xs text-slate-400">Egyéb anyag</p> : null}
                    </div>
                    {!material.isExtra ? <span className="rounded-full bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-200">x{onClimateCountForMaterials()}</span> : null}
                  </div>

                  <div className="mt-4">
                    {material.name === "Konzol" ? (
                      <select className="input disabled:cursor-not-allowed disabled:opacity-60" disabled={!canEditWorkResources} value={material.qty} onChange={(event) => onUpdateMaterial(index, "qty", event.target.value)}>
                        <option>450-es konzol</option>
                        <option>550-es konzol</option>
                        <option>Egyedi konzol</option>
                      </select>
                    ) : (
                      <input className="input disabled:cursor-not-allowed disabled:opacity-60" disabled={!canEditWorkResources} value={onFinalMaterialQty(material)} onChange={(event) => onUpdateFinalMaterialQty(material.name, event.target.value)} />
                    )}
                  </div>

                  <div className="mt-3 rounded-2xl bg-white/5 p-3 text-sm">
                    <span className="text-slate-400">Egység / mennyiség:</span>
                    <b className="ml-2">{onMaterialDisplayUnit(material)}</b>
                  </div>

                  {material.isExtra ? <div className="mt-3"><input className="input disabled:cursor-not-allowed disabled:opacity-60" disabled={!canEditWorkResources} value={material.unit} onChange={(event) => onUpdateMaterial(index, "unit", event.target.value)} placeholder="egység" /></div> : null}
                </div>
              ))}
            </div>
          </Card> : null}
        </Main>

        <Side>
          <Gradient title="Munka státusz" value={selected.status === "Szerelés kész – admin folyamatban" ? `${appointmentTypeLabel(selected.appointmentType)} kész – admin folyamatban` : selected.status || "Folyamatban"} />

          <button
            type="button"
            onClick={() => setShowDocuments((open) => !open)}
            className="w-full rounded-2xl bg-white/10 px-5 py-4 text-left font-black text-cyan-100 ring-1 ring-white/10"
          >
            {showDocuments ? "Dokumentumok elrejtése" : "Dokumentumok megjelenítése"}
          </button>

          {showDocuments ? <Card title="Dokumentumok">
            <div className="space-y-3">
              {documentRows.map((row) => (
                <DocumentRowCard
                  key={`${row.title}-${row.reportId || row.reportDateLabel || row.reportDate || row.action || "main"}`}
                  selected={selected}
                  row={row}
                  quoteEmailBusy={quoteEmailBusy}
                  appointmentEmailBusy={appointmentEmailBusy}
                  thankYouEmailBusy={thankYouEmailBusy}
                  onOpenDocumentPreview={onOpenDocumentPreview}
                  onOpenWorkReportFor={onOpenWorkReportFor}
                  onSendQuoteEmail={onSendQuoteEmail}
                  onSendAppointmentEmailFor={onSendAppointmentEmailFor}
                  onSendThankYouEmailFor={onSendThankYouEmailFor}
                />
              ))}
            </div>
            <MaintenanceHistory
              selected={selected}
              rows={maintenanceRows}
              canStartMaintenance={canStartMaintenance}
              quoteEmailBusy={quoteEmailBusy}
              appointmentEmailBusy={appointmentEmailBusy}
              thankYouEmailBusy={thankYouEmailBusy}
              onOpenDocumentPreview={onOpenDocumentPreview}
              onOpenWorkReportFor={onOpenWorkReportFor}
              onSendQuoteEmail={onSendQuoteEmail}
              onSendAppointmentEmailFor={onSendAppointmentEmailFor}
              onSendThankYouEmailFor={onSendThankYouEmailFor}
              onStartMaintenanceForCustomer={onStartMaintenanceForCustomer}
            />
          </Card> : null}

          <Card title={isMaintenance ? "Karbantartás műveletei" : "Lezárási műveletek"}>
            <div className="space-y-3">
              {isSurvey ? null : (
                <ActionButton
                  color="cyan"
                  onClick={onOpenWorkReport}
                  label={isMaintenance ? "Karbantartási munkalap és aláírás" : "Munkalap és egyszerű aláírás"}
                  doneAt={actionDates.workReport}
                />
              )}
              {isInstallation ? <ActionButton
                color="blue"
                onClick={() => onToggleChecklist("nkvh")}
                label="NKVH"
                doneAt={currentWorkChecklist.nkvh ? checklistDates.nkvh : undefined}
                icon={currentWorkChecklist.nkvh ? "✓" : "○"}
              /> : null}
              {isSurvey ? (
                <ActionButton color="green" onClick={onMarkInstallationDone} label="Felmérés kész – árajánlat készítése" doneAt={actionDates.surveyDone} />
              ) : isMaintenance ? (
                selected.status !== "Lezárva" ? <ActionButton color="green" onClick={onMarkInstallationDone} label="Karbantartás lezárása" doneAt={actionDates.maintenanceDone} /> : null
              ) : (
                <ActionButton color="amber" onClick={() => onToggleChecklist("alinInvoice")} label="Számlázás" doneAt={currentWorkChecklist.alinInvoice ? checklistDates.alinInvoice : undefined} icon={currentWorkChecklist.alinInvoice ? "✓" : "○"} />
              )}
              {isInstallation ? <ActionButton color="green" onClick={onCloseWork} label="Teljes lezárás" doneAt={actionDates.fullClose} /> : null}
              {selected.status !== "Lezárva" ? <ActionButton color="red" onClick={onCancelAppointment} label={isMaintenance ? "Karbantartási időpont lemondása" : "Időpont törlése / lemondva"} doneAt={actionDates.cancelled} icon="×" /> : null}
            </div>
          </Card>

        </Side>
      </Layout>
    </>
  );
}



function formatDoneAt(value?: string) {
  if (!value) return "";
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

function ActionButton({
  label,
  doneAt,
  color = "cyan",
  icon = "→",
  onClick,
}: {
  label: string;
  doneAt?: string;
  color?: "cyan" | "green" | "blue" | "amber" | "red";
  icon?: string;
  onClick?: () => void;
}) {
  const colorClass = {
    cyan: "from-cyan-300 to-sky-400 text-slate-950 shadow-cyan-500/20",
    green: "from-emerald-400 to-green-500 text-slate-950 shadow-emerald-500/20",
    blue: "from-blue-400 to-indigo-500 text-white shadow-blue-500/20",
    amber: "from-amber-300 to-orange-400 text-slate-950 shadow-amber-500/20",
    red: "from-red-500 to-rose-500 text-white shadow-red-500/20",
  }[color];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center justify-between gap-3 rounded-3xl bg-gradient-to-br ${colorClass} px-5 py-4 text-left font-black shadow-xl transition hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99]`}
    >
      <span className="min-w-0">
        <span className="block leading-tight">{label}</span>
        {doneAt ? <span className="mt-1 block text-xs font-black opacity-75">{formatDoneAt(doneAt)}</span> : null}
      </span>
      <span className="shrink-0 rounded-full bg-black/10 px-3 py-1 text-sm transition group-hover:translate-x-1">{icon}</span>
    </button>
  );
}

function DocumentRowCard({
  selected,
  row,
  quoteEmailBusy,
  appointmentEmailBusy,
  thankYouEmailBusy,
  onOpenDocumentPreview,
  onOpenWorkReportFor,
  onSendQuoteEmail,
  onSendAppointmentEmailFor,
  onSendThankYouEmailFor,
}: {
  selected: Customer;
  row: DocumentRow;
  quoteEmailBusy: boolean;
  appointmentEmailBusy: boolean;
  thankYouEmailBusy: boolean;
  onOpenDocumentPreview: (customer: Customer, type: DocumentPreviewType, reportId?: string) => void;
  onOpenWorkReportFor: (customer: Customer, reportId?: string) => void;
  onSendQuoteEmail: () => void;
  onSendAppointmentEmailFor: (customer: Customer) => void;
  onSendThankYouEmailFor: (customer: Customer) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black">{row.title}</p>
          {row.reportDateLabel ? <p className="mt-1 text-xs font-bold text-slate-400">{row.reportDateLabel}</p> : null}
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${documentStatusClass(row.status)}`}>{row.status}</span>
      </div>
      <DocumentActionButtons
        customer={selected}
        row={row}
        onPreview={onOpenDocumentPreview}
        onEditWorkReport={onOpenWorkReportFor}
        onSendQuote={onSendQuoteEmail}
        onSendAppointment={onSendAppointmentEmailFor}
        quoteEmailBusy={quoteEmailBusy}
        appointmentEmailBusy={appointmentEmailBusy}
        thankYouEmailBusy={thankYouEmailBusy}
        onSendThankYou={onSendThankYouEmailFor}
      />
    </div>
  );
}

function MaintenanceHistory({
  selected,
  rows,
  canStartMaintenance,
  onOpenDocumentPreview,
  onOpenWorkReportFor,
  onStartMaintenanceForCustomer,
}: {
  selected: Customer;
  rows: DocumentRow[];
  canStartMaintenance: boolean;
  quoteEmailBusy: boolean;
  appointmentEmailBusy: boolean;
  thankYouEmailBusy: boolean;
  onOpenDocumentPreview: (customer: Customer, type: DocumentPreviewType, reportId?: string) => void;
  onOpenWorkReportFor: (customer: Customer, reportId?: string) => void;
  onSendQuoteEmail: () => void;
  onSendAppointmentEmailFor: (customer: Customer) => void;
  onSendThankYouEmailFor: (customer: Customer) => void;
  onStartMaintenanceForCustomer: (customer: Customer) => void;
}) {
  if (!rows.length && !canStartMaintenance) return null;

  const reportRows = rows.filter((row) => row.action !== "MaintenanceBundle");
  const printableReportRows = reportRows.filter((row) => row.action === "MaintenanceReport" && Boolean(row.reportId));
  const maintenanceCustomerBase = { ...selected, appointmentType: "maintenance" as AppointmentType };

  function rowCustomer(row: DocumentRow): Customer {
    return {
      ...maintenanceCustomerBase,
      date: row.reportDate || selected.date,
      time: row.reportTime || selected.time,
      activeWorkReportId: row.reportId,
    };
  }

  return (
    <div className="mt-4 rounded-3xl border border-white/10 bg-slate-950/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-lg font-black text-slate-100">Karbantartási napló</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {printableReportRows.length ? (
            <button
              type="button"
              onClick={() => onOpenDocumentPreview(maintenanceCustomerBase, "all_work_reports")}
              className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-black text-emerald-100 ring-1 ring-emerald-300/10"
            >
              Összes munkalap
            </button>
          ) : null}
          {canStartMaintenance ? (
            <button
              type="button"
              onClick={() => onStartMaintenanceForCustomer(selected)}
              className="rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-slate-950"
            >
              Új karbantartás
            </button>
          ) : null}
        </div>
      </div>

      {reportRows.length ? (
        <div className="mt-4 divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60">
          {reportRows.map((row) => {
            const label = row.reportDateLabel || row.reportDate || row.title || "Dátum nélkül";
            const isCancelled = row.action === "MaintenanceCancelled" || row.status.includes("Lemond");
            const hasReport = row.action === "MaintenanceReport" && Boolean(row.reportId);
            const customerForRow = rowCustomer(row);
            return (
              <div key={`${row.action}-${row.reportId || row.reportDateLabel || row.reportDate || row.title}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-100">{label}</p>
                  {isCancelled ? <p className="mt-1 text-xs font-black text-red-200">Lemondva</p> : row.status ? <p className="mt-1 text-xs font-bold text-slate-400">{row.status}</p> : null}
                </div>
                {isCancelled ? null : hasReport ? (
                  <button
                    type="button"
                    onClick={() => onOpenDocumentPreview(customerForRow, "work_report", row.reportId)}
                    className="shrink-0 rounded-xl bg-white/10 px-4 py-3 text-sm font-black text-white hover:bg-white/15"
                  >
                    Megtekintés
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenWorkReportFor(customerForRow, row.reportId)}
                    className="shrink-0 rounded-xl bg-emerald-400/20 px-4 py-3 text-sm font-black text-emerald-100 hover:bg-emerald-400/30"
                  >
                    Munkalap
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border border-dashed border-white/10 bg-slate-900/60 p-4 text-sm font-bold text-slate-400">Még nincs karbantartási bejegyzés.</p>
      )}
    </div>
  );
}

function CustomerGrid({
  c,
  editable = false,
  onChange,
  onExternalOpen,
}: {
  c: Customer;
  editable?: boolean;
  onChange?: (field: keyof Customer, value: string) => void;
  onExternalOpen?: () => void;
}) {
  if (editable) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <EditField label="Név" value={c.name} onChange={(value) => onChange?.("name", value)} />
        <EditField label="Telefonszám" value={c.phone} onChange={(value) => onChange?.("phone", value)} />
        <EditField label="Email" value={c.email || ""} onChange={(value) => onChange?.("email", value)} />
        <PostalCodeCityFields
          postalCode={c.postalCode || ""}
          city={c.city}
          onChange={(field, value) => onChange?.(field, value)}
        />
        <EditField label="Cím" value={c.address} onChange={(value) => onChange?.("address", value)} />
        <label className="rounded-2xl bg-slate-900/80 p-4 md:col-span-2">
          <span className="text-sm text-slate-400">Telefonos jegyzet</span>
          <textarea className="mt-2 min-h-28 w-full bg-transparent text-base font-bold leading-relaxed outline-none" value={c.notes || ""} onChange={(event) => onChange?.("notes", event.target.value)} placeholder="Hívás közbeni megjegyzés..." />
        </label>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="Név" value={c.name} />
      <div className="rounded-2xl bg-slate-900/80 p-4">
        <p className="text-sm text-slate-400">Telefonszám</p>
        <p className="mt-2 text-lg font-black">{c.phone || "nincs megadva"}</p>
      </div>
      <Field label="Email" value={c.email || "nincs megadva"} />
      <Field label="Település" value={[c.postalCode, c.city].filter(Boolean).join(" ") || "nincs megadva"} />
      <div className="rounded-2xl bg-slate-900/80 p-4">
        <p className="text-sm text-slate-400">Cím</p>
        <p className="mt-1 text-lg font-black">{displayAddress(c) || "nincs megadva"}</p>
        {c.address || c.city || c.postalCode ? <a href={mapsHref(c)} target="_blank" rel="noreferrer" onClick={onExternalOpen} className="mt-3 block rounded-xl bg-cyan-300 px-4 py-3 text-center font-black text-slate-950">Útvonal tervezése</a> : null}
      </div>
      <div className="rounded-2xl bg-slate-900/80 p-4 md:col-span-2">
        <p className="text-sm text-slate-400">Telefonos jegyzet</p>
        <p className="mt-2 whitespace-pre-wrap text-base font-bold leading-relaxed text-slate-100">{c.notes || "nincs megjegyzés"}</p>
      </div>
    </div>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="rounded-2xl bg-slate-900/80 p-4">
      <span className="text-sm text-slate-400">{label}</span>
      <input className="mt-2 w-full bg-transparent text-lg font-black outline-none" value={value || ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ProductSelect({ products, value, onChange, disabled = false }: { products: ClimateProduct[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const sorted = sortProducts(products);
  const selectValue = sorted.some((product) => product.id === value) ? value : "";
  return (
    <select value={selectValue} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="input disabled:cursor-not-allowed disabled:opacity-60">
      <option value="">Válassz klímát...</option>
      {sorted.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
    </select>
  );
}

function numericInputValue(value: string) {
  if (value === "") return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, numeric) : "";
}

function priceInputValue(value: string) {
  if (value === "") return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : "";
}
