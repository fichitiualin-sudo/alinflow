"use client";

import type { Customer } from "@/lib/alinflow/types";
import { STATUS_OPTIONS } from "@/lib/alinflow/constants";
import { mapsHref, telHref } from "@/lib/alinflow/format";
import { Back, Card, Gradient, Hero, Layout, Main, Shell, Side, StepButton } from "@/components/alinflow/LayoutPrimitives";

type LeadPanelProps = {
  selected: Customer;
  customers: Customer[];
  onBack: () => void;
  onSaveCustomerOnly: () => void;
  onSaveCustomerAndQuote: () => void;
  onDeleteCustomer: (customer: Customer) => void;
  onRememberExternalCustomer: (customer: Customer, returnView?: any) => void;
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

function StatusControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Card title="Státusz kezelése">
      <div className="grid grid-cols-1 gap-2">
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
  onRememberExternalCustomer,
  onUpdateSelectedField,
  onUpdateCustomerStatus,
}: LeadPanelProps) {
  const isExistingCustomer = Boolean(selected.id && customers.some((customer) => customer.id === selected.id));

  return (
    <Shell>
      <Back onClick={onBack} />
      <Hero title={selected.name || "Új ügyfél"} sub={`Státusz: ${selected.status || "Visszahívandó"}`} action="Mentés" onAction={onSaveCustomerOnly} />
      <Layout>
        <Main>
          <Card title="Ügyféladatok szerkesztése">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <EditField label="Név" value={selected.name} onChange={(value) => onUpdateSelectedField("name", value)} />
              <EditField label="Telefonszám" value={selected.phone} onChange={(value) => onUpdateSelectedField("phone", value)} />
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
          <Gradient title="Aktuális státusz" value={selected.status || "Visszahívandó"} />
          <Card title="Következő lépések">
            <div className="grid grid-cols-1 gap-3">
              <StepButton color="green" href={telHref(selected.phone)} onClick={() => onRememberExternalCustomer(selected, "lead")}>Hívás</StepButton>
              <StepButton color="amber" onClick={onSaveCustomerOnly}>Mentés</StepButton>
              <StepButton color="blue" onClick={onSaveCustomerAndQuote}>Mentés és ajánlat</StepButton>
              {isExistingCustomer ? (
                <StepButton color="red" onClick={() => onDeleteCustomer(selected)}>Ügyfél törlése</StepButton>
              ) : null}
            </div>
          </Card>
          <StatusControl value={selected.status || "Visszahívandó"} onChange={onUpdateCustomerStatus} />
        </Side>
      </Layout>
    </Shell>
  );
}
