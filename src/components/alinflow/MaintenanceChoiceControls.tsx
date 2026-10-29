"use client";

import type { MaintenanceContactChoice } from "@/lib/alinflow/maintenance-contact-choice";

type MaintenanceChoiceControlsProps = {
  choice?: MaintenanceContactChoice;
  legacyOptOut: boolean;
  allowOriginalInstaller: boolean;
  busy?: boolean;
  onChange: (choice: MaintenanceContactChoice) => void;
};

export function MaintenanceChoiceControls({ choice, legacyOptOut, allowOriginalInstaller, busy = false, onChange }: MaintenanceChoiceControlsProps) {
  const selected = choice ?? (legacyOptOut ? "declined" : "open");
  const labelClass = "flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black text-slate-100";
  const inputClass = "h-5 w-5 shrink-0 disabled:cursor-wait disabled:opacity-50";

  return (
    <div role="group" aria-label="Karbantartási választás" aria-busy={busy} className="mt-3 grid gap-2">
      {allowOriginalInstaller ? <label className={labelClass}>
        <input type="checkbox" className={`${inputClass} accent-violet-400`} checked={selected === "original_installer"} disabled={busy}
          onChange={(event) => onChange(event.target.checked ? "original_installer" : "open")} />
        <span className="min-w-0 break-words">Az eredeti szerelőtől kéri</span>
      </label> : null}
      <label className={labelClass}>
        <input type="checkbox" className={`${inputClass} accent-zinc-400`} checked={selected === "declined"} disabled={busy}
          onChange={(event) => onChange(event.target.checked ? "declined" : "open")} />
        <span className="min-w-0 break-words">Nem kéri a karbantartást</span>
      </label>
    </div>
  );
}
