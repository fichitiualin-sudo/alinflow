"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WorkPhotosPanel } from "./WorkPhotosPanel";
import { deviceSlots, deviceSlotKey, listAppointmentDevices, saveAppointmentDevice, type AppointmentDevice, type DeviceSlot, type DeviceTechnicalData } from "@/lib/alinflow/appointment-devices";
import { downloadWorkPhoto, workPhotoContext } from "@/lib/alinflow/work-photos";
import { recognizeDeviceLabel, serialRecognitionErrorMessage } from "@/lib/alinflow/serial-recognition";
import type { Customer, WorkPhoto, WorkPhotoContext } from "@/lib/alinflow/types";

const button = "rounded-xl px-4 py-3 text-sm font-black disabled:opacity-50 disabled:cursor-not-allowed";

function DeviceEditor({ slot, device, customer, context, retained, onSaved }: {
  slot: DeviceSlot; device?: AppointmentDevice; customer: Customer; context: WorkPhotoContext;
  retained: boolean; onSaved: (device: AppointmentDevice) => void;
}) {
  const [data, setData] = useState<DeviceTechnicalData>(device?.data || {});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [side, setSide] = useState<"indoor" | "outdoor" | null>(null);
  const [ocr, setOcr] = useState<Awaited<ReturnType<typeof recognizeDeviceLabel>> & { side: "indoor" | "outdoor" } | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const request = useRef<AbortController | null>(null);
  const saveInProgress = useRef(false);
  const fieldsStart = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => { setData(device?.data || {}); }, [device?.updatedAt]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); request.current = null; }; }, []);

  async function save() {
    if (!mounted.current || request.current || saveInProgress.current) return;
    saveInProgress.current = true;
    setSaving(true); setMessage("");
    try {
      const saved = await saveAppointmentDevice(context, slot, data, device);
      if (mounted.current) { onSaved(saved); setOcr(null); setMessage("Készülékadatok mentve."); }
      return saved;
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "A mentés nem sikerült.");
    } finally { saveInProgress.current = false; if (mounted.current) setSaving(false); }
  }

  async function openPhotos(next: "indoor" | "outdoor") {
    if (!mounted.current || request.current || saveInProgress.current) return;
    if (side === next) { setSide(null); return; }
    if ((device || await save()) && mounted.current) setSide(next);
  }

  async function recognize(photo: WorkPhoto) {
    if (!mounted.current || request.current || saveInProgress.current || !photo.deviceSide || photo.deviceId !== device?.id) return;
    const controller = new AbortController(); request.current = controller;
    const targetSide = photo.deviceSide;
    const isCurrent = () => mounted.current && request.current === controller && !controller.signal.aborted;
    let downloaded = false;
    setRecognizing(true); setProgress(0); setOcr(null); setMessage("");
    try {
      const blob = await downloadWorkPhoto(photo);
      if (!isCurrent()) return;
      downloaded = true;
      const result = await recognizeDeviceLabel(blob, targetSide, (value) => { if (isCurrent()) setProgress(value); }, controller.signal);
      if (isCurrent()) {
        setData((current) => {
          const next = { ...current };
          const fields = [
            ["manufacturer", result.manufacturers],
            [targetSide === "indoor" ? "indoorModel" : "outdoorModel", result.models],
            [targetSide === "indoor" ? "indoorSerial" : "outdoorSerial", result.candidates],
          ] as const;
          for (const [field, candidates] of fields) {
            if (!current[field]?.trim() && candidates.length === 1) next[field] = candidates[0];
          }
          return next;
        });
        setOcr({ side: targetSide, ...result });
        fieldsStart.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (error) {
      if (isCurrent()) setMessage(downloaded
        ? serialRecognitionErrorMessage(error)
        : "Az adattábla-fotó nem tölthető be. Próbáld újra.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (mounted.current) setRecognizing(false);
      }
    }
  }

  function field(key: "manufacturer" | "indoorModel" | "outdoorModel" | "indoorSerial" | "outdoorSerial", label: string) {
    const candidates = !ocr ? [] : key === "manufacturer" ? ocr.manufacturers
      : key === `${ocr.side}Model` ? ocr.models : key === `${ocr.side}Serial` ? ocr.candidates : [];
    const choices = candidates.filter((candidate) => candidate !== (data[key] || ""));
    return <div>
      <label className="block text-sm font-bold text-slate-200">{label}
        <input className="input mt-1 disabled:opacity-50" disabled={saving || recognizing} maxLength={200} value={data[key] || ""} onChange={(event) => {
          if (!request.current && !saveInProgress.current) setData((current) => ({ ...current, [key]: event.target.value }));
        }} />
      </label>
      {choices.length ? <div className="mt-2 rounded-xl bg-cyan-300/10 p-2">
        <p className="text-xs font-bold text-cyan-100">{data[key]?.trim() ? "Eltérő beolvasott javaslat:" : "Válassz a beolvasott javaslatok közül:"}</p>
        <div className="mt-2 flex flex-wrap gap-2">{choices.map((candidate) => <button key={candidate} type="button" disabled={saving || recognizing}
          aria-label={`${label}: ${candidate} használata`} className={`${button} break-all bg-cyan-300 text-slate-950`} onClick={() => {
            if (!request.current && !saveInProgress.current) setData((current) => ({ ...current, [key]: candidate }));
          }}>{candidate}</button>)}</div>
      </div> : null}
    </div>;
  }

  const missingFields = ocr ? [
    ["manufacturer", "gyártó", ocr.manufacturers],
    [ocr.side === "indoor" ? "indoorModel" : "outdoorModel", ocr.side === "indoor" ? "beltéri típus" : "kültéri típus", ocr.models],
    [ocr.side === "indoor" ? "indoorSerial" : "outdoorSerial", ocr.side === "indoor" ? "beltéri sorozatszám" : "kültéri sorozatszám", ocr.candidates],
  ] as const : [];
  const unreadableFields = missingFields.filter(([key, _label, candidates]) => !data[key]?.trim() && !candidates.length).map(([, label]) => label);

  return <div className="rounded-2xl border border-cyan-200/20 bg-slate-950/40 p-4">
    <h4 className="font-black text-slate-100">{slot.productName} · {slot.unitNumber}. készülék</h4>
    {retained ? <p className="mt-2 text-sm text-amber-200">Korábban rögzített készülék; már nincs a jelenlegi tételek között.</p> : null}
    <div ref={fieldsStart} className="mt-3 scroll-mt-24">{field("manufacturer", "Gyártó")}</div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {(["indoor", "outdoor"] as const).map((deviceSide) => <section key={deviceSide} className="min-w-0 space-y-3 rounded-2xl border border-white/10 p-3">
        <h5 className="font-black text-cyan-100">{deviceSide === "indoor" ? "Beltéri egység" : "Kültéri egység"}</h5>
        {field(deviceSide === "indoor" ? "indoorModel" : "outdoorModel", deviceSide === "indoor" ? "Beltéri pontos típusa" : "Kültéri pontos típusa")}
        {field(deviceSide === "indoor" ? "indoorSerial" : "outdoorSerial", deviceSide === "indoor" ? "Beltéri sorozatszám (S/N)" : "Kültéri sorozatszám (S/N)")}
        <button type="button" disabled={saving || recognizing} aria-expanded={side === deviceSide} onClick={() => void openPhotos(deviceSide)} className={`${button} w-full bg-white/10 text-cyan-100`}>
          {deviceSide === "indoor" ? "Beltéri" : "Kültéri"} adattábla-fotók {side === deviceSide ? "−" : "+"}
        </button>
      </section>)}
    </div>
    {message ? <p role="status" className="mt-3 text-sm text-amber-100">{message}</p> : null}
    {recognizing ? <p role="status" className="mt-3 text-sm text-cyan-100">Adattábla beolvasása… {progress}%</p> : null}
    {ocr ? <div className="mt-3 rounded-xl bg-cyan-300/10 p-3">
      <p className="text-sm font-bold text-cyan-100">{ocr.candidates.length || ocr.manufacturers.length || ocr.models.length
        ? "Az egyértelmű javaslatok az üres mezőkbe kerültek. Ellenőrizd az adatokat, majd mentsd a készüléket."
        : "Nem találtam egyértelmű készülékadatot. Ellenőrizd a fotót, vagy írd be az adatokat."}</p>
      {ocr.source === "barcode" && ocr.candidates.length ? <p className="mt-2 text-sm font-bold text-amber-100">A vonalkódból beolvasott azonosítót hasonlítsd össze a fotón látható S/N-nel.</p> : null}
      {ocr.warning || unreadableFields.length ? <p className="mt-2 text-sm text-amber-100">
        {ocr.warning ? `${ocr.warning} ` : null}
        {unreadableFields.length ? `Nem olvasható: ${unreadableFields.join(", ")}. Készíts közelebbi, szemből fotózott adattábla-képet, vagy töltsd ki kézzel.` : null}
      </p> : null}
      <details className="mt-2 text-sm text-slate-200"><summary>Felismert szöveg</summary><pre className="mt-2 whitespace-pre-wrap break-words font-sans">{ocr.text}</pre></details>
    </div> : null}
    <button type="button" disabled={saving || recognizing} onClick={() => void save()} className={`${button} mt-4 bg-emerald-400 text-slate-950`}>{saving ? "Mentés…" : "Készülékadatok mentése"}</button>
    {side && device ? <WorkPhotosPanel key={`${device.id}:${side}`} customer={customer} workspaceId={context.workspaceId} device={{ id: device.id, side }} onRecognizeSerial={(photo) => void recognize(photo)} recognizing={recognizing} /> : null}
  </div>;
}

export function AppointmentDevicesPanel({ customer, workspaceId }: { customer: Customer; workspaceId?: string | null }) {
  const context = useMemo(() => workPhotoContext(customer, workspaceId), [customer, workspaceId]);
  const [devices, setDevices] = useState<AppointmentDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const slotResult = useMemo(() => { try { return { slots: deviceSlots(customer.quoteItems), error: "" }; } catch (error) { return { slots: [], error: (error as Error).message }; } }, [customer.quoteItems]);
  async function load() {
    if (!context) { setLoading(false); return; }
    const current = ++revision.current; setLoading(true); setError("");
    try { const result = await listAppointmentDevices(context); if (current === revision.current) setDevices(result); }
    catch (error) { if (current === revision.current) setError((error as Error).message); }
    finally { if (current === revision.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { revision.current += 1; }; }, [workspaceId, customer.id, customer.activeAppointmentId]);
  const currentKeys = new Set(slotResult.slots.map(deviceSlotKey));
  const slots = [...slotResult.slots, ...devices.filter((device) => !currentKeys.has(deviceSlotKey(device)))];
  return <section className="mt-4 border-t border-white/10 pt-4">
    <h3 className="font-black text-cyan-100">Készülékadatok és adattábla-fotók</h3>
    <div className="mt-4 space-y-3">
      {!context ? <p className="text-sm text-amber-200">Előbb mentsd el a telepítési időpontot.</p> : null}
      {loading ? <p role="status" className="text-sm text-slate-300">Készülékadatok betöltése…</p> : null}
      {error || slotResult.error ? <p role="alert" className="text-sm text-amber-200">{error || slotResult.error}</p> : null}
      {context ? <button type="button" disabled={loading} className={`${button} bg-white/10 text-cyan-100`} onClick={() => void load()}>Készülékadatok frissítése</button> : null}
      {context && !loading && !error && !slotResult.error ? slots.map((slot) => <DeviceEditor key={deviceSlotKey(slot)} slot={slot} device={devices.find((device) => deviceSlotKey(device) === deviceSlotKey(slot))} retained={!currentKeys.has(deviceSlotKey(slot))} context={context} customer={customer} onSaved={(device) => setDevices((current) => [...current.filter((item) => item.id !== device.id), device])} />) : null}
      {context && !loading && !error && !slots.length ? <p className="text-sm text-slate-300">Előbb add hozzá a telepített klímákat.</p> : null}
    </div>
  </section>;
}
