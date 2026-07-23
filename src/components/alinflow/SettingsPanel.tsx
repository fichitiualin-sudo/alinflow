"use client";

import { useEffect, useState } from "react";
import type { Workspace } from "@/lib/alinflow/types";
import type { PaymentMethod, WorkspaceSettings } from "@/lib/alinflow/workspace-settings";
import { Back, Btn, Card, Layout, Main, Shell, Side } from "@/components/alinflow/LayoutPrimitives";

type SettingsPanelProps = {
  activeWorkspace: Workspace | null;
  settings: WorkspaceSettings;
  schemaAvailable: boolean;
  saving: boolean;
  message?: string;
  onBack: () => void;
  onSave: (settings: WorkspaceSettings) => Promise<void> | void;
};

type SectionName = keyof WorkspaceSettings;

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
  return (
    <label className="block">
      <span className="text-sm font-bold text-slate-300">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
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
  settings,
  schemaAvailable,
  saving,
  message,
  onBack,
  onSave,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState(settings);

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

  return (
    <Shell>
      <Back onClick={onBack} />
      <Layout>
        <Main>
          <Card title="Beállítások">
            <div className="space-y-6">
              <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm font-bold text-cyan-100">
                <p className="text-base font-black">{activeWorkspace?.name || "Aktuális munkaterület"}</p>
                <p className="mt-1 text-cyan-100/80">Ezek a beállítások csak ehhez a munkaterülethez tartoznak. Zoli adatai nem keverednek Alin adataival.</p>
              </div>

              {!schemaAvailable ? (
                <div className="rounded-3xl border border-amber-300/30 bg-amber-300/15 p-4 text-sm font-black text-amber-100">
                  A személyre szabott beállítások mentéséhez előbb futtasd a workspace settings Supabase SQL-t.
                </div>
              ) : null}

              {message ? (
                <div className="rounded-3xl border border-emerald-300/30 bg-emerald-300/15 p-4 text-sm font-black text-emerald-100">
                  {message}
                </div>
              ) : null}

              <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField label="Megjelenő név" value={draft.companyProfile.displayName} onChange={(value) => updateSection("companyProfile", "displayName", value)} />
                <TextField label="Jogi név / vállalkozás neve" value={draft.companyProfile.legalName} onChange={(value) => updateSection("companyProfile", "legalName", value)} />
                <TextField label="Telefonszám" value={draft.companyProfile.phone} onChange={(value) => updateSection("companyProfile", "phone", value)} />
                <TextField label="Email" value={draft.companyProfile.email} onChange={(value) => updateSection("companyProfile", "email", value)} />
                <TextField label="Cím" value={draft.companyProfile.address} onChange={(value) => updateSection("companyProfile", "address", value)} />
                <TextField label="Logó URL" value={draft.companyProfile.logoUrl} onChange={(value) => updateSection("companyProfile", "logoUrl", value)} />
                <TextField label="Weboldal" value={draft.companyProfile.website} onChange={(value) => updateSection("companyProfile", "website", value)} />
                <TextField label="Másodlagos weboldal" value={draft.companyProfile.secondaryWebsite} onChange={(value) => updateSection("companyProfile", "secondaryWebsite", value)} />
              </section>

              <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-4">
                <h3 className="text-xl font-black">Árajánlat</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <TextField label="Ajánlat címe" value={draft.quoteSettings.title} onChange={(value) => updateSection("quoteSettings", "title", value)} />
                  <TextField label="Érvényesség napokban" type="number" value={draft.quoteSettings.validityDays} onChange={(value) => updateSection("quoteSettings", "validityDays", Number(value || 1))} />
                  <TextField label="Alcím" value={draft.quoteSettings.subtitle} onChange={(value) => updateSection("quoteSettings", "subtitle", value)} />
                  <TextField label="Email feladó név" value={draft.emailSettings.senderName} onChange={(value) => updateSection("emailSettings", "senderName", value)} />
                  <TextField label="Alapszerelés blokk címe" value={draft.quoteSettings.installationSectionTitle} onChange={(value) => updateSection("quoteSettings", "installationSectionTitle", value)} />
                  <TextField label="Minőségi kivitelezés blokk címe" value={draft.quoteSettings.qualitySectionTitle} onChange={(value) => updateSection("quoteSettings", "qualitySectionTitle", value)} />
                </div>
                <TextArea label="Normál ajánlat bevezető szövege" value={draft.quoteSettings.bundleIntro} onChange={(value) => updateSection("quoteSettings", "bundleIntro", value)} />
                <TextArea label="Alternatív ajánlat bevezető szövege" value={draft.quoteSettings.alternativesIntro} onChange={(value) => updateSection("quoteSettings", "alternativesIntro", value)} />
                <TextArea label="Alapszerelés tartalma" rows={8} value={draft.quoteSettings.installationSectionContent} onChange={(value) => updateSection("quoteSettings", "installationSectionContent", value)} />
                <TextArea label="Minőségi kivitelezés tartalma" rows={6} value={draft.quoteSettings.qualitySectionContent} onChange={(value) => updateSection("quoteSettings", "qualitySectionContent", value)} />
                <TextArea label="Ajánlat elfogadási szöveg" value={draft.quoteSettings.acceptanceText} onChange={(value) => updateSection("quoteSettings", "acceptanceText", value)} />
                <TextArea label="Ajánlat lábléc" value={draft.quoteSettings.footerText} onChange={(value) => updateSection("quoteSettings", "footerText", value)} />
              </section>

              <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-4">
                <h3 className="text-xl font-black">Email és dokumentum</h3>
                <TextArea label="Email lábléc" value={draft.emailSettings.footerText} onChange={(value) => updateSection("emailSettings", "footerText", value)} />
                <TextArea label="Munkalap lábléc" value={draft.documentSettings.workReportFooterText} onChange={(value) => updateSection("documentSettings", "workReportFooterText", value)} />
                <TextArea label="Köszönő email első szövege" value={draft.emailSettings.thankYouIntro} onChange={(value) => updateSection("emailSettings", "thankYouIntro", value)} />
              </section>

              <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-4">
                <h3 className="text-xl font-black">Számlázás</h3>
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
                  <TextField label="Utalás fizetési határidő napokban" type="number" value={draft.billingSettings.transferDueDays} onChange={(value) => updateSection("billingSettings", "transferDueDays", Number(value || 1))} />
                  <TextField label="Készülék / anyag számla blokk neve" value={draft.billingSettings.deviceInvoiceLabel} onChange={(value) => updateSection("billingSettings", "deviceInvoiceLabel", value)} />
                  <TextField label="Munkadíj számla blokk neve" value={draft.billingSettings.laborInvoiceLabel} onChange={(value) => updateSection("billingSettings", "laborInvoiceLabel", value)} />
                  <TextField label="Karbantartási számla tétel neve" value={draft.billingSettings.maintenanceInvoiceLabel} onChange={(value) => updateSection("billingSettings", "maintenanceInvoiceLabel", value)} />
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
                <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm font-bold text-amber-100">
                  API-kulcsot nem mentünk ide, mert ez böngészőből olvasható adat lenne. A Számlázz.hu kulcsok továbbra is biztonságosan a Vercel környezeti változókban maradnak.
                </div>
              </section>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={saving || !schemaAvailable}
                  onClick={() => void onSave(draft)}
                  className="rounded-2xl bg-emerald-400 px-5 py-4 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Mentés..." : "Beállítások mentése"}
                </button>
                <Btn color="blue" onClick={onBack}>Vissza</Btn>
              </div>
            </div>
          </Card>
        </Main>
        <Side>
          <Card title="Mit szabályoz?">
            <div className="space-y-3 text-sm font-bold text-slate-300">
              <p>Az ajánlat előnézete, nyomtatható ajánlat és ajánlat email innen veszi a cégadatokat.</p>
              <p>A későbbi bővítésekhez ugyanebbe a beállítási helyre kerülhetnek az új felhasználók számlázási és dokumentum sablon beállításai.</p>
              <p>Ha nincs külön mentett beállítás, Alin munkaterülete megtartja a jelenlegi KLIMAlin adatokat, az új munkaterületek pedig üres, saját alapot kapnak.</p>
            </div>
          </Card>
        </Side>
      </Layout>
    </Shell>
  );
}
