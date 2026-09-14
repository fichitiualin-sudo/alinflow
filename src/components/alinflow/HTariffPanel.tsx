"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Customer } from "@/lib/alinflow/types";
import type { WorkspaceSettings } from "@/lib/alinflow/workspace-settings";
import { deviceSlots, deviceSlotKey, listAppointmentDevices, normalizeDeviceData, saveAppointmentDevice, type AppointmentDevice, type DeviceSlot, type DeviceTechnicalData } from "@/lib/alinflow/appointment-devices";
import { defaultHTariffData, H_TARIFF_PROVIDERS, hTariffDeviceFields, validateHTariff, type HTariffData, type HTariffDataField, type HTariffProvider } from "@/lib/alinflow/h-tariff";
import { downloadHTariffPdf, loadHTariffRequest, saveHTariffRequest, type HTariffRequest } from "@/lib/alinflow/h-tariff-store";
import { workPhotoContext, workPhotoErrorMessage } from "@/lib/alinflow/work-photos";

type EditableDevice = { slot: DeviceSlot; saved?: AppointmentDevice; data: DeviceTechnicalData };
const inputClass = "mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 font-medium text-white focus:border-cyan-300 focus:outline-none disabled:opacity-60";
const buttonClass = "min-h-11 rounded-2xl px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50";

type HTariffPanelProps = {
  customer: Customer; workspaceId?: string | null; workspaceSettings: WorkspaceSettings; devices?: AppointmentDevice[];
};

export function HTariffPanel(props: HTariffPanelProps) {
  return <ScopedHTariffPanel key={`${props.workspaceId}:${props.customer.id}:${props.customer.activeAppointmentId}`} {...props} />;
}

