export type PaymentMethod = "cash" | "transfer";

export type WorkspaceSettings = {
  companyProfile: {
    displayName: string;
    legalName: string;
    phone: string;
    email: string;
    address: string;
    website: string;
    secondaryWebsite: string;
    logoUrl: string;
  };
  quoteSettings: {
    title: string;
    subtitle: string;
    validityDays: number;
    bundleIntro: string;
    alternativesIntro: string;
    acceptanceText: string;
    laborProviderName: string;
    deviceProviderName: string;
    laborDescription: string;
    deviceDescription: string;
    footerText: string;
  };
  emailSettings: {
    senderName: string;
    footerText: string;
    appointmentHeaderText: string;
    thankYouTitle: string;
    thankYouIntro: string;
  };
  billingSettings: {
    defaultPaymentMethod: PaymentMethod;
    transferDueDays: number;
    deviceInvoiceLabel: string;
    laborInvoiceLabel: string;
    maintenanceInvoiceLabel: string;
    sendInvoiceEmailByDefault: boolean;
  };
  documentSettings: {
    workReportFooterText: string;
    quoteFooterText: string;
  };
};

export type WorkspaceSettingsRow = {
  workspace_id?: string | null;
  company_profile?: Record<string, unknown> | null;
  quote_settings?: Record<string, unknown> | null;
  email_settings?: Record<string, unknown> | null;
  billing_settings?: Record<string, unknown> | null;
  document_settings?: Record<string, unknown> | null;
};

type WorkspaceLike = {
  id?: string;
  name?: string;
  slug?: string;
} | null | undefined;

const GENERIC_SETTINGS: WorkspaceSettings = {
  companyProfile: {
    displayName: "AlinFlow",
    legalName: "",
    phone: "",
    email: "",
    address: "",
    website: "",
    secondaryWebsite: "",
    logoUrl: "",
  },
  quoteSettings: {
    title: "Klíma árajánlat",
    subtitle: "Klímaberendezés alapszereléssel együtt",
    validityDays: 7,
    bundleIntro: "A telefonos / online egyeztetés alapján az alábbi klímás ajánlatot küldjük. Az árak bruttó összegek, és alapszereléssel együtt értendők.",
    alternativesIntro: "A telefonos / online egyeztetés alapján az alábbi választható klímás ajánlatokat küldjük. Az árak bruttó összegek, alapszereléssel együtt, és külön-külön értendők.",
    acceptanceText: "Amennyiben megfelel Önnek az ajánlat, válasz emailben vagy telefonon tudunk időpontot egyeztetni.",
    laborProviderName: "",
    deviceProviderName: "",
    laborDescription: "klímatelepítési munkadíj",
    deviceDescription: "klímaberendezés + szerelési anyagok",
    footerText: "",
  },
  emailSettings: {
    senderName: "AlinFlow",
    footerText: "",
    appointmentHeaderText: "időpont visszaigazolás",
    thankYouTitle: "Köszönjük, hogy minket választottak!",
    thankYouIntro: "Köszönjük a bizalmat és a korrekt együttműködést.",
  },
  billingSettings: {
    defaultPaymentMethod: "cash",
    transferDueDays: 2,
    deviceInvoiceLabel: "Készülék és anyag",
    laborInvoiceLabel: "Munkadíj",
    maintenanceInvoiceLabel: "Légkondicionáló karbantartás",
    sendInvoiceEmailByDefault: true,
  },
  documentSettings: {
    workReportFooterText: "",
    quoteFooterText: "",
  },
};

