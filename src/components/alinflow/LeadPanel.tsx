"use client";

import type { Customer, CustomerTimelineItem, View } from "@/lib/alinflow/types";
import { STATUS_OPTIONS } from "@/lib/alinflow/constants";
import { mapsHref, telHref } from "@/lib/alinflow/format";
import { Back, Card, Layout, Main, Shell, Side, StepButton } from "@/components/alinflow/LayoutPrimitives";
import { PostalCodeCityFields } from "@/components/alinflow/PostalCodeCityFields";

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

function statusMetaItems(status: string, timelineItems: CustomerTimelineItem[]) {
  const findItem = (label: string) => timelineItems.find((item) => item.label === label && item.value);
  const inquired = findItem("Érdeklődött");
  const called = findItem("Hívva");
  const quote = findItem("Ajánlat küldve");
  const appointment = findItem("Időpont rögzítve");
  const updated = findItem("Utolsó módosítás");

  switch (status) {
    case "Visszahívandó":
      return [
        inquired ? `Érdeklődött: ${formatTimelineValue(inquired.value)}` : undefined,
        called ? `Hívva: ${formatTimelineValue(called.value)}` : undefined,
      ].filter(Boolean) as string[];
    case "Ajánlat elküldve":
      return quote ? [`Küldve: ${formatTimelineValue(quote.value)}`] : [];
    case "Időpont foglalva":
      return [
        appointment ? `Rögzítve: ${formatTimelineValue(appointment.value)}` : undefined,
        appointment?.hint,
      ].filter(Boolean) as string[];
    case "Szerelés kész – admin folyamatban":
    case "Lezárva":
    case "Lemondva":
      return updated ? [`Módosítva: ${formatTimelineValue(updated.value)}`] : [];
    default:
      return [];
  }
}

function StatusControl({ value, timelineItems, onChange }: { value: string; timelineItems: CustomerTimelineItem[]; onChange: (value: string) => void }) {
  return (
    <Card title="Státusz kezelése">
      <div className="grid grid-cols-1 gap-2">
        {STATUS_OPTIONS.map((status) => {
          const metaItems = statusMetaItems(status, timelineItems);
          const isSelected = value === status;

          return (
            <button
              key={status}
              onClick={() => onChange(status)}
              className={`rounded-2xl px-4 py-3 text-left transition ${
                isSelected
                  ? "bg-cyan-300 text-slate-950"
                  : "bg-slate-900/80 text-slate-200 border border-white/10 hover:border-cyan-300/40"
              }`}
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <span className="font-black leading-snug">{status}</span>
                {metaItems.length ? (
                  <span className={`text-xs font-bold leading-snug sm:max-w-[52%] sm:text-right ${isSelected ? "text-slate-700" : "text-slate-400"}`}>
                    {metaItems.join(" · ")}
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
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
              <PostalCodeCityFields
                postalCode={selected.postalCode || ""}
                city={selected.city}
                onChange={(field, value) => onUpdateSelectedField(field, value)}
              />
              <EditField label="Cím" value={selected.address} onChange={(value) => onUpdateSelectedField("address", value)} />
            </div>
            {selected.address || selected.city || selected.postalCode ? (
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
