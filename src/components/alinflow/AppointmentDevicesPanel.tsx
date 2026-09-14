"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WorkPhotosPanel } from "./WorkPhotosPanel";
import { deviceSlots, deviceSlotKey, listAppointmentDevices, saveAppointmentDevice, type AppointmentDevice, type DeviceSlot, type DeviceTechnicalData } from "@/lib/alinflow/appointment-devices";
import { downloadWorkPhoto, workPhotoContext } from "@/lib/alinflow/work-photos";
import { recognizeSerialNumber } from "@/lib/alinflow/serial-recognition";
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
  const [ocr, setOcr] = useState<{ side: "indoor" | "outdoor"; candidates: string[]; text: string } | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { setData(device?.data || {}); }, [device?.updatedAt]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);

  async function save() {
    if (saving) return;
    setSaving(true); setMessage("");
    try {
      const saved = await saveAppointmentDevice(context, slot, data, device);
      if (mounted.current) { onSaved(saved); setMessage("Készülékadatok mentve."); }
      return saved;
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "A mentés nem sikerült.");
    } finally { if (mounted.current) setSaving(false); }
  }

  async function openPhotos(next: "indoor" | "outdoor") {
    if (side === next) { setSide(null); return; }
    if ((device || await save()) && mounted.current) setSide(next);
  }

  async function recognize(photo: WorkPhoto) {
    if (recognizing || !photo.deviceSide || photo.deviceId !== device?.id) return;
    const controller = new AbortController(); request.current = controller;
    setRecognizing(true); setProgress(0); setOcr(null); setMessage("");
    try {
      const blob = await downloadWorkPhoto(photo);
      if (!mounted.current || controller.signal.aborted) return;
      const result = await recognizeSerialNumber(blob, (value) => { if (mounted.current) setProgress(value); }, controller.signal);
      if (mounted.current && !controller.signal.aborted) setOcr({ side: photo.deviceSide, ...result });
    } catch {
      if (mounted.current) setMessage("A sorozatszámot nem sikerült felismerni. Próbálj közelebbi, éles fotót, vagy írd be kézzel.");
    } finally { if (mounted.current) setRecognizing(false); request.current = null; }
  }

  return <div className="rounded-2xl border border-cyan-200/20 bg-slate-950/40 p-4">
    <h4 className="font-black text-slate-100">{slot.productName} · {slot.unitNumber}. készülék</h4>
    {retained ? <p className="mt-2 text-sm text-amber-200">Korábban rögzített készülék; már nincs a jelenlegi tételek között.</p> : null}
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {([
        ["indoorSerial", "Beltéri sorozatszám (S/N)"], ["outdoorSerial", "Kültéri sorozatszám (S/N)"],
        ["indoorModel", "Beltéri pontos típusa"], ["outdoorModel", "Kültéri pontos típusa"], ["manufacturer", "Gyártó"],
      ] as const).map(([key, label]) => <label key={key} className="block text-sm font-bold text-slate-200">{label}
        <input className="input mt-1 disabled:opacity-50" disabled={saving} maxLength={200} value={data[key] || ""} onChange={(event) => setData((current) => ({ ...current, [key]: event.target.value }))} />
      </label>)}
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={saving} onClick={() => void save()} className={`${button} bg-emerald-400 text-slate-950`}>{saving ? "Mentés…" : "Készülékadatok mentése"}</button>
      <button type="button" disabled={saving} aria-expanded={side === "indoor"} onClick={() => void openPhotos("indoor")} className={`${button} bg-white/10 text-cyan-100`}>Beltéri adattábla-fotók {side === "indoor" ? "−" : "+"}</button>
      <button type="button" disabled={saving} aria-expanded={side === "outdoor"} onClick={() => void openPhotos("outdoor")} className={`${button} bg-white/10 text-cyan-100`}>Kültéri adattábla-fotók {side === "outdoor" ? "−" : "+"}</button>
    </div>
    {message ? <p role="status" className="mt-3 text-sm text-amber-100">{message}</p> : null}
    {recognizing ? <p role="status" className="mt-3 text-sm text-cyan-100">Sorozatszám felismerése… {progress}%</p> : null}
    {ocr ? <div className="mt-3 rounded-xl bg-cyan-300/10 p-3">
      <p className="text-sm font-bold text-cyan-100">{ocr.candidates.length ? "Ellenőrizd a javaslatot, majd válaszd ki a sorozatszámot:" : "Nem találtam egyértelmű S/N jelölést. A felismert szövegből kézzel is beírhatod."}</p>
      <div className="mt-2 flex flex-wrap gap-2">{ocr.candidates.map((serial) => <button key={serial} type="button" disabled={saving} className={`${button} break-all bg-cyan-300 text-slate-950`} onClick={() => {
        setData((current) => ({ ...current, [ocr.side === "indoor" ? "indoorSerial" : "outdoorSerial"]: serial }));
        setMessage("A kiválasztott sorozatszámot a Készülékadatok mentése gombbal rögzítheted."); setOcr(null);
      }}>{serial}</button>)}</div>
      <details className="mt-2 text-sm text-slate-200"><summary>Felismert szöveg</summary><pre className="mt-2 whitespace-pre-wrap break-words font-sans">{ocr.text}</pre></details>
    </div> : null}
    {side && device ? <WorkPhotosPanel key={`${device.id}:${side}`} customer={customer} workspaceId={context.workspaceId} device={{ id: device.id, side }} onRecognizeSerial={(photo) => void recognize(photo)} recognizing={recognizing} /> : null}
  </div>;
}