const KLIMALIN_SETTINGS: WorkspaceSettings = {
  companyProfile: {
    displayName: "KLIMAlin",
    legalName: "Adorján Alin E.V.",
    phone: "06 30 700 4908",
    email: "klima.alin@gmail.com",
    address: "",
    website: "klimalin.hu",
    secondaryWebsite: "legkondikalkulator.hu",
    logoUrl: "/alin-klima-logo.png",
  },
  quoteSettings: {
    title: "KLIMAlin árajánlat",
    subtitle: "Klímaberendezés alapszereléssel együtt",
    validityDays: 7,
    bundleIntro: "A telefonos / online egyeztetés alapján az alábbi klímás ajánlatot küldjük. Az árak bruttó összegek, és alapszereléssel együtt értendők.",
    alternativesIntro: "A telefonos / online egyeztetés alapján az alábbi választható klímás ajánlatokat küldjük. Az árak bruttó összegek, alapszereléssel együtt, és külön-külön értendők.",
    acceptanceText: "Amennyiben megfelel Önnek az ajánlat, válasz emailben vagy telefonon tudunk időpontot egyeztetni.",
    laborProviderName: "Adorján Alin E.V.",
    deviceProviderName: "AMOVA 4U Kft.",
    laborDescription: "klímatelepítési munkadíj",
    deviceDescription: "klímaberendezés + szerelési anyagok",
    footerText: "Adorján Alin · KLIMAlin\nklimalin.hu · legkondikalkulator.hu · 06 30 700 4908",
  },
  emailSettings: {
    senderName: "KLIMAlin",
    footerText: "Adorján Alin · KLIMAlin\nklimalin.hu · legkondikalkulator.hu · 06 30 700 4908",
    appointmentHeaderText: "időpont visszaigazolás",
    thankYouTitle: "Köszönjük, hogy minket választottak!",
    thankYouIntro: "Örülünk, hogy ránk bízták a klíma telepítését. Használják egészséggel, sok kellemesen hűvös napot kívánunk!",
  },
  billingSettings: {
    defaultPaymentMethod: "cash",
    transferDueDays: 2,
    deviceInvoiceLabel: "Készülék és anyag",
    laborInvoiceLabel: "Munkadíj",
    maintenanceInvoiceLabel: "Légkondicionáló karbantartás",
    sendInvoiceEmailByDefault: true,
  },
  documentSettings: {
    workReportFooterText: "Adorján Alin · KLIMAlin\nklimalin.hu · legkondikalkulator.hu · 06 30 700 4908",
    quoteFooterText: "Adorján Alin · KLIMAlin\nklimalin.hu · legkondikalkulator.hu · 06 30 700 4908",
  },
};

function cloneSettings(settings: WorkspaceSettings): WorkspaceSettings {
  return JSON.parse(JSON.stringify(settings));
}