function ScopedHTariffPanel({ customer, workspaceId, workspaceSettings, devices: suppliedDevices }: HTariffPanelProps) {
  const [open, setOpen] = useState(false);
  const context = useMemo(() => workPhotoContext(customer, workspaceId), [customer.id, customer.activeAppointmentId, customer.appointmentType, customer.date, customer.time, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [data, setData] = useState<HTariffData>(() => defaultHTariffData(customer, workspaceSettings));
  const [savedRequest, setSavedRequest] = useState<HTariffRequest | null>(null);
  const [entries, setEntries] = useState<EditableDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const requestVersion = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const slotsKey = JSON.stringify(customer.quoteItems);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestVersion.current += 1; }; }, []);

  const reload = useCallback(async () => {
    if (!context || context.appointmentType !== "installation" || pending.current) return;
    const version = ++requestVersion.current;
    setLoading(true); setError(""); setMessage(""); setShowValidation(false);
    try {
      const slots = deviceSlots(customer.quoteItems);
      const [saved, records] = await Promise.all([loadHTariffRequest(context), suppliedDevices ? Promise.resolve(suppliedDevices) : listAppointmentDevices(context)]);
      if (!mounted.current || version !== requestVersion.current) return;
      const currentRecords = records.filter((record) => record.workspaceId === context.workspaceId && record.customerId === context.customerId && record.appointmentId === context.appointmentId);
      setSavedRequest(saved);
      setData(saved?.data || defaultHTariffData(customer, workspaceSettings));
      setEntries(slots.map((slot) => {
        const existing = currentRecords.find((record) => deviceSlotKey(record) === deviceSlotKey(slot));
        return { slot, saved: existing, data: normalizeDeviceData(existing?.data) };
      }));
    } catch (cause) {
      if (mounted.current && version === requestVersion.current) setError(workPhotoErrorMessage(cause, "A H tarifás adatok nem tölthetők be."));
    } finally { if (mounted.current && version === requestVersion.current) setLoading(false); }
  }, [context, slotsKey, suppliedDevices]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) void reload(); }, [open, reload]);

  if (!context || context.appointmentType !== "installation") return null;

  const formDevices: AppointmentDevice[] = entries.map((entry) => ({
    ...entry.slot, id: entry.saved?.id || `draft:${deviceSlotKey(entry.slot)}`,
    workspaceId: context.workspaceId, customerId: context.customerId, appointmentId: context.appointmentId, data: entry.data,
  }));
  const issues = showValidation ? validateHTariff(data, formDevices, context) : [];

  const update = (key: HTariffDataField | "provider", value: string) => {
    setData((current) => ({ ...current, [key]: value })); setMessage("");
  };
  const textField = (key: HTariffDataField, label: string, type = "text") => (
    <label key={key} className="block min-w-0 text-sm font-bold text-slate-200">
      {label}
      <input type={type} value={data[key]} disabled={busy || loading} maxLength={250} className={inputClass}
        aria-invalid={issues.some((issue) => issue.field === key)} onChange={(event) => update(key, event.target.value)} />
    </label>
  );

  async function save(download: boolean) {
    if (!context || pending.current || loading) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    const version = requestVersion.current;
    try {
      const savedDevices: AppointmentDevice[] = [];
      for (const entry of entries) {
        const unchanged = entry.saved && JSON.stringify(normalizeDeviceData(entry.saved.data)) === JSON.stringify(normalizeDeviceData(entry.data));
        const saved = unchanged ? entry.saved! : await saveAppointmentDevice(context, entry.slot, entry.data, entry.saved);
        savedDevices.push(saved);
        if (mounted.current && version === requestVersion.current) setEntries((current) => current.map((item) => deviceSlotKey(item.slot) === deviceSlotKey(entry.slot) ? { ...item, saved, data: saved.data } : item));
      }
      const saved = await saveHTariffRequest(context, data, savedRequest);
      if (mounted.current && version === requestVersion.current) { setSavedRequest(saved); setData(saved.data); }
      if (download) {
        const missing = validateHTariff(saved.data, savedDevices, context);
        if (missing.length) {
          if (mounted.current && version === requestVersion.current) setShowValidation(true);
          throw new Error("Az adatok elmentve. A PDF elkészítéséhez pótold vagy javítsd a jelzett mezőket.");
        }
        await downloadHTariffPdf(context, savedDevices);
      }
      if (mounted.current && version === requestVersion.current) setMessage(download ? "A H tarifás PDF elkészült és letöltődött." : "A H tarifás és készülékadatok elmentve.");
    } catch (cause) {
      if (mounted.current && version === requestVersion.current) setError(workPhotoErrorMessage(cause, "A H tarifás adatok mentése nem sikerült."));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-cyan-300/20 bg-slate-950/50 p-4">
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left font-black text-cyan-100"
        aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>H tarifás nyomtatvány</span><span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="mt-3 space-y-5">
          <p className="text-sm text-slate-300">A telepítés összes készülékének mentett adataiból készül. A hiányzó műszaki értékeket a gyártói adatlap alapján töltsd ki.</p>
          {loading ? <p role="status" className="text-sm text-slate-300">Adatok betöltése…</p> : null}
          <label className="block text-sm font-bold text-slate-200">Áramszolgáltatói elosztó
            <select value={data.provider} disabled={busy || loading} onChange={(event) => update("provider", event.target.value as HTariffProvider)} className={inputClass}>
              <option value="">Válassz elosztót</option>
              {Object.entries(H_TARIFF_PROVIDERS).map(([key, provider]) => <option key={key} value={key}>{provider.label}</option>)}
            </select>
          </label>
          {data.provider ? <p className="text-sm text-slate-300">
            {data.provider === "eon" ? "Azonos pontos típus és műszaki adatok esetén egy lap készül, darabszámmal. Eltérő készülékhez külön lap tartozik." : "Minden készülékhez külön nyilatkozati lap készül."}{" "}
            <a href={H_TARIFF_PROVIDERS[data.provider].source} target="_blank" rel="noreferrer" className="font-bold text-cyan-200 underline">Hivatalos nyomtatvány</a>
          </p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {textField("applicantName", "Igénybejelentő / szerződő neve")}
            {data.provider === "eon" ? textField("meteringPointIdentifier", "Mérési pont azonosító (HU000…)") : null}
            {data.provider === "mvm-demasz" ? <>
              {textField("customerIdentifier", "Felhasználó azonosító (10…)")}
              {textField("consumptionPlaceIdentifier", "Fogyasztási hely azonosító (04…)")}
              {textField("postalCode", "Felhasználási hely irányítószáma")}
              {textField("installationAddress", "Felhasználási hely címe")}
              {textField("totalSimultaneousElectricalKw", "H kör teljes egyidejű villamos teljesítménye (kW)")}
              {textField("location", "Keltezés helye")}{textField("date", "Keltezés dátuma", "date")}
            </> : null}
          </div>
          {data.provider === "eon" ? <>
            {["installer", "electrician"].map((role) => (
              <fieldset key={role} className="rounded-2xl border border-white/10 p-3">
                <legend className="px-1 text-sm font-black text-slate-100">{role === "installer" ? "Hőszivattyús berendezés kivitelezője" : "Regisztrált villanyszerelő"}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {textField(`${role}Name` as HTariffDataField, "Név")}{textField(`${role}Address` as HTariffDataField, "Cím")}
                  {textField(`${role}Phone` as HTariffDataField, "Telefonszám", "tel")}{textField(`${role}Email` as HTariffDataField, "Email", "email")}
                </div>
              </fieldset>
            ))}
            <label className="block text-sm font-bold text-slate-200">Egyéb közlendő
              <textarea value={data.notes} disabled={busy || loading} maxLength={1000} rows={3} className={inputClass} onChange={(event) => update("notes", event.target.value)} />
            </label>
          </> : null}
          {!loading && !entries.length ? <p className="text-sm text-amber-200">Ehhez a telepítéshez még nincs készülék megadva. Előbb rögzítsd és mentsd a készülékeket a munkánál.</p> : null}
          {entries.map((entry) => {
            const key = deviceSlotKey(entry.slot);
            return <fieldset key={key} className="rounded-2xl border border-white/10 p-3">
              <legend className="max-w-full px-1 text-sm font-black text-slate-100">{entry.slot.productName} · {entry.slot.unitNumber}. készülék</legend>
              {entry.data.indoorSerial || entry.data.outdoorSerial ? <p className="mb-3 break-all text-xs text-slate-400">Beltéri S/N: {entry.data.indoorSerial || "—"} · Kültéri S/N: {entry.data.outdoorSerial || "—"}</p> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {hTariffDeviceFields(data.provider).map((field) => {
                  const change = (value: string) => { setEntries((current) => current.map((item) => deviceSlotKey(item.slot) === key ? { ...item, data: { ...item.data, [field.key]: value } } : item)); setMessage(""); };
                  const invalid = issues.some((issue) => issue.deviceId === (entry.saved?.id || `draft:${key}`) && issue.deviceField === field.key);
                  return <label key={field.key} className="block min-w-0 text-sm font-bold text-slate-200">{field.label}
                    {field.options ? <select disabled={busy || loading} value={entry.data[field.key] || ""} onChange={(event) => change(event.target.value)} className={inputClass} aria-invalid={invalid}>
                      <option value="">Válassz</option>{field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select> : <input disabled={busy || loading} type="text" inputMode={/Kw|Kwh|Current|scop|Percent/.test(field.key) ? "decimal" : "text"}
                      value={entry.data[field.key] || ""} maxLength={200} className={inputClass} aria-invalid={invalid} onChange={(event) => change(event.target.value)} />}
                  </label>;
                })}
              </div>
            </fieldset>;
          })}
          {error ? <p role="alert" className="rounded-xl bg-amber-300/10 p-3 text-sm text-amber-100">{error}</p> : null}
          {issues.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-amber-200">{issues.slice(0, 12).map((issue, index) => <li key={index}>{issue.deviceId ? `${formDevices.find((device) => device.id === issue.deviceId)?.productName || "Készülék"} · ${formDevices.find((device) => device.id === issue.deviceId)?.unitNumber || ""}.: ` : ""}{issue.label}</li>)}{issues.length > 12 ? <li>További {issues.length - 12} javítandó mező.</li> : null}</ul> : null}
          {message ? <p role="status" className="text-sm font-bold text-emerald-200">{message}</p> : null}
          <p className="text-sm text-slate-400">Az aláírásokat a nyomtatványon kell megadni.{data.provider === "eon" ? " Mellékeld a készülék műszaki adatlapját és energiacímkéjét is." : ""}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy || loading} onClick={() => void save(false)} className={`${buttonClass} bg-white/10 text-slate-100`}>{busy ? "Feldolgozás…" : "Adatok mentése"}</button>
            <button type="button" disabled={busy || loading || !data.provider || !entries.length} onClick={() => void save(true)} className={`${buttonClass} bg-cyan-300 text-slate-950`}>PDF letöltése</button>
            <button type="button" disabled={busy || loading} onClick={() => void reload()} className={`${buttonClass} bg-white/10 text-cyan-100`}>Adatok újratöltése</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