export function AppointmentDevicesPanel({ customer, workspaceId }: { customer: Customer; workspaceId?: string | null }) {
  const context = useMemo(() => workPhotoContext(customer, workspaceId), [customer, workspaceId]);
  const [devices, setDevices] = useState<AppointmentDevice[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const slotResult = useMemo(() => { try { return { slots: deviceSlots(customer.quoteItems), error: "" }; } catch (error) { return { slots: [], error: (error as Error).message }; } }, [customer.quoteItems]);
  async function load() {
    if (!context) return;
    const current = ++revision.current; setLoading(true); setError("");
    try { const result = await listAppointmentDevices(context); if (current === revision.current) setDevices(result); }
    catch (error) { if (current === revision.current) setError((error as Error).message); }
    finally { if (current === revision.current) setLoading(false); }
  }
  useEffect(() => { if (open) void load(); return () => { revision.current += 1; }; }, [open, workspaceId, customer.id, customer.activeAppointmentId]);
  const currentKeys = new Set(slotResult.slots.map(deviceSlotKey));
  const slots = [...slotResult.slots, ...devices.filter((device) => !currentKeys.has(deviceSlotKey(device)))];
  return <section className="mt-4 border-t border-white/10 pt-4">
    <button type="button" aria-expanded={open} className={`${button} w-full bg-cyan-300/15 text-cyan-100`} onClick={() => setOpen((current) => !current)}>Sorozatszámok és adattábla-fotók {open ? "−" : "+"}</button>
    {open ? <div className="mt-4 space-y-3">
      {!context ? <p className="text-sm text-amber-200">Előbb mentsd el a telepítési időpontot.</p> : null}
      {loading ? <p role="status" className="text-sm text-slate-300">Készülékadatok betöltése…</p> : null}
      {error || slotResult.error ? <p role="alert" className="text-sm text-amber-200">{error || slotResult.error}</p> : null}
      {context ? <button type="button" disabled={loading} className={`${button} bg-white/10 text-cyan-100`} onClick={() => void load()}>Készülékadatok frissítése</button> : null}
      {context && !loading && !error && !slotResult.error ? slots.map((slot) => <DeviceEditor key={deviceSlotKey(slot)} slot={slot} device={devices.find((device) => deviceSlotKey(device) === deviceSlotKey(slot))} retained={!currentKeys.has(deviceSlotKey(slot))} context={context} customer={customer} onSaved={(device) => setDevices((current) => [...current.filter((item) => item.id !== device.id), device])} />) : null}
      {context && !loading && !error && !slots.length ? <p className="text-sm text-slate-300">Előbb add hozzá a telepített klímákat.</p> : null}
    </div> : null}
  </section>;
}
