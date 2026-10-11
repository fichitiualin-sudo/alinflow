/**
 * Versioned customer information, independent of billing access and partner ACLs.
 * Legal references checked 2026-10-11: GDPR articles 6, 7, 13–22 and 77,
 * https://eur-lex.europa.eu/legal-content/HU/TXT/?uri=CELEX:32016R0679
 * https://www.edpb.europa.eu/sme/be-compliant/process-personal-data-lawfully_en
 * https://www.naih.hu/ugyfelszolgalat-kapcsolat
 * Factual retention, recipients and transfer details must be supplied by the business.
 */
export const PRIVACY_NOTICE_VERSION = "2026-10-11.1";

export type PrivacyParty = { legalName: string; address: string; email: string; phone: string; taxNumber: string };
export type PrivacyNoticeConfig = {
  enabled: boolean;
  serviceProvider: PrivacyParty;
  deviceSeller: PrivacyParty;
  partner: PrivacyParty;
  retentionText: string;
  recipientsText: string;
  internationalTransfersText: string;
};
export type PrivacyNoticeSnapshot = {
  version: string;
  controllers: Array<{ role: "device_seller" | "service_provider"; party: PrivacyParty }>;
  partner: PrivacyParty | null;
  customer: { name: string; address: string; phone: string; email: string };
  sections: Array<{ title: string; text: string }>;
  consentText: string;
  consentGranted: boolean;
  signerName: string;
  signatureDataUrl: string;
  signedAt: string;
};

const PARTY_LIMITS = { legalName: 300, address: 1000, email: 254, phone: 80, taxNumber: 80 } as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizedText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const objectValue = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function normalizePrivacyParty(input: unknown): PrivacyParty {
  const value = objectValue(input);
  return {
    legalName: normalizedText(value.legalName), address: normalizedText(value.address),
    email: normalizedText(value.email), phone: normalizedText(value.phone), taxNumber: normalizedText(value.taxNumber),
  };
}

export function defaultPrivacyNoticeConfig(): PrivacyNoticeConfig {
  return normalizePrivacyNoticeConfig(undefined);
}

export function normalizePrivacyNoticeConfig(input: unknown): PrivacyNoticeConfig {
  const value = objectValue(input);
  return {
    enabled: value.enabled === true,
    serviceProvider: normalizePrivacyParty(value.serviceProvider), deviceSeller: normalizePrivacyParty(value.deviceSeller),
    partner: normalizePrivacyParty(value.partner), retentionText: normalizedText(value.retentionText),
    recipientsText: normalizedText(value.recipientsText), internationalTransfersText: normalizedText(value.internationalTransfersText),
  };
}

function partyErrors(party: PrivacyParty, label: string) {
  const errors: string[] = [];
  if (!party.legalName) errors.push(`${label}: add meg a hivatalos vállalkozásnevet.`);
  if (!party.address) errors.push(`${label}: add meg a székhelyet.`);
  if (!EMAIL.test(party.email)) errors.push(`${label}: add meg az adatkezelési ügyekhez használható email-címet.`);
  for (const key of Object.keys(PARTY_LIMITS) as Array<keyof PrivacyParty>) {
    if (party[key].length > PARTY_LIMITS[key]) errors.push(`${label}: a(z) ${key} mező túl hosszú.`);
  }
  return errors;
}

export function privacyNoticeConfigValidation(input: PrivacyNoticeConfig, options: { requirePartner?: boolean } = {}): string[] {
  const config = normalizePrivacyNoticeConfig(input);
  if (!config.enabled && !options.requirePartner) return [];
  const errors = [...partyErrors(config.serviceProvider, "Munkát végző vállalkozás"), ...partyErrors(config.deviceSeller, "Készülékértékesítő")];
  for (const [key, label] of [
    ["retentionText", "adatmegőrzés idejét"], ["recipientsText", "szolgáltatókat és címzetteket"],
    ["internationalTransfersText", "EGT-n kívüli adattovábbítás feltételeit"],
  ] as const) {
    if (!config[key]) errors.push(`Add meg az ${label}.`);
    if (config[key].length > 4000) errors.push(`A(z) ${label} leírása legfeljebb 4000 karakter lehet.`);
  }
  if (options.requirePartner || Object.values(config.partner).some(Boolean)) errors.push(...partyErrors(config.partner, "Karbantartó partner"));
  return errors;
}
export const configValidation = privacyNoticeConfigValidation;

