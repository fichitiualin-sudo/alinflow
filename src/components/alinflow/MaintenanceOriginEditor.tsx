"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { MaintenanceMapPoint } from "@/lib/alinflow/maintenance-map";

type MaintenanceOriginEditorProps = {
  point: MaintenanceMapPoint;
  busy: boolean;
  onSave: (origin: "own" | "external", sourceName: string) => Promise<boolean>;
  onClose: () => void;
};

export function MaintenanceOriginEditor({ point, busy, onSave, onClose }: MaintenanceOriginEditorProps) {
  const titleId = useId();
  const descriptionId = useId();
  const sourceId = useId();
  const radioName = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [origin, setOrigin] = useState<"own" | "external">(point.maintenanceOrigin === "external" ? "external" : "own");
  const [sourceName, setSourceName] = useState(point.maintenanceSourceName || "");
  const disabled = busy || saving;

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element && !element.open) element.showModal();
    return () => {
      element?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  function close() {
    if (!busy && !submitting.current) onClose();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setSaveError("");
    try {
      if (await onSave(origin, origin === "external" ? sourceName.trim() : "")) onClose();
      else setSaveError("A besorolás mentése nem sikerült. Próbáld újra.");
    } catch {
      setSaveError("A besorolás mentése nem sikerült. Próbáld újra.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); close(); }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 p-5 text-white shadow-2xl backdrop:bg-black/70 sm:p-6"
    >
      <form onSubmit={save} aria-busy={disabled} className="min-w-0 space-y-5">
        <div className="min-w-0">
          <h2 id={titleId} className="text-xl font-black">Klímák besorolása</h2>
          <p className="mt-3 break-words font-black">{point.customerName}</p>
          <p className="mt-1 break-words text-sm font-bold text-cyan-200">{point.climateSummary}</p>
          <p id={descriptionId} className="mt-3 text-sm leading-relaxed text-slate-300">A besorolás ennek a telepítésnek a klímáira vonatkozik. Nem hoz létre adatmegosztást.</p>
        </div>

        <fieldset disabled={disabled} className="min-w-0 space-y-2 disabled:opacity-60">
          <legend className="mb-2 text-sm font-bold text-slate-300">Honnan származik a telepítés?</legend>
          {([
            ["own", "Saját telepítés"],
            ["external", "Karbantartásra átvett"],
          ] as const).map(([value, label]) => (
            <label key={value} className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl border p-3 text-sm font-black ${origin === value ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100" : "border-white/10 bg-slate-900/80 text-slate-300"}`}>
              <input
                type="radio"
                name={radioName}
                value={value}
                checked={origin === value}
                onChange={() => setOrigin(value)}
                className="h-5 w-5 shrink-0 accent-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300"
              />
              <span className="min-w-0 break-words">{label}</span>
            </label>
          ))}
        </fieldset>

        {origin === "external" ? <div className="min-w-0">
          <label htmlFor={sourceId} className="mb-2 block text-sm font-bold text-slate-300">Kitől vetted át? (opcionális)</label>
          <input id={sourceId} type="text" className="input min-w-0" maxLength={160} value={sourceName} onChange={(event) => setSourceName(event.target.value)} disabled={disabled} />
        </div> : null}

        {saveError ? <p role="alert" className="text-sm font-bold text-red-200">{saveError}</p> : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={close} disabled={disabled} className="rounded-xl bg-white/10 px-4 py-3 text-sm font-black text-slate-200 disabled:cursor-not-allowed disabled:opacity-40">Mégse</button>
          <button type="submit" disabled={disabled} className="rounded-xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{disabled ? "Mentés..." : "Besorolás mentése"}</button>
        </div>
      </form>
    </dialog>
  );
}
