"use client";

import { MaintenanceDevicePicker } from "./MaintenanceDevicePicker";
import type { MaintenanceDeviceSelection, AppointmentType, CalendarMode, ClimateProduct, Customer, QuoteItem } from "@/lib/alinflow/types";
import { climateSummary, isCustomQuoteItem, itemName, itemUnitPrice, sortProducts } from "@/lib/alinflow/products";
import { displayAddress } from "@/lib/alinflow/format";
import { Back, Btn, Card, Gradient, InfoRow, Layout, Main, Shell, Side } from "@/components/alinflow/LayoutPrimitives";
import { AppointmentTimePicker } from "@/components/alinflow/AppointmentTimePicker";
import { AppointmentItemsEditor } from "@/components/alinflow/AppointmentItemsEditor";
import { Calendar } from "@/components/alinflow/CalendarPanel";
import { appointmentTypeLabel, normalizeAppointmentTimeInput, isInstallationAppointment } from "@/lib/alinflow/appointments";

type SchedulePanelProps = {
  selected: Customer;
  isExistingSchedule: boolean;
  mode: CalendarMode;
  calDate: Date;
  calendarCustomers: Customer[];
  message: string;
  scheduleDate: string;
  scheduleTime: string;
  shownTime: string;
  appointmentType: AppointmentType;
  freeSlots: string[];
  freeStartTimes: string[];
  quoteItems: QuoteItem[];
  products: ClimateProduct[];
  maintenanceInstallationWorks: Customer[];
  maintenanceInstallationIds: string[];
  maintenanceSelectionLocked?: boolean;
  totalQuantity: number;
  sendAppointmentNotice: boolean;
  appointmentEmailBusy: boolean;
  saving?: boolean;
  onBack: () => void;
  onSaveSchedule: () => void;
  onSelectDate: (value: string) => void;
  onMode: (value: CalendarMode) => void;
  onStep: (value: number) => void;
  onOpenCustomer: (customer: Customer) => void;
  onSetScheduleTime: (value: string) => void;
  onUpdateQuoteItem: (index: number, key: keyof QuoteItem, value: string | number | boolean) => void;
  onUpdateQuoteProduct: (index: number, productId: string) => void;
  onAddQuoteItem: () => void;
  onChangeQuoteItems: (items: QuoteItem[]) => void;
  onToggleMaintenanceInstallation: (appointmentId: string, devices: MaintenanceDeviceSelection[]) => void;
  onSetSendAppointmentNotice: (value: boolean) => void;
};