export function buildPrivacyNoticeContent(input: PrivacyNoticeConfig): PrivacyNoticeSnapshot["sections"] {
  const config = normalizePrivacyNoticeConfig(input);
  return [
    { title: "Ki és miért kezeli az adatokat?", text: "A készülékértékesítő az értékesítéshez, számlázáshoz és jótállási ügyintézéshez szükséges ügyfél-, készülék- és vásárlási adatokat kezeli. A munkát végző vállalkozás az egyeztetéshez, telepítéshez vagy karbantartáshoz, dokumentáláshoz és saját számlázásához szükséges nevet, címet, elérhetőségeket, készülék- és munkaadatokat, munkafotókat és aláírást kezeli. Mindegyik vállalkozás a saját tevékenységéhez szükséges adatokért felel." },
    { title: "Jogalap és az adatok megadása", text: "Az egyeztetés és teljesítés jogalapja a szerződés, illetve az azt megelőző, Ön által kért lépések (GDPR 6. cikk (1) b)). A kötelező számlázás és bizonylatmegőrzés jogalapja jogi kötelezettség (6. cikk (1) c)). Az ezekhez szükséges adatok nélkül a megrendelés nem teljesíthető. A karbantartó partnernek történő külön adatátadás jogalapja az önkéntes hozzájárulás (6. cikk (1) a)); ennek elutasítása nem érinti a telepítést." },
    { title: "Megőrzési idő", text: config.retentionText },
    { title: "Szolgáltatók és címzettek", text: config.recipientsText },
    { title: "EGT-n kívüli adattovábbítás", text: config.internationalTransfersText },
    { title: "Karbantartó partner", text: "Külön hozzájárulás esetén kizárólag az Ön neve, a karbantartás címe, telefonszáma és email-címe adható át az alább név szerint megjelölt partnernek, karbantartás egyeztetésére és elvégzésére. Más partnerhez új hozzájárulás szükséges. A hozzájárulás bármikor visszavonható a fenti vállalkozások email-címén, telefonon vagy személyesen; a visszavonás előtti adatkezelés jogszerűségét ez nem érinti." },
    { title: "Az Ön jogai", text: "A fenti elérhetőségeken kérhet hozzáférést, helyesbítést, valamint a jogszabályi feltételek szerint törlést, korlátozást és adathordozhatóságot; jogos érdeken alapuló adatkezelés ellen tiltakozhat. Kérelmére főszabály szerint egy hónapon belül választ kap. Panasszal a Nemzeti Adatvédelmi és Információszabadság Hatósághoz fordulhat (naih.hu, ugyfelszolgalat@naih.hu, 1055 Budapest, Falk Miksa utca 9–11.), vagy bírósági jogorvoslatot kérhet." },
    { title: "A tájékoztatás és a hozzájárulás különválik", text: "A tájékoztató átvételét rögzítő aláírás önmagában nem engedélyezi az adatátadást. A partneri hozzájárulást az ügyfél külön, önkéntesen jelöli. A dokumentum nem marketingcélú engedély." },
  ];
}

export function partnerConsentText(config: PrivacyNoticeConfig) {
  if (!config.partner.legalName) return "Karbantartó partner nincs megjelölve; partneri adattovábbításhoz nem adok hozzájárulást.";
  return `Hozzájárulok, hogy ${config.serviceProvider.legalName} és ${config.deviceSeller.legalName} a nevemet, a karbantartás címét, telefonszámomat és email-címemet ${config.partner.legalName} részére átadja, kizárólag klímakarbantartás egyeztetése és elvégzése céljából, és a partner ebből a célból megkeressen. A hozzájárulás önkéntes, bármikor visszavonható a tájékoztatóban megadott módon.`;
}