function normalizedText(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function optionalText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizedDays(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.round(parsed);
}

function normalizedPaymentMethod(value: unknown, fallback: PaymentMethod): PaymentMethod {
  return value === "transfer" ? "transfer" : fallback;
}

function workspaceUsesLegacyKlimalinDefaults(workspace: WorkspaceLike) {
  return !workspace?.slug || workspace.slug === "alinflow-existing";
}

export function defaultWorkspaceSettings(workspace?: WorkspaceLike): WorkspaceSettings {
  const settings = workspaceUsesLegacyKlimalinDefaults(workspace) ? cloneSettings(KLIMALIN_SETTINGS) : cloneSettings(GENERIC_SETTINGS);
  if (!workspaceUsesLegacyKlimalinDefaults(workspace) && workspace?.name) {
    settings.companyProfile.displayName = workspace.name;
    settings.emailSettings.senderName = workspace.name;
    settings.quoteSettings.title = `${workspace.name} árajánlat`;
  }
  return settings;
}

export function normalizeWorkspaceSettings(value: unknown, fallback = defaultWorkspaceSettings()): WorkspaceSettings {
  const source = (value || {}) as Partial<WorkspaceSettings>;
  return {
    companyProfile: {
      displayName: normalizedText(source.companyProfile?.displayName, fallback.companyProfile.displayName),
      legalName: optionalText(source.companyProfile?.legalName, fallback.companyProfile.legalName),
      phone: optionalText(source.companyProfile?.phone, fallback.companyProfile.phone),
      email: optionalText(source.companyProfile?.email, fallback.companyProfile.email),
      address: optionalText(source.companyProfile?.address, fallback.companyProfile.address),
      website: optionalText(source.companyProfile?.website, fallback.companyProfile.website),
      secondaryWebsite: optionalText(source.companyProfile?.secondaryWebsite, fallback.companyProfile.secondaryWebsite),
      logoUrl: optionalText(source.companyProfile?.logoUrl, fallback.companyProfile.logoUrl),
    },
    quoteSettings: {
      title: normalizedText(source.quoteSettings?.title, fallback.quoteSettings.title),
      subtitle: normalizedText(source.quoteSettings?.subtitle, fallback.quoteSettings.subtitle),
      validityDays: normalizedDays(source.quoteSettings?.validityDays, fallback.quoteSettings.validityDays),
      bundleIntro: normalizedText(source.quoteSettings?.bundleIntro, fallback.quoteSettings.bundleIntro),
      alternativesIntro: normalizedText(source.quoteSettings?.alternativesIntro, fallback.quoteSettings.alternativesIntro),
      acceptanceText: normalizedText(source.quoteSettings?.acceptanceText, fallback.quoteSettings.acceptanceText),
      laborProviderName: optionalText(source.quoteSettings?.laborProviderName, fallback.quoteSettings.laborProviderName),
      deviceProviderName: optionalText(source.quoteSettings?.deviceProviderName, fallback.quoteSettings.deviceProviderName),
      laborDescription: normalizedText(source.quoteSettings?.laborDescription, fallback.quoteSettings.laborDescription),
      deviceDescription: normalizedText(source.quoteSettings?.deviceDescription, fallback.quoteSettings.deviceDescription),
      footerText: optionalText(source.quoteSettings?.footerText, fallback.quoteSettings.footerText),
    },
    emailSettings: {
      senderName: normalizedText(source.emailSettings?.senderName, fallback.emailSettings.senderName),
      footerText: optionalText(source.emailSettings?.footerText, fallback.emailSettings.footerText),
      appointmentHeaderText: normalizedText(source.emailSettings?.appointmentHeaderText, fallback.emailSettings.appointmentHeaderText),
      thankYouTitle: normalizedText(source.emailSettings?.thankYouTitle, fallback.emailSettings.thankYouTitle),
      thankYouIntro: normalizedText(source.emailSettings?.thankYouIntro, fallback.emailSettings.thankYouIntro),
    },
    billingSettings: {
      defaultPaymentMethod: normalizedPaymentMethod(source.billingSettings?.defaultPaymentMethod, fallback.billingSettings.defaultPaymentMethod),
      transferDueDays: normalizedDays(source.billingSettings?.transferDueDays, fallback.billingSettings.transferDueDays),
      deviceInvoiceLabel: normalizedText(source.billingSettings?.deviceInvoiceLabel, fallback.billingSettings.deviceInvoiceLabel),
      laborInvoiceLabel: normalizedText(source.billingSettings?.laborInvoiceLabel, fallback.billingSettings.laborInvoiceLabel),
      maintenanceInvoiceLabel: normalizedText(source.billingSettings?.maintenanceInvoiceLabel, fallback.billingSettings.maintenanceInvoiceLabel),
      sendInvoiceEmailByDefault: typeof source.billingSettings?.sendInvoiceEmailByDefault === "boolean" ? source.billingSettings.sendInvoiceEmailByDefault : fallback.billingSettings.sendInvoiceEmailByDefault,
    },
    documentSettings: {
      workReportFooterText: optionalText(source.documentSettings?.workReportFooterText, fallback.documentSettings.workReportFooterText),
      quoteFooterText: optionalText(source.documentSettings?.quoteFooterText, fallback.documentSettings.quoteFooterText),
    },
  };
}

export function workspaceSettingsFromRow(row: WorkspaceSettingsRow | null | undefined, fallback: WorkspaceSettings): WorkspaceSettings {
  if (!row) return fallback;
  return normalizeWorkspaceSettings({
    companyProfile: row.company_profile || {},
    quoteSettings: row.quote_settings || {},
    emailSettings: row.email_settings || {},
    billingSettings: row.billing_settings || {},
    documentSettings: row.document_settings || {},
  }, fallback);
}

export function workspaceSettingsToRow(settings: WorkspaceSettings, workspaceId: string, updatedBy?: string | null) {
  const normalized = normalizeWorkspaceSettings(settings, settings);
  return {
    workspace_id: workspaceId,
    company_profile: normalized.companyProfile,
    quote_settings: normalized.quoteSettings,
    email_settings: normalized.emailSettings,
    billing_settings: normalized.billingSettings,
    document_settings: normalized.documentSettings,
    updated_by: updatedBy || null,
    updated_at: new Date().toISOString(),
  };
}

export function settingsFooterLines(settings: WorkspaceSettings, source: "quote" | "email" | "workReport" = "email") {
  const text =
    source === "quote"
      ? settings.quoteSettings.footerText || settings.documentSettings.quoteFooterText || settings.emailSettings.footerText
      : source === "workReport"
      ? settings.documentSettings.workReportFooterText || settings.emailSettings.footerText
      : settings.emailSettings.footerText || settings.quoteSettings.footerText;

  const fallback = [
    settings.companyProfile.legalName || settings.companyProfile.displayName,
    [settings.companyProfile.website, settings.companyProfile.secondaryWebsite, settings.companyProfile.phone].filter(Boolean).join(" · "),
  ].filter(Boolean);

  return (text ? text.split(/\r?\n/) : fallback).map((line) => line.trim()).filter(Boolean);
}

export function settingsBrandName(settings: WorkspaceSettings) {
  return settings.companyProfile.displayName || settings.emailSettings.senderName || "AlinFlow";
}

export function settingsContactLine(settings: WorkspaceSettings) {
  return [settings.companyProfile.website, settings.companyProfile.secondaryWebsite, settings.companyProfile.phone].filter(Boolean).join(" · ");
}

export function settingsPrimaryContact(settings: WorkspaceSettings) {
  return settings.companyProfile.phone || settings.companyProfile.email || settings.companyProfile.website || "";
}
