"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import type { Workspace } from "@/lib/alinflow/types";
import type { BillingInvoiceMode, PaymentMethod, WorkspaceSettings } from "@/lib/alinflow/workspace-settings";
import { normalizeManualCalendarEmail } from "@/lib/alinflow/workspace-settings";
import { Back, Shell } from "@/components/alinflow/LayoutPrimitives";
import { WorkSectionIcon, type WorkSectionIconName } from "@/components/alinflow/WorkSectionIcon";
import { GoogleContactsSettingsPanel } from "@/components/alinflow/GoogleContactsSettingsPanel";
import { GoogleCalendarSettingsPanel } from "@/components/alinflow/GoogleCalendarSettingsPanel";
import type { GoogleCalendarStatus } from "@/components/alinflow/GoogleCalendarSync";
import { PrivacyNoticeSettings } from "@/components/alinflow/PrivacyNoticeSettings";
import { MaintenanceAccessSettings } from "@/components/alinflow/MaintenanceAccessSettings";
import { normalizePrivacyNoticeConfig, privacyNoticeConfigValidation } from "@/lib/alinflow/privacy-notice";

type SettingsPanelProps = {
  activeWorkspace: Workspace | null;
  userId?: string;
  googleCalendar: { status: GoogleCalendarStatus | null; loading: boolean; error: string; returnMessage: string };
  googleContactsReturnMessage?: string;
  settings: WorkspaceSettings;
  schemaAvailable: boolean;
  saving: boolean;
  message?: string;
  onBack: () => void;
  onSave: (settings: WorkspaceSettings) => Promise<void> | void;
};

type SectionName = keyof WorkspaceSettings;

function SettingsSection({ title, summary, icon, children, initiallyOpen = false, attention = false }: {
  title: string; summary: string; icon: WorkSectionIconName; children: ReactNode; initiallyOpen?: boolean; attention?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen || attention);
  const panelId = useId();
  useEffect(() => { if (attention) setOpen(true); }, [attention]);
  return <section className="min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-white/5">
    <h3>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 p-4 text-left outline-none transition hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300 sm:p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-300/15 text-cyan-200"><WorkSectionIcon name={icon} className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1"><span className="block text-lg font-black">{title}</span><span className="mt-1 block break-words text-sm font-normal text-slate-300">{summary}</span></span>
        <span aria-hidden="true" className="shrink-0 text-xl font-bold text-cyan-200">{open ? "−" : "+"}</span>
      </button>
    </h3>
    <div id={panelId} hidden={!open} className={open ? "space-y-4 border-t border-white/10 p-3 sm:p-5" : "hidden"}>{children}</div>
  </section>;
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  const isEmail = type === "email";
  return (
    <label className="block">
      <span className="text-sm font-bold text-slate-300">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        inputMode={isEmail ? "email" : undefined}
        autoCapitalize={isEmail ? "none" : undefined}
        autoCorrect={isEmail ? "off" : undefined}
        spellCheck={isEmail ? false : undefined}
        onChange={(event) => onChange(isEmail ? event.target.value.toLowerCase() : event.target.value)}
        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-slate-50 outline-none transition focus:border-cyan-300"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-slate-300">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-slate-50 outline-none transition focus:border-cyan-300"
      />
    </label>
  );
}