export function buildPrivacyNoticeSnapshot(input: {
  config: PrivacyNoticeConfig; customer: PrivacyNoticeSnapshot["customer"]; signerName: string;
  signatureDataUrl: string; signedAt: string; consentGranted: boolean;
}): PrivacyNoticeSnapshot {
  const config = normalizePrivacyNoticeConfig(input.config);
  if (!config.enabled) throw new Error("Az adatkezelési tájékoztató nincs bekapcsolva.");
  const errors = privacyNoticeConfigValidation(config, { requirePartner: input.consentGranted });
  if (errors.length) throw new Error(errors.join(" "));
  return parsePrivacyNoticeSnapshot({
    version: PRIVACY_NOTICE_VERSION,
    controllers: [{ role: "device_seller", party: config.deviceSeller }, { role: "service_provider", party: config.serviceProvider }],
    partner: config.partner.legalName ? config.partner : null,
    customer: { name: normalizedText(input.customer.name), address: normalizedText(input.customer.address), phone: normalizedText(input.customer.phone), email: normalizedText(input.customer.email) },
    sections: buildPrivacyNoticeContent(config), consentText: partnerConsentText(config), consentGranted: input.consentGranted,
    signerName: normalizedText(input.signerName), signatureDataUrl: input.signatureDataUrl, signedAt: input.signedAt,
  })!;
}

function invalidSnapshot(): never { throw new Error("A mentett adatkezelési nyilatkozat hiányos vagy sérült. Ellenőrizd az eredeti dokumentumot."); }
function strictObject(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalidSnapshot();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) invalidSnapshot();
  return value;
}
function boundedString(value: unknown, max: number, required = false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) invalidSnapshot();
  return value;
}
function strictParty(input: unknown): PrivacyParty {
  const value = strictObject(input, Object.keys(PARTY_LIMITS));
  const party = Object.fromEntries(Object.entries(PARTY_LIMITS).map(([key, max]) => [key, boundedString(value[key], max, ["legalName", "address", "email"].includes(key))])) as PrivacyParty;
  if (!EMAIL.test(party.email)) invalidSnapshot();
  return party;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Reads only the saved statement; never substitutes current settings or another document's signature. */
export function parsePrivacyNoticeSnapshot(input: unknown): PrivacyNoticeSnapshot | undefined {
  if (input === null || input === undefined) return undefined;
  const value = strictObject(input, ["version", "controllers", "partner", "customer", "sections", "consentText", "consentGranted", "signerName", "signatureDataUrl", "signedAt"]);
  // A later text/schema version must keep a reader for this version: signed snapshots
  // remain readable and are never regenerated from the newest business settings.
  if (value.version !== PRIVACY_NOTICE_VERSION || typeof value.consentGranted !== "boolean") invalidSnapshot();
  if (!Array.isArray(value.controllers) || value.controllers.length !== 2) invalidSnapshot();
  const controllers = value.controllers.map((entry): PrivacyNoticeSnapshot["controllers"][number] => {
    const controller = strictObject(entry, ["role", "party"]);
    if (controller.role !== "device_seller" && controller.role !== "service_provider") invalidSnapshot();
    return { role: controller.role, party: strictParty(controller.party) };
  });
  if (new Set(controllers.map((controller) => controller.role)).size !== 2) invalidSnapshot();
  const partner = value.partner === null ? null : strictParty(value.partner);
  if (value.consentGranted && !partner) invalidSnapshot();
  const customer = strictObject(value.customer, ["name", "address", "phone", "email"]);
  if (!Array.isArray(value.sections) || !value.sections.length || value.sections.length > 12) invalidSnapshot();
  const sections = value.sections.map((entry) => {
    const section = strictObject(entry, ["title", "text"]);
    return { title: boundedString(section.title, 120, true), text: boundedString(section.text, 5000, true) };
  });
  if (sections.reduce((total, section) => total + section.text.length, 0) > 20000) invalidSnapshot();
  const signedAt = boundedString(value.signedAt, 40, true);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(signedAt) || !Number.isFinite(Date.parse(signedAt))) invalidSnapshot();
  const signatureDataUrl = boundedString(value.signatureDataUrl, 2_000_000, true);
  if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(signatureDataUrl)) invalidSnapshot();
  return deepFreeze({
    version: value.version, controllers, partner,
    customer: { name: boundedString(customer.name, 300, true), address: boundedString(customer.address, 1000, true), phone: boundedString(customer.phone, 80), email: boundedString(customer.email, 254) },
    sections, consentText: boundedString(value.consentText, 4000, true), consentGranted: value.consentGranted,
    signerName: boundedString(value.signerName, 300, true), signatureDataUrl, signedAt,
  });
}
