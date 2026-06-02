"use client";

import type { AppointmentType, Customer, CustomerTimelineItem, DocumentPreviewType, QuoteItem, ClimateProduct, WorkChecklistState } from "@/lib/alinflow/types";
import { Btn, Card, Field, Gradient,  Layout, Main, Side, StepButton } from "@/components/alinflow/LayoutPrimitives";
import { PostalCodeCityFields } from "@/components/alinflow/PostalCodeCityFields";
import { DocumentActionButtons, documentStatusClass } from "@/components/alinflow/DocumentCards";
import { CustomerTimeline } from "@/components/alinflow/CustomerTimeline";
import { displayAddress, ft, mapsHref, telHref, todayIso } from "@/lib/alinflow/format";
import {
  hasCustomProductPrice,
  isCustomQuoteItem,
  itemPriceLine,
  itemTotal,
  prod,
  qty,
  sortProducts,
} from "@/lib/alinflow/products";
import type { View } from "@/lib/alinflow/types";
import { appointmentSummaryLabel, appointmentTypeLabel, firstAppointmentTime, isInstallationAppointment, normalizeAppointmentType } from "@/lib/alinflow/appointments";

type MaterialItem = {
  name: string;
  qty: string;
  unit: string;
  isExtra?: boolean;
};

type ChecklistItem = { key: keyof WorkChecklistState; label: string };
type DocumentRow = { action: string; title: string; status: string; appointmentType?: AppointmentType };

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
  checklistItems: ChecklistItem[];
  currentWorkChecklist: WorkChecklistState;
  checklistReady: boolean;
  missingChecklist: string[];
  documentRows: DocumentRow[];
  timelineItems: CustomerTimelineItem[];
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
  onOpenDocumentPreview: (customer: Customer, type: DocumentPreviewType) => void;
  onOpenWorkReportFor: (customer: Customer) => void;
  onSendQuoteEmail: () => void;
  onSendAppointmentEmailFor: (customer: Customer) => void;
  onOpenWorkReport: () => void;
  onMarkInstallationDone: () => void;
  onCancelAppointment: () => void;
  onStartMaintenanceForCustomer: (customer: Customer) => void;
  onToggleChecklist: (key: keyof WorkChecklistState) => void;
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
  checklistItems,
  currentWorkChecklist,
  checklistReady,
  missingChecklist,
  documentRows,
  timelineItems,
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
  onOpenWorkReport,
  onMarkInstallationDone,
  onCancelAppointment,
  onStartMaintenanceForCustomer,
  onToggleChecklist,
}: WorkPagePanelProps) {
  const currentAppointmentType = normalizeAppointmentType(selected.appointmentType);
  const isInstallation = isInstallationAppointment(currentAppointmentType);
  const isSurvey = currentAppointmentType === "survey";
  const isMaintenance = currentAppointmentType === "maintenance";
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
      {message ? <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/20 p-4 font-black text-emerald-100">{message}</div> : null}
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
            {isSurvey ? (
              <div className="mb-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm font-bold text-cyan-100">
                A felmérés a klímaválasztás előtt van, ezért ehhez az időponthoz nem kell klímát vagy szerelési anyagot rögzíteni.
              </div>
            ) : null}
            {isMaintenance ? (
              <div className="mb-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-100">
                Ez karbantartási időpont. A klímák csak tájékoztató jelleggel jelennek meg, készletet és szerelési anyagot nem foglalnak.
              </div>
            ) : null}
            {isInstallation && workResourceEditLocked && !allowWorkResourceEdit ? <div className="mb-4 rounded-2xl border border-amber-300/30 bg-amber-400/15 p-4 text-sm font-bold text-amber-100">A munka készre jelölése után a klímák és a szerelési anyagok zárolva vannak. Szerkesztéshez nyomd meg a Módosítás engedélyezése gombot.</div> : null}
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
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_110px_44px]">
                    {isCustomQuoteItem(it) ? (
                      <input className="input disabled:cursor-not-allowed disabled:opacity-60" disabled={!canEditWorkResources} value={it.customName || ""} onChange={(event) => onUpdateQuoteItem(i, "customName", event.target.value)} placeholder="Klíma megnevezése" />
                    ) : (
                      <ProductSelect products={products} value={it.productId} onChange={(value) => onUpdateQuoteProduct(i, value)} disabled={!canEditWorkResources} />
                    )}
                    <input className="input disabled:cursor-not-allowed disabled:opacity-60" type="number" min={1} value={it.quantity} disabled={!canEditWorkResources} onChange={(event) => onUpdateQuoteItem(i, "quantity", numericInputValue(event.target.value))} />
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
            </div> : null}
            {isInstallation ? <div className="mt-4 flex flex-col gap-3 md:flex-row">
              <button className="rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canEditWorkResources} onClick={onAddQuoteItem}>+ Klíma hozzáadása</button>
              {workResourceEditLocked && !allowWorkResourceEdit ? <button className="rounded-2xl bg-amber-300 px-5 py-4 font-black text-slate-950" onClick={() => onSetAllowWorkResourceEdit(true)}>Módosítás engedélyezése</button> : null}
              {canEditWorkResources && isInstallation ? <button className="rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950" onClick={onSaveWorkChanges}>Módosítás mentése az időpontra</button> : null}
            </div> : null}
          </Card>

          {isInstallation ? <Card title="Felhasznált anyagok">
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
          <Card title="Dokumentumok">
            <div className="space-y-3">
              {documentRows.map((row) => (
                <div key={row.title} className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-black">{row.title}</p></div>
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
                  />
                </div>
              ))}
            </div>
            <CustomerTimeline items={timelineItems} />
          </Card>

          <Card title={isMaintenance ? "Karbantartás műveletei" : "Lezárási műveletek"}>
            <div className="space-y-3">
              {selected.status === "Lezárva" ? <StepButton color="green" onClick={() => onStartMaintenanceForCustomer(selected)}>{isMaintenance ? "Új karbantartási időpont" : "Karbantartási időpont"}</StepButton> : null}
              {isSurvey ? null : <StepButton color="cyan" onClick={onOpenWorkReport}>{isMaintenance ? "Karbantartási munkalap és aláírás" : "Munkalap és egyszerű aláírás"}</StepButton>}
              <StepButton color="blue" onClick={() => onSendAppointmentEmailFor(selected)}>{appointmentEmailBusy ? "Email küldése..." : "Időpont email újraküldése"}</StepButton>
              {isSurvey ? (
                <StepButton color="green" onClick={onMarkInstallationDone}>Felmérés kész – árajánlat készítése</StepButton>
              ) : isMaintenance ? (
                selected.status !== "Lezárva" ? <StepButton color="green" onClick={onMarkInstallationDone}>Karbantartás lezárása</StepButton> : null
              ) : (
                <StepButton color="amber" onClick={onMarkInstallationDone}>{appointmentTypeLabel(selected.appointmentType)} kész – admin folyamatban</StepButton>
              )}
              {isInstallation ? <StepButton color="green" onClick={onCloseWork}>Teljes lezárás</StepButton> : null}
              {selected.status !== "Lezárva" ? <button onClick={onCancelAppointment} className="group flex w-full items-center justify-between gap-3 rounded-3xl bg-gradient-to-br from-red-500 to-rose-500 px-5 py-4 text-left font-black text-white shadow-xl transition hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99]">
                <span>Időpont törlése / lemondva</span>
                <span className="rounded-full bg-black/10 px-3 py-1 text-sm">×</span>
              </button> : null}
            </div>
          </Card>

          {isInstallation ? <Card title="Lezárási ellenőrzőlista">
            <div className="space-y-3">
              {checklistItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => onToggleChecklist(item.key)}
                  className={`w-full rounded-2xl p-4 text-left font-black transition ${currentWorkChecklist[item.key] ? "border border-emerald-300/30 bg-emerald-400/20 text-emerald-200" : "border border-white/10 bg-slate-900/80 text-slate-200"}`}
                >
                  <span className="mr-3">{currentWorkChecklist[item.key] ? "✓" : "○"}</span>
                  {item.label}
                </button>
              ))}
            </div>
            <div className={`mt-4 rounded-2xl p-4 font-black ${checklistReady ? "bg-emerald-400/20 text-emerald-200" : "bg-amber-400/20 text-amber-200"}`}>
              {checklistReady ? "Teljes lezárás engedélyezve ✅" : `Admin hiányos: ${missingChecklist.length} tétel`}
            </div>
          </Card> : null}
        </Side>
      </Layout>
    </>
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