export function SettingsPanel({
  activeWorkspace,
  userId,
  googleCalendar,
  googleContactsReturnMessage,
  settings,
  schemaAvailable,
  saving,
  onBack,
  onSave,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState(settings);
  const invalidManualCalendarEmail = Boolean(draft.companyProfile.manualCalendarEmail.trim() && !normalizeManualCalendarEmail(draft.companyProfile.manualCalendarEmail));
  const invalidPrivacyNotice = privacyNoticeConfigValidation(normalizePrivacyNoticeConfig(draft.documentSettings.privacyNotice)).length > 0;

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  function updateSection<TSection extends SectionName, TKey extends keyof WorkspaceSettings[TSection]>(
    section: TSection,
    key: TKey,
    value: WorkspaceSettings[TSection][TKey],
  ) {
    setDraft((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [key]: value,
      },
    }));
  }

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(settings);
  const savedPartner = settings.documentSettings.privacyNotice;
  const draftPartner = draft.documentSettings.privacyNotice;
  const partnerChanged = savedPartner?.partnerUserId !== draftPartner?.partnerUserId || savedPartner?.partnerWorkspaceId !== draftPartner?.partnerWorkspaceId;
  const calendarAttention = Boolean(invalidManualCalendarEmail || googleCalendar.error || googleCalendar.returnMessage || googleCalendar.status?.lastError);
  const calendarSummary = googleCalendar.status?.connected ? "Automatikus szinkronizálás bekapcsolva" : "Kézi mentés és automatikus szinkronizálás";

  return (
    <Shell>
      <Back onClick={onBack} disabled={saving} />
      <div className="mx-auto w-full max-w-5xl">
        <section className="rounded-[2rem] border border-white/10 bg-white/5 p-3 shadow-2xl sm:p-6">
          <h2 className="mb-5 text-2xl font-black">Beállítások</h2>
          <fieldset disabled={saving} aria-busy={saving} className="min-w-0 space-y-4 border-0 p-0">
            <div className="rounded-2xl bg-cyan-300/10 p-4 text-sm text-cyan-100">
              <p className="font-black">{activeWorkspace?.name || "Aktuális munkaterület"}</p>
              <p className="mt-1">Válaszd ki, mit szeretnél módosítani, majd mentsd a beállításokat.</p>
            </div>
            {!schemaAvailable ? <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-950">A beállítások mentése jelenleg nem érhető el. Próbáld újra később.</p> : null}
            <SettingsSection key={`company:${activeWorkspace?.id}`} title="Vállalkozás adatai" summary={draft.companyProfile.legalName || "Név, elérhetőségek, weboldal és logó"} icon="registry" initiallyOpen>
              <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                <TextField label="Megjelenő név" value={draft.companyProfile.displayName} onChange={(value) => updateSection("companyProfile", "displayName", value)} />
                <TextField label="Vállalkozás hivatalos neve" value={draft.companyProfile.legalName} onChange={(value) => updateSection("companyProfile", "legalName", value)} />
                <TextField label="Telefonszám" value={draft.companyProfile.phone} onChange={(value) => updateSection("companyProfile", "phone", value)} />
                <TextField label="Email" type="email" value={draft.companyProfile.email} onChange={(value) => updateSection("companyProfile", "email", value)} />
                <TextField label="Székhely / cím" value={draft.companyProfile.address} onChange={(value) => updateSection("companyProfile", "address", value)} />
                <TextField label="Logó hivatkozása" value={draft.companyProfile.logoUrl} onChange={(value) => updateSection("companyProfile", "logoUrl", value)} />
                <TextField label="Weboldal" value={draft.companyProfile.website} onChange={(value) => updateSection("companyProfile", "website", value)} />
                <TextField label="Másodlagos weboldal" value={draft.companyProfile.secondaryWebsite} onChange={(value) => updateSection("companyProfile", "secondaryWebsite", value)} />
              </div>
            </SettingsSection>
            <SettingsSection key={`calendar:${activeWorkspace?.id}`} title="Google Naptár" summary={calendarSummary} icon="history" attention={calendarAttention}>
              <div className="space-y-3">
                <h4 className="font-black">Kézi naptármentés</h4>
                <TextField label="Google-fiók a kézi mentéshez" type="email" value={draft.companyProfile.manualCalendarEmail} onChange={(value) => updateSection("companyProfile", "manualCalendarEmail", value)} />
                <p className="text-sm text-slate-300">A + Naptár gombbal indítható. Üres mező esetén a böngészőben használt Google-fiók nyílik meg.</p>
                {invalidManualCalendarEmail ? <p role="alert" className="text-sm font-bold text-red-300">Adj meg egy érvényes email-címet.</p> : null}
              </div>
              {activeWorkspace?.id && userId ? <GoogleCalendarSettingsPanel key={`${activeWorkspace.id}:${userId}`} workspaceId={activeWorkspace.id} userId={userId} {...googleCalendar} /> : null}
            </SettingsSection>
            {activeWorkspace?.id && userId ? <SettingsSection key={`contacts:${activeWorkspace.id}:${userId}`} title="Google Névjegyek" summary="Ügyfelek a telefonkönyvben · egyezések és frissítés" icon="registry" attention={Boolean(googleContactsReturnMessage)}>
              <GoogleContactsSettingsPanel key={`${activeWorkspace.id}:${userId}`} workspaceId={activeWorkspace.id} userId={userId} returnMessage={googleContactsReturnMessage} canConnect={!hasChanges} />
            </SettingsSection> : null}
            <SettingsSection key={`quote:${activeWorkspace?.id}`} title="Árajánlat" summary="Érvényesség, ajánlati szövegek és alapszerelés" icon="documents">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField label="Ajánlat címe" value={draft.quoteSettings.title} onChange={(value) => updateSection("quoteSettings", "title", value)} />
                <TextField label="Érvényesség napokban" type="number" value={draft.quoteSettings.validityDays} onChange={(value) => updateSection("quoteSettings", "validityDays", Number(value || 1))} />
                <TextField label="Alcím" value={draft.quoteSettings.subtitle} onChange={(value) => updateSection("quoteSettings", "subtitle", value)} />
                <TextField label="Alapszerelés blokk címe" value={draft.quoteSettings.installationSectionTitle} onChange={(value) => updateSection("quoteSettings", "installationSectionTitle", value)} />
                <TextField label="Kivitelezés blokk címe" value={draft.quoteSettings.qualitySectionTitle} onChange={(value) => updateSection("quoteSettings", "qualitySectionTitle", value)} />
              </div>
              <TextArea label="Normál ajánlat bevezető szövege" value={draft.quoteSettings.bundleIntro} onChange={(value) => updateSection("quoteSettings", "bundleIntro", value)} />
              <TextArea label="Alternatív ajánlat bevezető szövege" value={draft.quoteSettings.alternativesIntro} onChange={(value) => updateSection("quoteSettings", "alternativesIntro", value)} />
              <TextArea label="Alapszerelés tartalma" rows={8} value={draft.quoteSettings.installationSectionContent} onChange={(value) => updateSection("quoteSettings", "installationSectionContent", value)} />
              <TextArea label="Kivitelezés tartalma" rows={6} value={draft.quoteSettings.qualitySectionContent} onChange={(value) => updateSection("quoteSettings", "qualitySectionContent", value)} />
              <TextArea label="Ajánlat elfogadási szöveg" value={draft.quoteSettings.acceptanceText} onChange={(value) => updateSection("quoteSettings", "acceptanceText", value)} />
            </SettingsSection>
            <SettingsSection key={`email:${activeWorkspace?.id}`} title="Emailek és dokumentumok" summary="Feladónév, köszönő email, értékelési linkek és láblécek" icon="transfer">
              <TextField label="Email feladó név" value={draft.emailSettings.senderName} onChange={(value) => updateSection("emailSettings", "senderName", value)} />
              <details className="rounded-2xl border border-white/10 p-4">
                <summary className="cursor-pointer font-black">Dokumentumok és emailek láblécei</summary>
                <div className="mt-4 space-y-4">
                  <TextArea label="Ajánlat lábléc" value={draft.quoteSettings.footerText} onChange={(value) => updateSection("quoteSettings", "footerText", value)} />
                  <TextArea label="Email lábléc" value={draft.emailSettings.footerText} onChange={(value) => updateSection("emailSettings", "footerText", value)} />
                  <TextArea label="Munkalap lábléc" value={draft.documentSettings.workReportFooterText} onChange={(value) => updateSection("documentSettings", "workReportFooterText", value)} />
                </div>
              </details>
              <TextField label="Köszönő email címe" value={draft.emailSettings.thankYouTitle} onChange={(value) => updateSection("emailSettings", "thankYouTitle", value)} />
              <TextArea label="Köszönő email első szövege" value={draft.emailSettings.thankYouIntro} onChange={(value) => updateSection("emailSettings", "thankYouIntro", value)} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField label="Google értékelési link" value={draft.emailSettings.googleReviewUrl} onChange={(value) => updateSection("emailSettings", "googleReviewUrl", value)} />
                <TextField label="Facebook értékelési link" value={draft.emailSettings.facebookReviewUrl} onChange={(value) => updateSection("emailSettings", "facebookReviewUrl", value)} />
                <TextField label="Egyéb értékelési link neve" value={draft.emailSettings.customReviewLabel} onChange={(value) => updateSection("emailSettings", "customReviewLabel", value)} />
                <TextField label="Egyéb értékelési link" value={draft.emailSettings.customReviewUrl} onChange={(value) => updateSection("emailSettings", "customReviewUrl", value)} />
              </div>
            </SettingsSection>
            <SettingsSection key={`billing:${activeWorkspace?.id}`} title="Számlázás" summary="Fizetési mód, határidő és számlatételek" icon="billing">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold text-slate-300">Alapértelmezett fizetési mód</span>
                  <select
                    value={draft.billingSettings.defaultPaymentMethod}
                    onChange={(event) => updateSection("billingSettings", "defaultPaymentMethod", event.target.value as PaymentMethod)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-slate-50 outline-none transition focus:border-cyan-300"
                  >
                    <option value="cash">KP</option>
                    <option value="transfer">Utalás</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-slate-300">Számlázási mód</span>
                  <select
                    value={draft.billingSettings.invoiceMode}
                    onChange={(event) => updateSection("billingSettings", "invoiceMode", event.target.value as BillingInvoiceMode)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 font-bold text-slate-50 outline-none transition focus:border-cyan-300"
                  >
                    <option value="split">Két számla: készülék/anyag + munkadíj</option>
                    <option value="single">Egy számla: minden egyben</option>
                  </select>
                </label>
                <TextField label="Utalás fizetési határidő napokban" type="number" value={draft.billingSettings.transferDueDays} onChange={(value) => updateSection("billingSettings", "transferDueDays", Number(value || 1))} />
                <TextField label="Készülék / anyag számla blokk neve" value={draft.billingSettings.deviceInvoiceLabel} onChange={(value) => updateSection("billingSettings", "deviceInvoiceLabel", value)} />
                <TextField label="Munkadíj számla blokk neve" value={draft.billingSettings.laborInvoiceLabel} onChange={(value) => updateSection("billingSettings", "laborInvoiceLabel", value)} />
                <TextField label="Karbantartási számla tétel neve" value={draft.billingSettings.maintenanceInvoiceLabel} onChange={(value) => updateSection("billingSettings", "maintenanceInvoiceLabel", value)} />
                <TextField label="Egy számlás mód blokk neve" value={draft.billingSettings.combinedInvoiceLabel} onChange={(value) => updateSection("billingSettings", "combinedInvoiceLabel", value)} />
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm font-bold text-slate-200">
                <input
                  type="checkbox"
                  checked={draft.billingSettings.sendInvoiceEmailByDefault}
                  onChange={(event) => updateSection("billingSettings", "sendInvoiceEmailByDefault", event.target.checked)}
                  className="mt-1 h-5 w-5 accent-cyan-300"
                />
                <span>Számlázz.hu számla email küldése alapból bepipálva</span>
              </label>
              <p className="text-sm text-slate-400">A számlakibocsátó kapcsolatát külön kell beállítani. Az itt megadott nevek a számlázási felületen jelennek meg.</p>
            </SettingsSection>
            <SettingsSection key={`privacy:${activeWorkspace?.id}`} title="Adatkezelés és karbantartók" summary={draftPartner?.enabled ? "Tájékoztató bekapcsolva · vállalkozások és partnerhozzáférés" : "Tájékoztató, vállalkozások és partnerhozzáférés"} icon="signature" attention={invalidPrivacyNotice}>
              <PrivacyNoticeSettings key={activeWorkspace?.id || "no-workspace"} workspaceId={activeWorkspace?.id} disabled={saving} value={draft.documentSettings.privacyNotice} onChange={(value) => updateSection("documentSettings", "privacyNotice", value)} />
              {partnerChanged ? <p role="status" className="rounded-2xl bg-amber-50 p-3 text-sm font-bold text-amber-950">A karbantartó módosítását előbb mentsd. A hozzáférésnél addig a korábban mentett partner szerepel.</p> : null}
              {activeWorkspace?.id ? <MaintenanceAccessSettings key={`${activeWorkspace.id}:${savedPartner?.partnerUserId || "none"}:${savedPartner?.partnerWorkspaceId || "none"}`} workspaceId={activeWorkspace.id} privacy={settings.documentSettings.privacyNotice} /> : null}
            </SettingsSection>
            <div className="sticky bottom-2 z-10 flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950 p-4 shadow-xl sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm text-slate-300" aria-live="polite">
                <p>{saving ? "Beállítások mentése folyamatban…" : hasChanges ? "Módosítások mentésre várnak" : "A mentett beállítások láthatók"}</p>
                {invalidManualCalendarEmail || invalidPrivacyNotice ? <p role="alert" className="mt-1 font-bold text-amber-200">{invalidManualCalendarEmail ? "Ellenőrizd a Google Naptár email-címét." : "Az adatkezelési résznél még hiányoznak kötelező adatok."}</p> : null}
              </div>
              <button type="button" disabled={saving || !schemaAvailable || invalidManualCalendarEmail || invalidPrivacyNotice} onClick={() => void onSave(draft)} className="shrink-0 rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Mentés..." : "Beállítások mentése"}</button>
            </div>
          </fieldset>
        </section>
      </div>
    </Shell>
  );
}