function ProductSelect({ products, value, snapshotName, onChange, disabled = false }: { products: ClimateProduct[]; value: string; snapshotName?: string; onChange: (value: string) => void; disabled?: boolean }) {
  const sorted = sortProducts(products);
  const archived = Boolean(value && snapshotName && !sorted.some((product) => product.id === value));
  const selectValue = archived || sorted.some((product) => product.id === value) ? value : "";
  return (
    <select value={selectValue} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="input disabled:cursor-not-allowed disabled:opacity-60">
      <option value="">Válassz klímát...</option>
      {archived ? <option value={value}>{snapshotName} (archivált)</option> : null}
      {sorted.map((product) => (
        <option key={product.id} value={product.id}>
          {product.name}
        </option>
      ))}
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

export function SchedulePanel({
  selected,
  isExistingSchedule,
  mode,
  calDate,
  calendarCustomers,
  scheduleDate,
  scheduleTime,
  shownTime,
  appointmentType,
  freeSlots,
  freeStartTimes,
  quoteItems,
  products,
  maintenanceInstallationWorks,
  maintenanceInstallationIds,
  maintenanceSelectionLocked = false,
  totalQuantity,
  sendAppointmentNotice,
  appointmentEmailBusy,
  saving = false,
  onBack,
  onSaveSchedule,
  onSelectDate,
  onMode,
  onStep,
  onOpenCustomer,
  onSetScheduleTime,
  onUpdateQuoteItem,
  onUpdateQuoteProduct,
  onAddQuoteItem,
  onChangeQuoteItems,
  onToggleMaintenanceInstallation,
  onSetSendAppointmentNotice,
}: SchedulePanelProps) {
  const isInstallation = isInstallationAppointment(appointmentType);
  const isSurvey = appointmentType === "survey";
  const isMaintenance = appointmentType === "maintenance";
  const appointmentDetailsTitle = isSurvey
    ? "Felmérési időpont"
    : isMaintenance
    ? "Karbantartáshoz tartozó klímák"
    : appointmentType === "other" ? "Munka tételei" : "Időpontba kerülő klímák";
  const timeAvailable = freeStartTimes.includes(normalizeAppointmentTimeInput(scheduleTime));
  const busy = saving || appointmentEmailBusy;

  return (
    <Shell>
      <Back onClick={onBack} disabled={busy} />
      <fieldset disabled={busy} aria-busy={busy} className="min-w-0 border-0 p-0 disabled:pointer-events-none">
      <Layout>
        <Main>
          <Calendar
            mode={mode}
            date={calDate}
            customers={calendarCustomers}
            selectable
            selectedDate={scheduleDate}
            onSelect={onSelectDate}
            onMode={onMode}
            onStep={onStep}
            onOpen={onOpenCustomer}
          />
          <Card title="Szabad időpontok">
            <AppointmentTimePicker appointmentType={appointmentType} items={quoteItems} time={scheduleTime}
              recommendedTimes={freeSlots} availableTimes={freeStartTimes} onChange={onSetScheduleTime} />
          </Card>
        </Main>
        <Side>
          <Gradient title="Kiválasztott időpont" value={`${appointmentTypeLabel(appointmentType)} · ${scheduleDate.replaceAll("-", ".")} · ${timeAvailable ? shownTime : "Válassz szabad időpontot"}`} />
          <Card title={appointmentDetailsTitle}>
            {appointmentType === "other" ? <AppointmentItemsEditor extraOnly items={quoteItems} products={products} onChange={onChangeQuoteItems} /> : null}
            {isInstallation ? (
              <>
                {quoteItems.map((item, index) => (
                  <div key={index} className="mb-3 rounded-2xl bg-slate-900/80 p-4">
                    <p className="font-black">{itemName(item)}</p>
                    <div className="mt-3 grid grid-cols-[1fr_90px] gap-3">
                      {isCustomQuoteItem(item) ? (
                        <input
                          className="input"
                          value={item.customName || ""}
                          onChange={(event) => onUpdateQuoteItem(index, "customName", event.target.value)}
                          placeholder="Klíma megnevezése"
                        />
                      ) : (
                        <ProductSelect products={products} value={item.productId} snapshotName={item.productName} onChange={(value) => onUpdateQuoteProduct(index, value)} />
                      )}
                      <input
                        className="input"
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(event) => onUpdateQuoteItem(index, "quantity", numericInputValue(event.target.value))}
                      />
                    </div>
                    <label className="mt-3 block rounded-2xl bg-white/5 p-3">
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Ár szereléssel együtt / db</span>
                      <input
                        className="mt-2 w-full bg-transparent text-lg font-black outline-none"
                        type="number"
                        min={0}
                        value={item.customPrice ?? itemUnitPrice(item)}
                        onChange={(event) => onUpdateQuoteItem(index, "customPrice", priceInputValue(event.target.value))}
                      />
                    </label>
                  </div>
                ))}
                <button className="mb-4 rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950" onClick={onAddQuoteItem}>
                  + Klíma hozzáadása
                </button>
                <InfoRow label="Összes klíma" value={`${totalQuantity} db`} />
              </>
            ) : null}

            {isMaintenance ? (
              <div className="mb-4 space-y-3">
                <MaintenanceDevicePicker works={maintenanceInstallationWorks} installationIds={maintenanceInstallationIds}
                  selections={selected.maintenanceDeviceSelections} onChange={onToggleMaintenanceInstallation} disabled={busy || maintenanceSelectionLocked} />
                {maintenanceSelectionLocked ? <p className="text-sm text-slate-400">Az aláírt vagy lezárt karbantartás készülékválasztása már nem módosítható. További klímához indíts új karbantartást.</p> : null}
              </div>
            ) : null}

            <InfoRow label="Időpont típusa" value={appointmentTypeLabel(appointmentType)} />
            {isSurvey ? <InfoRow label="Klímaválasztás" value="felmérés után" /> : null}
            <label className="mb-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm font-bold text-slate-200">
              <input
                type="checkbox"
                checked={sendAppointmentNotice}
                onChange={(event) => onSetSendAppointmentNotice(event.target.checked)}
                className="mt-1 h-5 w-5 accent-cyan-300"
              />
              <span>Tájékoztató email küldése az ügyfélnek az időpont rögzítésekor</span>
            </label>
            <Btn color="green" disabled={busy || !timeAvailable} onClick={onSaveSchedule}>
              {appointmentEmailBusy ? "Mentés és email küldés..." : saving ? "Időpont mentése..." : isExistingSchedule ? `${appointmentTypeLabel(appointmentType)} időpont frissítése` : `${appointmentTypeLabel(appointmentType)} időpont mentése`}
            </Btn>
          </Card>
        </Side>
      </Layout>
      </fieldset>
    </Shell>
  );
}
