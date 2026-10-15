"use client";

import { normalizePrivacyNoticeConfig, normalizePrivacyParty, privacyNoticeConfigValidation, type PrivacyNoticeConfig, type PrivacyParty } from "@/lib/alinflow/privacy-notice";
import { PrivacyPartnerPicker } from "./PrivacyPartnerPicker";

const inputClass = "mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-slate-50 outline-none transition focus:border-cyan-300";

function PartyFields({ title, value, disabled, onChange }: { title: string; value: PrivacyParty; disabled?: boolean; onChange: (value: PrivacyParty) => void }) {
  return (
    <details className="min-w-0 rounded-2xl border border-white/10">
      <summary className="cursor-pointer break-words rounded-2xl p-4 font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
        <span>{title}</span>
        <span className="mt-1 block text-sm font-normal text-slate-300">{[value.legalName, value.address].filter(Boolean).join(" · ") || "Vállalkozási adatok megadása"}</span>
      </summary>
      <fieldset disabled={disabled} className="grid min-w-0 gap-3 border-0 px-4 pb-4 md:grid-cols-2">
        <legend className="sr-only">{title}</legend>
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
      </fieldset>
    </details>
  );
}

export function PrivacyNoticeSettings({ value, workspaceId, disabled, onChange }: { value?: PrivacyNoticeConfig; workspaceId?: string; disabled?: boolean; onChange: (value: PrivacyNoticeConfig) => void }) {
  const config = value || normalizePrivacyNoticeConfig(undefined);
  const errors = privacyNoticeConfigValidation(config);
  function update<K extends keyof PrivacyNoticeConfig>(key: K, next: PrivacyNoticeConfig[K]) { onChange({ ...config, [key]: next }); }
  return (
    <section className="min-w-0 space-y-4">
      <h3 className="text-xl font-black">Tájékoztató a munkalaphoz</h3>
      <p className="text-sm text-slate-300">Minden új aláírt munkalap saját tájékoztatót kap. Karbantartásnál a munkát végző vállalkozás szerepel benne; telepítésnél a készülékértékesítő is. Az ügyfél a megjelölt karbantartó partnernek külön, önkéntesen adhat hozzájárulást.</p>
      <label className="flex items-start gap-3 rounded-2xl bg-slate-950/60 p-3 font-bold sm:p-4">
        <input type="checkbox" checked={config.enabled} disabled={disabled} onChange={(event) => update("enabled", event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-cyan-300" />
        <span>Adatkezelési tájékoztató használata a munkalapnál<span className="mt-1 block text-sm font-normal text-slate-300">Bekapcsolás előtt ellenőrizd a vállalkozásokat és a tényleges adatkezelés leírását.</span></span>
      </label>
      <PartyFields title="Munkát végző vállalkozás (EV)" value={config.serviceProvider} disabled={disabled} onChange={(next) => update("serviceProvider", next)} />
      <PartyFields title="Készülékértékesítő vállalkozás – telepítéshez" value={config.deviceSeller} disabled={disabled} onChange={(next) => update("deviceSeller", next)} />
      <p className="text-sm text-slate-400">Ha csak karbantartást végzel, a készülékértékesítő mezői üresen maradhatnak.</p>
      <PrivacyPartnerPicker key={workspaceId || "no-workspace"} workspaceId={workspaceId} disabled={disabled} value={config.partner} partnerUserId={config.partnerUserId} partnerWorkspaceId={config.partnerWorkspaceId}
        onSelect={(candidate) => onChange({ ...config, partner: candidate ? { ...candidate.party } : normalizePrivacyParty(undefined), partnerUserId: candidate?.userId, partnerWorkspaceId: candidate?.workspaceId })} />
      <details className="min-w-0 rounded-2xl border border-white/10">
        <summary className="cursor-pointer rounded-2xl p-4 font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Adatkezelési részletek</summary>
        <div className="space-y-4 px-4 pb-4">
          {([
            ["retentionText", "Adatmegőrzés ideje vagy meghatározásának szempontjai", "Külön írd le a munkadokumentumok, számlázási adatok és partneri hozzájárulás megőrzését."],
            ["recipientsText", "Igénybe vett szolgáltatók és egyéb címzettek", "Tárhely, email, számlázás, könyvelés; az igénybe vett szolgáltatók és feladataik."],
            ["internationalTransfersText", "EGT-n kívüli adattovábbítás", "A tényleges szolgáltatói adatkezelés és az alkalmazott garanciák, illetve ezek elérhetősége."],
          ] as const).map(([key, label, hint]) => <label key={key} className="block">
            <span className="text-sm font-bold text-slate-300">{label}</span>
            <textarea rows={4} maxLength={4000} value={config[key]} disabled={disabled} onChange={(event) => update(key, event.target.value)} className={inputClass} />
            <span className="mt-1 block text-xs text-slate-400">{hint}</span>
          </label>)}
        </div>
      </details>
      {errors.length ? <div role="alert" className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
        <p className="font-black">Bekapcsoláshoz még szükséges:</p><ul className="mt-2 list-inside list-disc space-y-1">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
      </div> : null}
    </section>
  );
}
