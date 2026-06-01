"use client";

import type { CalendarMode, ClimateProduct, Customer, QuoteItem } from "@/lib/alinflow/types";
import { isCustomQuoteItem, itemName, sortProducts } from "@/lib/alinflow/products";
import { Back, Btn, Card, Gradient, InfoRow, Layout, Main, Shell, Side } from "@/components/alinflow/LayoutPrimitives";
import { Calendar } from "@/components/alinflow/CalendarPanel";

type SchedulePanelProps = {
  selected: Customer;
  isExistingSchedule: boolean;
  mode: CalendarMode;
  calDate: Date;
  calendarCustomers: Customer[];
  scheduleDate: string;
  scheduleTime: string;
  shownTime: string;
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

export function SchedulePanel({
  selected,
  isExistingSchedule,
  mode,
  calDate,
  calendarCustomers,
  scheduleDate,
  scheduleTime,
  shownTime,
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
  return (
    <Shell>
      <Back onClick={onBack} />
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
          <Card title="Választható időpontok">
            {isMultiDayJob ? (
              <div className="rounded-2xl bg-emerald-400/20 p-4 font-black text-emerald-100">
                2 vagy több klíma esetén automatikusan lefoglaljuk a 08:00 és 12:00 idősávot.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {freeSlots.length === 0 ? (
                  <div className="rounded-2xl bg-red-500/20 p-4 font-black text-red-200">Erre a napra nincs szabad idősáv.</div>
                ) : (
                  freeSlots.map((slot) => (
                    <button key={slot} className={scheduleTime === slot ? "slot-active" : "slot"} onClick={() => onSetScheduleTime(slot)}>
                      {slot === "16:00" ? "+1 extra" : slot}
                    </button>
                  ))
                )}
              </div>
            )}
          </Card>
        </Main>
        <Side>
          <Gradient title="Kiválasztott időpont" value={`${scheduleDate.replaceAll("-", ".")} · ${shownTime}`} />
          <Card title="Időpontba kerülő klímák">
            <p className="mb-4 text-sm leading-relaxed text-slate-400">
              Mentéskor kérés szerint automatikus, magázódó időpont-visszaigazoló emailt küldünk. Telefonról is ugyanígy működik.
            </p>
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
              </div>
            ))}
            <button className="mb-4 rounded-2xl bg-cyan-300 px-5 py-4 font-black text-slate-950" onClick={onAddQuoteItem}>
              + Klíma hozzáadása
            </button>
            <InfoRow label="Összes klíma" value={`${totalQuantity} db`} />
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
              {appointmentEmailBusy ? "Mentés és email küldés..." : isExistingSchedule ? "Időpont frissítése" : "Időpont mentése"}
            </Btn>
          </Card>
        </Side>
      </Layout>
    </Shell>
  );
}
