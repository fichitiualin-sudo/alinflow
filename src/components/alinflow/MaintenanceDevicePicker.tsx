"use client";

import type { Customer, MaintenanceDeviceSelection } from "@/lib/alinflow/types";
import { displayAddress } from "@/lib/alinflow/format";
import { maintenanceDeviceKey, maintenanceDeviceSlots } from "@/lib/alinflow/maintenance-devices";

export function MaintenanceDevicePicker({ works, installationIds, selections, onChange, disabled = false }: {
  works: Customer[];
  installationIds: string[];
  selections?: Record<string, MaintenanceDeviceSelection[]>;
  onChange: (installationId: string, devices: MaintenanceDeviceSelection[]) => void;
  disabled?: boolean;
}) {
  return <div className="space-y-3">
    {works.map(work => {
      const id = work.activeAppointmentId;
      if (!id) return null;
      let devices: MaintenanceDeviceSelection[];
      try { devices = maintenanceDeviceSlots(work.quoteItems); }
      catch {
        return <p key={id} className="rounded-2xl bg-amber-400/15 p-4 text-sm text-amber-100">Ennél a telepítésnél ellenőrizni kell a klímák darabszámát a készülékenkénti választáshoz.</p>;
      }
      const chosen = installationIds.includes(id) ? selections?.[id] ?? devices : [];
      const keys = new Set(chosen.map(maintenanceDeviceKey));
      return <fieldset key={id} disabled={disabled} className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/80 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold">{displayAddress(work) || "Korábbi telepítés"}</p>
          {devices.length > 1 ? <button type="button" className="rounded-xl px-3 py-2 text-sm font-bold text-cyan-200 disabled:opacity-50"
            onClick={() => onChange(id, chosen.length === devices.length ? [] : devices)}>
            {chosen.length === devices.length ? "Kijelölések törlése" : "Mind kijelölése"}
          </button> : null}
        </div>
        <p className="mb-3 text-xs text-slate-400">{work.date ? work.date.replaceAll("-", ".") : "Dátum nélkül"} · Kiválasztva: {chosen.length} / {devices.length} klíma</p>
        <div className="space-y-2">
          {devices.map(device => {
            const key = maintenanceDeviceKey(device);
            return <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/5 p-3">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-cyan-400" checked={keys.has(key)}
                onChange={event => onChange(id, event.target.checked
                  ? [...chosen, device] : chosen.filter(item => maintenanceDeviceKey(item) !== key))} />
              <span className="min-w-0 break-words text-sm font-bold">{device.productName}
                <span className="block text-xs font-normal text-slate-400">{device.unitNumber}. készülék</span>
              </span>
            </label>;
          })}
        </div>
        {work.maintenanceOptOut ? <p className="mt-2 text-xs text-slate-400">Nem kéri a karbantartást</p> : null}
      </fieldset>;
    })}
    {works.length && !installationIds.length ? <p className="rounded-2xl bg-amber-400/15 p-3 text-sm font-bold text-amber-100">Válassz legalább egy karbantartandó klímát.</p> : null}
  </div>;
}
