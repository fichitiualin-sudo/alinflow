"use client";

import type { Customer, CustomerTimelineItem, View } from "@/lib/alinflow/types";
import { STATUS_OPTIONS } from "@/lib/alinflow/constants";
import { mapsHref, telHref } from "@/lib/alinflow/format";
import { Back, Card, Layout, Main, Shell, Side, StepButton } from "@/components/alinflow/LayoutPrimitives";

type LeadPanelProps = {
  selected: Customer;
  customers: Customer[];
  onBack: () => void;
  onSaveCustomerOnly: () => void;
  onSaveCustomerAndQuote: () => void;
  onDeleteCustomer: (customer: Customer) => void;
  timelineItems: CustomerTimelineItem[];
  onRememberExternalCustomer: (customer: Customer, returnView?: View) => void;
  onRecordCustomerPhoneCall: (customer: Customer, returnView?: View) => void;
  onUpdateSelectedField: (field: keyof Customer, value: string) => void;
  onUpdateCustomerStatus: (status: string) => void;
};

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="rounded-2xl bg-slate-900/80 p-4">
      <span className="text-sm text-slate-400">{label}</span>
      <input className="mt-2 w-full bg-transparent text-lg font-black outline-none" value={value || ""} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function PhoneEditField({ value, onChange, onCall }: { value: string; onChange: (value: string) => void; onCall: () => void }) {
  const hasPhone = value.trim().length > 0;

  return (
    <div className="rounded-2xl bg-slate-900/80 p-4">
      <span className="text-sm text-slate-400">Telefonszám</span>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input className="w-full min-w-0 bg-transparent text-lg font-black outline-none" value={value || ""} onChange={(event) => onChange(event.target.value)} />
        {hasPhone ? (
          <a href={telHref(value)} onClick={onCall} className="shrink-0 rounded-xl bg-emerald-400 px-4 py-3 text-center text-sm font-black text-slate-950">
            Hívás
          </a>
        ) : null}
      </div>
    </div>
  );
}

function formatTimelineValue(value?: string) {
  if (!value) return "Még nincs";
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

function timelineDotClass(item: CustomerTimelineItem) {
  if (item.muted) return "bg-slate-600/70 ring-slate-500/20";
  switch (item.tone) {
    case "emerald":
      return "bg-emerald-300 ring-emerald-300/20";
    case "cyan":
      return "bg-cyan-300 ring-cyan-300/20";
    case "violet":
      return "bg-violet-300 ring-violet-300/20";
    case "blue":
      return "bg-blue-300 ring-blue-300/20";
    case "amber":
      return "bg-amber-300 ring-amber-300/20";
    default:
      return "bg-slate-300 ring-slate-300/20";
  }
}

function StatusTimeline({ items }: { items: CustomerTimelineItem[] }) {
  if (!items.length) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">Ügyfél folyamat</p>
        <p className="text-[10px] font-bold text-slate-500">idővonal</p>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className={`flex gap-3 rounded-2xl px-3 py-2 ${item.muted ? "bg-white/[0.02]" : "bg-white/[0.04]"}`}>
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${timelineDotClass(item)}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                <p className={`text-[11px] font-black uppercase tracking-wide ${item.muted ? "text-slate-500" : "text-slate-300"}`}>{item.label}</p>
                <p className={`text-xs font-black leading-snug ${item.muted ? "text-slate-500" : "text-slate-100"}`}>{formatTimelineValue(item.value)}</p>
              </div>
              {item.hint ? <p className="mt-1 text-[10px] font-bold leading-snug text-slate-500">{item.hint}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusControl({ value, timelineItems, onChange }: { value: string; timelineItems: CustomerTimelineItem[]; onChange: (value: string) => void }) {
  return (
    <Card title="Státusz kezelése">
      <StatusTimeline items={timelineItems} />
      <div className="mt-4 grid grid-cols-1 gap-2">
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status}
            onClick={() => onChange(status)}
            className={`rounded-2xl px-4 py-3 text-left font-black transition ${
              value === status
                ? "bg-cyan-300 text-slate-950"
                : "bg-slate-900/80 text-slate-200 border border-white/10 hover:border-cyan-300/40"
            }`}
          >
            {status}
          </button>
        ))}
      </div>
    </Card>
  );
}

export function LeadPanel({
  selected,
  customers,
  onBack,
  onSaveCustomerOnly,
  onSaveCustomerAndQuote,
  onDeleteCustomer,
  timelineItems,
  onRememberExternalCustomer,
  onRecordCustomerPhoneCall,
  onUpdateSelectedField,
  onUpdateCustomerStatus,
}: LeadPanelProps) {
  const isExistingCustomer = Boolean(selected.id && customers.some((customer) => customer.id === selected.id));

  return (
    <Shell>
      <Back onClick={onBack} />
      <Layout>
        <Main>
          <Card title="Ügyféladatok szerkesztése">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <EditField label="Név" value={selected.name} onChange={(value) => onUpdateSelectedField("name", value)} />
              <PhoneEditField value={selected.phone} onChange={(value) => onUpdateSelectedField("phone", value)} onCall={() => onRecordCustomerPhoneCall(selected, "lead")} />
              <EditField label="Email" value={selected.email} onChange={(value) => onUpdateSelectedField("email", value)} />
              <EditField label="Település" value={selected.city} onChange={(value) => onUpdateSelectedField("city", value)} />
              <EditField label="Cím" value={selected.address} onChange={(value) => onUpdateSelectedField("address", value)} />
            </div>
            {selected.address || selected.city ? (
              <a href={mapsHref(selected)} target="_blank" rel="noreferrer" onClick={() => onRememberExternalCustomer(selected, "lead")} className="mt-4 block rounded-2xl bg-cyan-300 px-5 py-4 text-center font-black text-slate-950">
                Útvonal tervezése Google Térképpel
              </a>
            ) : null}
          </Card>
          <Card title="Telefonos jegyzet">
            <textarea
              className="input min-h-32"
              value={selected.notes || ""}
              onChange={(event) => onUpdateSelectedField("notes", event.target.value)}
              placeholder="Például: mikor hívjam vissza, mit kért, fontos tudnivalók..."
            />
          </Card>
        </Main>
        <Side>
          <Card title="Következő lépések">
            <div className="grid grid-cols-1 gap-3">
              <StepButton color="amber" onClick={onSaveCustomerOnly}>Mentés</StepButton>
              <StepButton color="blue" onClick={onSaveCustomerAndQuote}>Ajánlat / Időpont</StepButton>
              {isExistingCustomer ? (
                <StepButton color="red" onClick={() => onDeleteCustomer(selected)}>Ügyfél törlése</StepButton>
              ) : null}
            </div>
          </Card>
          <StatusControl value={selected.status || "Visszahívandó"} timelineItems={timelineItems} onChange={onUpdateCustomerStatus} />
        </Side>
      </Layout>
    </Shell>
  );
}
