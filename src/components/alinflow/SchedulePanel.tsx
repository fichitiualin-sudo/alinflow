"use client";

import type { AppointmentType, CalendarMode, ClimateProduct, Customer, QuoteItem } from "@/lib/alinflow/types";
import { isCustomQuoteItem, itemName, itemUnitPrice, sortProducts } from "@/lib/alinflow/products";
import { Back, Btn, Card, Gradient, InfoRow, Layout, Main, Shell, Side } from "@/components/alinflow/LayoutPrimitives";
import { Calendar } from "@/components/alinflow/CalendarPanel";
import { appointmentTimeLabel, appointmentTypeLabel, normalizeAppointmentTimeInput, isInstallationAppointment } from "@/lib/alinflow/appointments";

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
  isMultiDayJob: boolean;
  freeSlots: string[];
  quoteItems: QuoteItem[];
  products: ClimateProduct[];
  totalQuantity: number;
  sendAppointmentNotice: boolean;
  appointmentEmailBusy: boolean;
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
  onSetSendAppointmentNotice: (value: boolean) => void;
};

function ProductSelect({ products, value, onChange, disabled = false }: { products: ClimateProduct[]; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const sorted = sortProducts(products);
  const selectValue = sorted.some((product) => product.id === value) ? value : "";
  return (
    <select value={selectValue} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="input disabled:cursor-not-allowed disabled:opacity-60">
      <option value="">Válassz klímát...</option>
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

function slotLabel(slot: string, appointmentType: AppointmentType, items: QuoteItem[]) {
  if (slot === "16:00" && appointmentType === "installation") return `+1 · ${appointmentTimeLabel(appointmentType, slot, items)}`;
  return appointmentTimeLabel(appointmentType, slot, items);
}

export function SchedulePanel({
  selected,
  isExistingSchedule,
  mode,
  calDate,
  calendarCustomers,
  message,
  scheduleDate,
  scheduleTime,
  shownTime,
  appointmentType,
  isMultiDayJob,
  freeSlots,
  quoteItems,
  products,
  totalQuantity,
  sendAppointmentNotice,
  appointmentEmailBusy,
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
  onSetSendAppointmentNotice,
}: SchedulePanelProps) {
  const isInstallation = isInstallationAppointment(appointmentType);
  const isSurvey = appointmentType === "survey";
  const isMaintenance = appointmentType === "maintenance";
  const appointmentDetailsTitle = isSurvey
    ? "Felmérési időpont"
    : isMaintenance
    ? "Karbantartáshoz tartozó klímák"
    : "Időpontba kerülő klímák";
  const manualTimeValue = normalizeAppointmentTimeInput(scheduleTime) || scheduleTime || "";
  const selectedTimeLabel = normalizeAppointmentTimeInput(scheduleTime)
    ? appointmentTimeLabel(appointmentType, scheduleTime, quoteItems)
    : "adj meg időpontot";
  const messageIsError = message.toLocaleLowerCase("hu-HU").startsWith("ez az idősáv") || message.toLocaleLowerCase("hu-HU").startsWith("adj meg");

  return (
    <Shell>
      <Back onClick={onBack} />
      <Layout>
        <Main>
          {message ? (
            <div className={`mb-4 rounded-2xl border p-4 font-black ${messageIsError ? "border-red-300/40 bg-red-500/20 text-red-100" : "border-emerald-300/30 bg-emerald-400/20 text-emerald-100"}`}>
              {message}
            </div>
          ) : null}
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
          <Card title="Ajánlott időpontok">
            {isMultiDayJob ? (
              freeSlots.length ? (
                <div className="rounded-2xl bg-emerald-400/20 p-4 font-black text-emerald-100">
                  Szerelésnél 2 vagy több klíma esetén automatikusan a teljes délelőtti és déli sávval számolunk.
                </div>
              ) : (
                <div className="rounded-2xl bg-red-500/20 p-4 font-black text-red-200">Erre a napra a 08:00–16:00 idősáv már foglalt.</div>
              )
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {freeSlots.length === 0 ? (
                    <div className="rounded-2xl bg-amber-400/15 p-4 font-black text-amber-100 md:col-span-3">Nincs szabad ajánlott idősáv. Kézzel megadhatsz másik időpontot.</div>
                  ) : (
                    freeSlots.map((slot) => (
                      <button key={slot} className={normalizeAppointmentTimeInput(scheduleTime) === normalizeAppointmentTimeInput(slot) ? "slot-active" : "slot"} onClick={() => onSetScheduleTime(slot)}>
                        {slotLabel(slot, appointmentType, quoteItems)}
                      </button>
                    ))
                  )}
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <label className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Egyedi időpont</label>
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr] sm:items-center">
                    <input
                      type="time"
                      step={300}
                      className="input"
                      value={manualTimeValue}
                      onChange={(event) => onSetScheduleTime(event.target.value)}
                      onBlur={(event) => onSetScheduleTime(normalizeAppointmentTimeInput(event.target.value) || event.target.value)}
                    />
                    <p className="text-sm font-bold text-slate-300">Kiválasztva: <span className="text-cyan-100">{selectedTimeLabel}</span></p>
                  </div>
                </div>
              </>
            )}
          </Card>
        </Main>
        <Side>
          <Gradient title="Kiválasztott időpont" value={`${appointmentTypeLabel(appointmentType)} · ${scheduleDate.replaceAll("-", ".")} · ${shownTime}`} />
          <Card title={appointmentDetailsTitle}>
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
                        <ProductSelect products={products} value={item.productId} onChange={(value) => onUpdateQuoteProduct(index, value)} />
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
              quoteItems.length ? (
                <div className="mb-4 space-y-3">
                  {quoteItems.map((item, index) => (
                    <div key={index} className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                      <p className="font-black">{itemName(item)}</p>
                      <p className="mt-1 text-sm text-slate-400">{Number(item.quantity) || 1} db</p>
                    </div>
                  ))}
                </div>
              ) : null
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
            <Btn color="green" onClick={onSaveSchedule}>
              {appointmentEmailBusy ? "Mentés és email küldés..." : isExistingSchedule ? `${appointmentTypeLabel(appointmentType)} időpont frissítése` : `${appointmentTypeLabel(appointmentType)} időpont mentése`}
            </Btn>
          </Card>
        </Side>
      </Layout>
    </Shell>
  );
}
