export type FacebookLeadsConfig = {
  workspaceId: string;
  pageId: string;
  formIds: string[];
  adClimateMap: Record<string, string>;
  cityField?: string;
};

export type FacebookLeadStatus = {
  configured: boolean;
  ready: boolean;
  message: string;
  climateNames: string[];
};

export type FacebookLeadSyncResult = {
  imported: number;
  matched: number;
  review: number;
  duplicates: number;
  nextCursor: string | null;
  nextFormId: string | null;
  hasMore: boolean;
};

export type FacebookLeadPayload = {
  name: string;
  phone: string;
  email: string;
  city: string;
  postal_code: string;
  climate_name: string;
  submitted_at: string;
  form_id: string;
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign_name: string;
};

export type FacebookGraphLead = {
  id: string;
  form_id: string;
  created_time: string;
  field_data: Array<{ name: string; values: string[] }>;
  ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  campaign_name?: string;
};

export function isFacebookId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,40}$/.test(value);
}

export function isWorkspaceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown, length: number) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, length) : "";
}

// Pure validation only: environment variables are read by the server module.
export function parseFacebookLeadsConfig(value: unknown): FacebookLeadsConfig | null {
  if (!record(value) || !isWorkspaceId(value.workspaceId) || !isFacebookId(value.pageId) ||
      !Array.isArray(value.formIds) || !value.formIds.length || value.formIds.length > 50 ||
      !value.formIds.every(isFacebookId) || !record(value.adClimateMap)) return null;
  const entries = Object.entries(value.adClimateMap);
  if (entries.length > 500 || entries.some(([id, climate]) => !isFacebookId(id) ||
      typeof climate !== "string" || !climate.trim() || climate.length > 200)) return null;
  if (value.cityField !== undefined && (typeof value.cityField !== "string" ||
      !value.cityField.trim() || value.cityField.length > 300)) return null;
  return {
    workspaceId: value.workspaceId.toLowerCase(), pageId: value.pageId,
    formIds: [...new Set(value.formIds)],
    adClimateMap: Object.fromEntries(entries.map(([id, climate]) => [id, clean(climate, 200)])),
    ...(value.cityField ? { cityField: value.cityField as string } : {}),
  };
}

export function validateFacebookGraphLead(value: unknown): value is FacebookGraphLead {
  if (!record(value) || !isFacebookId(value.id) || !isFacebookId(value.form_id) ||
      !isFacebookTimestamp(value.created_time) ||
      !Array.isArray(value.field_data) || value.field_data.length > 100) return false;
  for (const field of value.field_data) {
    if (!record(field) || typeof field.name !== "string" || field.name.length > 300 ||
        !Array.isArray(field.values) || field.values.length > 100 ||
        field.values.some(answer => typeof answer !== "string" || answer.length > 10000)) return false;
  }
  for (const key of ["ad_id", "campaign_id"]) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== "" && !isFacebookId(value[key])) return false;
  }
  for (const key of ["ad_name", "campaign_name"]) {
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== "string") return false;
  }
  return true;
}

function isFacebookTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64 ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/.test(value) ||
      !Number.isFinite(Date.parse(value))) return false;
  // Date.parse silently moves February 30 into March; do not invent a submitted date.
  const calendarDate = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(calendarDate.getTime()) && calendarDate.toISOString().slice(0, 10) === value.slice(0, 10);
}

function fieldKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function normalizeFacebookLead(lead: FacebookGraphLead, config: FacebookLeadsConfig): FacebookLeadPayload {
  const fields = new Map<string, string>();
  for (const field of lead.field_data) {
    const key = fieldKey(field.name);
    const answer = field.values.find(value => value.trim()) || "";
    if (!fields.has(key)) fields.set(key, answer);
  }
  const first = (names: string[]) => names.map(name => fields.get(fieldKey(name))).find(value => value?.trim()) || "";
  const explicitCity = config.cityField
    ? lead.field_data.find(field => field.name === config.cityField)?.values.find(value => value.trim()) || first([config.cityField])
    : "";
  const city = explicitCity || first(["city", "town", "település", "szerelés települése", "a szerelés települése", "melyik településen lenne a szerelés"]);
  const adId = isFacebookId(lead.ad_id) ? lead.ad_id : "";
  return {
    name: clean(first(["full_name", "name", "teljes név", "név"]) ||
      [first(["last_name", "vezetéknév"]), first(["first_name", "keresztnév"])].filter(Boolean).join(" "), 200),
    phone: clean(first(["phone_number", "phone", "telefonszám", "telefon"]), 80),
    email: clean(first(["email", "email_address", "e-mail cím"]), 320).toLowerCase(),
    city: clean(city, 200), postal_code: clean(first(["zip_code", "postal_code", "irányítószám"]), 20),
    climate_name: adId && Object.prototype.hasOwnProperty.call(config.adClimateMap, adId) ? config.adClimateMap[adId] : "",
    submitted_at: new Date(lead.created_time).toISOString(), form_id: lead.form_id,
    ad_id: adId, ad_name: clean(lead.ad_name, 300),
    campaign_id: isFacebookId(lead.campaign_id) ? lead.campaign_id : "",
    campaign_name: clean(lead.campaign_name, 300),
  };
}
