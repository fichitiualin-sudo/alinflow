"use client";

import { formatMaintenanceRefusalDate, type MaintenanceContactChoice } from "@/lib/alinflow/maintenance-contact-choice";

type MaintenanceChoiceControlsProps = {
  choice?: MaintenanceContactChoice;
  legacyOptOut: boolean;
  allowOriginalInstaller: boolean;
  busy?: boolean;
  declinedAt?: string | null;
  onChange: (choice: MaintenanceContactChoice) => void;
};

export function MaintenanceRefusalDate({ at }: { at?: string | null }) {
  const label = formatMaintenanceRefusalDate(at);
  return label ? <span className="mt-0.5 block text-xs font-medium text-slate-400">Megjelölve: {label}</span> : null;
}

export function MaintenanceChoiceControls({ choice, legacyOptOut, busy = false, declinedAt, onChange }: MaintenanceChoiceControlsProps) {
  const selected = choice ?? (legacyOptOut ? "declined" : "open");
  const labelClass = "flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black text-slate-100";
  const inputClass = "h-5 w-5 shrink-0 disabled:cursor-wait disabled:opacity-50";

  return (
    <div role="group" aria-label="Karbantartási választás" aria-busy={busy} className="mt-3 grid gap-2">
      <label className={labelClass}>
        <input type="checkbox" className={`${inputClass} accent-zinc-400`} checked={selected === "declined"} disabled={busy}
          onChange={(event) => onChange(event.target.checked ? "declined" : "open")} />
        <span className="min-w-0 break-words">Nem kéri a karbantartást
          {selected === "declined" ? <MaintenanceRefusalDate at={declinedAt} /> : null}
        </span>
      </label>
    </div>
  );
}
