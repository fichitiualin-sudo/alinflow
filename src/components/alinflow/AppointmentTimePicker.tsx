"use client";

import type { AppointmentType, QuoteItem } from "@/lib/alinflow/types";
import { appointmentDurationLabel, appointmentTimeLabel, normalizeAppointmentTimeInput } from "@/lib/alinflow/appointments";

type Props = {
  appointmentType: AppointmentType;
  items: QuoteItem[];
  time: string;
  recommendedTimes: string[];
  availableTimes: string[];
  onChange: (time: string) => void;
};

export function AppointmentTimePicker({ appointmentType, items, time, recommendedTimes, availableTimes, onChange }: Props) {
  const normalizedTime = normalizeAppointmentTimeInput(time);
  const selectedTime = availableTimes.includes(normalizedTime) ? normalizedTime : "";
  const label = (value: string) => appointmentTimeLabel(appointmentType, value, items);
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-slate-300">Munka időtartama: {appointmentDurationLabel(appointmentType, items)}</p>
      {recommendedTimes.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {recommendedTimes.map(value => (
            <button type="button" key={value} className={selectedTime === value ? "slot-active" : "slot"} onClick={() => onChange(value)}>
              {label(value)}
            </button>
          ))}
        </div>
      ) : null}
      {selectedTime && !recommendedTimes.includes(selectedTime) ? (
        <p className="text-sm font-bold text-slate-300">Kiválasztva: {label(selectedTime)}</p>
      ) : null}
      {!recommendedTimes.length && !selectedTime ? (
        <p role="status" className="text-sm font-bold text-amber-200">Erre a napra nincs szabad ajánlott idősáv. Válassz másik napot.</p>
      ) : !selectedTime ? (
        <p role="status" className="text-sm font-bold text-amber-200">Válassz a munka teljes időtartamára szabad kezdést.</p>
      ) : null}
    </div>
  );
}
