"use client";

import { useState } from "react";
import { normalizePrivacyNoticeConfig, normalizePrivacyParty, privacyNoticeConfigValidation, type PrivacyNoticeConfig, type PrivacyParty } from "@/lib/alinflow/privacy-notice";
import { PrivacyPartnerPicker } from "./PrivacyPartnerPicker";

const inputClass = "mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-slate-50 outline-none transition focus:border-cyan-300";

function PartyFields({ title, value, onChange }: { title: string; value: PrivacyParty; onChange: (value: PrivacyParty) => void }) {
  return (
    <fieldset className="min-w-0 rounded-2xl border border-white/10 p-4">
      <legend className="px-2 font-black">{title}</legend>
      <div className="grid gap-3 md:grid-cols-2">
        {([
          ["legalName", "Hivatalos vállalkozásnév", "text"], ["address", "Székhely", "text"],
          ["email", "Email adatkezelési ügyekhez", "email"], ["phone", "Telefonszám", "tel"], ["taxNumber", "Adószám", "text"],
        ] as const).map(([key, label, type]) => (
          <label key={key} className={`block ${key === "address" ? "md:col-span-2" : ""}`}>
            <span className="text-sm font-bold text-slate-300">{label}</span>
            <input type={type} value={value[key]} className={inputClass} maxLength={key === "address" ? 1000 : key === "legalName" ? 300 : key === "email" ? 254 : 80}
              autoCapitalize={type === "email" ? "none" : undefined} spellCheck={type === "email" ? false : undefined}
              onChange={(event) => onChange({ ...value, [key]: event.target.value })} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PrivacyNoticeSettings({ value, workspaceId, disabled, onChange }: { value?: PrivacyNoticeConfig; workspaceId?: string; disabled?: boolean; onChange: (value: PrivacyNoticeConfig) => void }) {
  const config = value || normalizePrivacyNoticeConfig(undefined);
  const errors = privacyNoticeConfigValidation(config);
  const [open, setOpen] = useState(config.enabled);
  function update<K extends keyof PrivacyNoticeConfig>(key: K, next: PrivacyNoticeConfig[K]) { onChange({ ...config, [key]: next }); }
  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-4">
      <button type="button" className="flex w-full items-center justify-between gap-3 text-left text-xl font-black" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Adatkezelési tájékoztató</span><span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? <>
        <p className="text-sm text-slate-300">Minden új aláírt munkalap saját tájékoztatót kap. Karbantartásnál a munkát végző vállalkozás szerepel benne; telepítésnél a készülékértékesítő is. Az ügyfél a megjelölt karbantartó partnernek külön, önkéntesen adhat hozzájárulást.</p>
        <label className="flex items-start gap-3 rounded-2xl bg-slate-950/60 p-4 font-bold">
          <input type="checkbox" checked={config.enabled} onChange={(event) => update("enabled", event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-cyan-300" />
          <span>Adatkezelési tájékoztató használata a munkalapnál<span className="mt-1 block text-sm font-normal text-slate-300">Bekapcsolás előtt ellenőrizd a vállalkozásokat és a tényleges adatkezelés leírását.</span></span>
        </label>
        <PartyFields title="Munkát végző vállalkozás (EV)" value={config.serviceProvider} onChange={(next) => update("serviceProvider", next)} />
        <PartyFields title="Készülékértékesítő vállalkozás – telepítéshez" value={config.deviceSeller} onChange={(next) => update("deviceSeller", next)} />
        <p className="text-sm text-slate-400">Ha csak karbantartást végzel, a készülékértékesítő mezői üresen maradhatnak.</p>
        <PrivacyPartnerPicker key={workspaceId || "no-workspace"} workspaceId={workspaceId} disabled={disabled} value={config.partner} partnerUserId={config.partnerUserId} partnerWorkspaceId={config.partnerWorkspaceId}
          onSelect={(candidate) => onChange({ ...config, partner: candidate ? { ...candidate.party } : normalizePrivacyParty(undefined), partnerUserId: candidate?.userId, partnerWorkspaceId: candidate?.workspaceId })} />
        {([
          ["retentionText", "Adatmegőrzés ideje vagy meghatározásának szempontjai", "Külön írd le a munkadokumentumok, számlázási adatok és partneri hozzájárulás megőrzését."],
          ["recipientsText", "Igénybe vett szolgáltatók és egyéb címzettek", "Tárhely, email, számlázás, könyvelés; az igénybe vett szolgáltatók és feladataik."],
          ["internationalTransfersText", "EGT-n kívüli adattovábbítás", "A tényleges szolgáltatói adatkezelés és az alkalmazott garanciák, illetve ezek elérhetősége."],
        ] as const).map(([key, label, hint]) => <label key={key} className="block">
          <span className="text-sm font-bold text-slate-300">{label}</span>
          <textarea rows={4} maxLength={4000} value={config[key]} onChange={(event) => update(key, event.target.value)} className={inputClass} />
          <span className="mt-1 block text-xs text-slate-400">{hint}</span>
        </label>)}
      </> : <p className="text-sm text-slate-300">{config.enabled ? "Bekapcsolva" : "Még nincs bekapcsolva"}</p>}
      {errors.length ? <div role="alert" className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
        <p className="font-black">Bekapcsoláshoz még szükséges:</p><ul className="mt-2 list-inside list-disc space-y-1">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
      </div> : null}
    </section>
  );
}
