import type { AppointmentDevice, DeviceDataField, DeviceTechnicalData } from "./appointment-devices";
import type { Customer, WorkPhotoContext } from "./types";
import type { WorkspaceSettings } from "./workspace-settings";
import { fullCustomerAddress } from "./format";

export const H_TARIFF_PROVIDERS = {
  eon: {
    label: "E.ON / ELMŰ Hálózati",
    template: "eon-25-htb-1-2.pdf",
    version: "25_HTB_1-2_DIGIT",
    source: "https://www.eon.hu/content/dam/eon/eon-hungary/documents/Lakossagi/aram/letltheto-nyomtatvanyok/25_HTB_1-2_DIGIT.pdf",
  },
  "mvm-demasz": {
    label: "MVM Démász",
    template: "mvm-aszab-10-ny03.pdf",
    version: "Á-SZAB-10-NY03, 2025.05.16.",
    source: "https://mvmhalozat.hu/attachments/40414",
  },
  "mvm-emasz": {
    label: "MVM Émász",
    template: "mvm-emasz-m050-01.pdf",
    version: "M_050_01",
    source: "https://mvmemaszhalozat.hu/elmu/file/downloadfile?id=6d2b087e-92d7-40fc-a8b9-9db2b7a19677",
  },
} as const;
export type HTariffProvider = keyof typeof H_TARIFF_PROVIDERS;
export const H_TARIFF_DATA_FIELDS = [
  "applicantName", "postalCode", "installationAddress", "customerIdentifier", "consumptionPlaceIdentifier",
  "meteringPointIdentifier", "totalSimultaneousElectricalKw", "location", "date",
  "installerName", "installerAddress", "installerPhone", "installerEmail",
  "electricianName", "electricianAddress", "electricianPhone", "electricianEmail", "notes",
  "emaszConsumptionPlaceIdentifier", "caseNumber", "installerFgasIdentifier",
] as const;
export type HTariffDataField = typeof H_TARIFF_DATA_FIELDS[number];
export type HTariffData = Record<HTariffDataField, string> & { provider: HTariffProvider | "" };
export type HTariffIssue = { label: string; field?: HTariffDataField | "provider"; deviceId?: string; deviceField?: DeviceDataField };

type FieldOption = readonly [string, string];
export type HTariffDeviceField = { key: DeviceDataField; label: string; options?: readonly FieldOption[]; optional?: boolean };
export const H_TARIFF_COMMON_DEVICE_FIELDS: readonly HTariffDeviceField[] = [
  { key: "manufacturer", label: "Gyártó / márka" },
  { key: "indoorModel", label: "Beltéri egység pontos típusa" },
  { key: "outdoorModel", label: "Kültéri egység pontos típusa" },
  { key: "nominalElectricalKw", label: "Névleges villamos teljesítményfelvétel (kW)" },
  { key: "heatingCapacityKw", label: "Névleges fűtési teljesítmény (kW)" },
  { key: "scop", label: "SCOP, átlagos éghajlat" },
  { key: "systemType", label: "Működési rendszer", options: [["air-air", "Levegő–levegő"], ["air-water", "Levegő–víz"], ["ground-air", "Talaj–levegő"], ["ground-water", "Talaj–víz"], ["water-air", "Víz–levegő"], ["water-water", "Víz–víz"]] },
];
export const H_TARIFF_EON_DEVICE_FIELDS: readonly HTariffDeviceField[] = [
  { key: "phaseCount", label: "Villamos csatlakozás", options: [["1", "1 fázis"], ["3", "3 fázis"]] },
  { key: "startCurrentReduction", label: "Indítási áram mérséklése", options: [["inverter", "Inverter"], ["soft-starter", "Lágyindító"], ["none", "Nincs"]] },
  { key: "nominalCurrentA", label: "Névleges üzemi áramerősség (A)" },
  { key: "maximumCurrentA", label: "Maximális áramerősség (A)" },
  { key: "recommendedFuse", label: "Gyártó által javasolt biztosító (A, karakterisztika)" },
  { key: "supplementaryHeaterKw", label: "Kiegészítő villamos fűtés (kW; ha nincs: 0)" },
  { key: "supplementaryHeaterSeparable", label: "A kiegészítő fűtés különválasztható?", optional: true, options: [["yes", "Igen"], ["no", "Nem"]] },
  { key: "supplementaryHeaterSharePercent", label: "Nem különválasztható kiegészítő fűtés éves részaránya (%)", optional: true },
  { key: "systemUsage", label: "Rendszer felhasználása", options: [["heating", "Fűtés"], ["heating-cooling", "Fűtés és hűtés"], ["heating-dhw", "Fűtés és használati meleg víz"], ["heating-cooling-dhw", "Fűtés, hűtés és használati meleg víz"]] },
  { key: "heatSource", label: "Hőforrás", options: [["air", "Levegő"], ["ground-probe", "Talajszonda"], ["ground-collector", "Talajkollektor"], ["well", "Vízkút"]] },
];
export const H_TARIFF_MVM_DEVICE_FIELDS: readonly HTariffDeviceField[] = [
  { key: "heatingSeasonKwh", label: "Becsült fogyasztás a fűtési időszakban (kWh)" },
  { key: "summerSeasonKwh", label: "Becsült fogyasztás a nyári időszakban (kWh)" },
];
export const H_TARIFF_EMASZ_DEVICE_FIELDS: readonly HTariffDeviceField[] = [
  { key: "manufacturer", label: "Gyártó / márka" },
  { key: "indoorModel", label: "Beltéri egység pontos típusa" },
  { key: "outdoorModel", label: "Kültéri egység pontos típusa" },
  { key: "indoorSerial", label: "Beltéri egység teljes gyári száma (S/N)" },
  { key: "outdoorSerial", label: "Kültéri egység teljes gyári száma (S/N)" },
];

export function hTariffDeviceFields(provider: HTariffData["provider"]) {
  if (provider === "mvm-emasz") return [...H_TARIFF_EMASZ_DEVICE_FIELDS];
  return [...H_TARIFF_COMMON_DEVICE_FIELDS, ...(provider === "eon" ? H_TARIFF_EON_DEVICE_FIELDS : provider === "mvm-demasz" ? H_TARIFF_MVM_DEVICE_FIELDS : [])];
}

export function normalizeHTariffData(value: unknown): HTariffData {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fields = Object.fromEntries(H_TARIFF_DATA_FIELDS.map((key) => [key, typeof source[key] === "string" ? source[key].trim().slice(0, key === "notes" ? 1000 : 250) : ""])) as Record<HTariffDataField, string>;
  const provider = source.provider === "eon" || source.provider === "mvm-demasz" || source.provider === "mvm-emasz" ? source.provider : "";
  return { ...fields, provider };
}

export function defaultHTariffData(customer: Customer, settings: WorkspaceSettings): HTariffData {
  return normalizeHTariffData({
    applicantName: customer.name, postalCode: customer.postalCode,
    installationAddress: customer.workAddress || fullCustomerAddress(customer),
    location: customer.city, date: new Date().toLocaleDateString("sv-SE"),
    installerName: settings.companyProfile.legalName,
    installerAddress: settings.companyProfile.address,
    installerPhone: settings.companyProfile.phone,
    installerEmail: settings.companyProfile.email,
  });
}

export function hTariffNumber(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(raw)) return null;
  const number = Number(raw.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

export function hTariffModel(data: DeviceTechnicalData) {
  return [data.indoorModel?.trim(), data.outdoorModel?.trim()].filter(Boolean).join(" / ");
}

export function validateHTariff(data: HTariffData, devices: AppointmentDevice[], scope?: WorkPhotoContext): HTariffIssue[] {
  const issues: HTariffIssue[] = [];
  const require = (field: HTariffDataField, label: string) => { if (!data[field]?.trim()) issues.push({ field, label }); };
  if (!data.provider) issues.push({ field: "provider", label: "Válaszd ki az áramszolgáltatói elosztót." });
  require("applicantName", "Igénybejelentő neve");
  if (data.provider === "eon") {
    if (!/^HU000[A-Z0-9]{28}$/i.test(data.meteringPointIdentifier.replace(/\s/g, ""))) issues.push({ field: "meteringPointIdentifier", label: "33 karakteres mérési pont azonosító (HU000…)" });
    for (const role of ["installer", "electrician"] as const) {
      for (const [part, label] of [["Name", "neve"], ["Address", "címe"], ["Phone", "telefonszáma"], ["Email", "email címe"]] as const) require(`${role}${part}`, `${role === "installer" ? "Kivitelező" : "Regisztrált villanyszerelő"} ${label}`);
    }
  } else if (data.provider === "mvm-demasz") {
    require("installationAddress", "Felhasználási hely címe");
    if (!/^\d{4}$/.test(data.postalCode)) issues.push({ field: "postalCode", label: "Négyjegyű irányítószám" });
    if (!/^10\d{8}$/.test(data.customerIdentifier.replace(/\s/g, ""))) issues.push({ field: "customerIdentifier", label: "10 jegyű felhasználó azonosító (10…)" });
    if (!/^04\d{8}$/.test(data.consumptionPlaceIdentifier.replace(/\s/g, ""))) issues.push({ field: "consumptionPlaceIdentifier", label: "10 jegyű fogyasztási hely azonosító (04…)" });
    if (!(Number(hTariffNumber(data.totalSimultaneousElectricalKw)) > 0)) issues.push({ field: "totalSimultaneousElectricalKw", label: "Teljes egyidejű villamos teljesítmény (pozitív kW)" });
    require("location", "Keltezés helye");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || Number.isNaN(Date.parse(`${data.date}T12:00:00Z`)) || new Date(`${data.date}T12:00:00Z`).toISOString().slice(0, 10) !== data.date) issues.push({ field: "date", label: "Érvényes keltezési dátum" });
  } else if (data.provider === "mvm-emasz") {
    require("installationAddress", "A telepítés teljes címe, irányítószámmal");
    require("emaszConsumptionPlaceIdentifier", "Émász felhasználási hely azonosító");
    require("installerName", "F-gázos kivitelező neve");
    require("installerFgasIdentifier", "F-gáz ügyfélazonosító (NKH)");
    require("installerPhone", "F-gázos kivitelező telefonszáma");
    require("installerEmail", "F-gázos kivitelező email címe");
    require("location", "Keltezés helye");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || Number.isNaN(Date.parse(`${data.date}T12:00:00Z`)) || new Date(`${data.date}T12:00:00Z`).toISOString().slice(0, 10) !== data.date) issues.push({ field: "date", label: "Érvényes keltezési dátum" });
  }
  if (!devices.length) issues.push({ label: "Legalább egy elmentett készülék szükséges." });
  if (devices.length > 100) issues.push({ label: "Egy dokumentum legfeljebb 100 készüléket tartalmazhat." });
  const seen = new Set<string>();
  for (const device of devices) {
    const deviceId = device.id;
    if (!deviceId || seen.has(deviceId) || (scope && (device.workspaceId !== scope.workspaceId || device.customerId !== scope.customerId || device.appointmentId !== scope.appointmentId))) issues.push({ deviceId, label: "A készülék nem egyértelműen ehhez a telepítéshez tartozik." });
    seen.add(deviceId);
    for (const field of hTariffDeviceFields(data.provider)) {
      const value = device.data[field.key]?.trim() || "";
      if (field.optional) continue;
      if (!value || (field.options && !field.options.some(([key]) => key === value))) issues.push({ deviceId, deviceField: field.key, label: field.label });
    }
    for (const key of (data.provider === "mvm-emasz" ? [] : ["nominalElectricalKw", "heatingCapacityKw", "scop", ...(data.provider === "eon" ? ["nominalCurrentA", "maximumCurrentA"] : [])]) as DeviceDataField[]) {
      if (!device.data[key]?.trim()) continue;
      const value = hTariffNumber(device.data[key]);
      if (value === null || value <= 0) issues.push({ deviceId, deviceField: key, label: `${hTariffDeviceFields(data.provider).find((f) => f.key === key)?.label || key}: pozitív szám szükséges.` });
    }
    if (data.provider !== "mvm-emasz" && hTariffNumber(device.data.scop) !== null && Number(hTariffNumber(device.data.scop)) < 3.4) issues.push({ deviceId, deviceField: "scop", label: "A nyomtatvány legalább 3,4 SCOP értéket ír elő. Ellenőrizd a gyártói adatlapot." });
    for (const key of (data.provider === "mvm-demasz" ? ["heatingSeasonKwh", "summerSeasonKwh"] : data.provider === "eon" ? ["supplementaryHeaterKw"] : []) as DeviceDataField[]) {
      if (!device.data[key]?.trim()) continue;
      const value = hTariffNumber(device.data[key]);
      if (value === null || value < 0) issues.push({ deviceId, deviceField: key, label: `${hTariffDeviceFields(data.provider).find((f) => f.key === key)?.label || key}: nulla vagy pozitív szám szükséges.` });
    }
    if (data.provider === "eon") {
      const source = device.data.heatSource;
      const system = device.data.systemType;
      if ((system?.startsWith("air-") && source !== "air") || (system?.startsWith("water-") && source !== "well") || (system?.startsWith("ground-") && source !== "ground-probe" && source !== "ground-collector")) issues.push({ deviceId, deviceField: "heatSource", label: "A hőforrás és a működési rendszer eltér egymástól." });
      if (Number(hTariffNumber(device.data.supplementaryHeaterKw)) > 0) {
        if (!["yes", "no"].includes(device.data.supplementaryHeaterSeparable || "")) issues.push({ deviceId, deviceField: "supplementaryHeaterSeparable", label: "Válaszd ki, hogy a kiegészítő fűtés különválasztható-e." });
        if (device.data.supplementaryHeaterSeparable === "no") {
          const share = hTariffNumber(device.data.supplementaryHeaterSharePercent);
          if (share === null || share < 0 || share > 100) issues.push({ deviceId, deviceField: "supplementaryHeaterSharePercent", label: "A kiegészítő fűtés részaránya 0–100% lehet." });
        }
      }
    }
    if (data.provider === "mvm-emasz") {
      const serial = (value: string | undefined) => value?.normalize("NFKC").replace(/\s/g, "").toUpperCase() || "";
      const outdoorSerial = serial(device.data.outdoorSerial);
      if (outdoorSerial && devices.some((other) => other !== device && serial(other.data.outdoorSerial) === outdoorSerial)) {
        issues.push({ deviceId, deviceField: "outdoorSerial", label: "Több készülékhez azonos kültéri gyári szám tartozik. Ellenőrizd az adatokat; közös kültéri egységű multi rendszerhez az Émász nyilatkozatot külön, az összes beltéri egységgel kell kitölteni. Ehhez a rendszerhez itt nem készíthető PDF." });
      }
    }
  }
  return issues.filter((issue, index) => issues.findIndex((other) => other.field === issue.field && other.deviceId === issue.deviceId && other.deviceField === issue.deviceField && other.label === issue.label) === index);
}

/** E.ON groups identical systems; differing technical values must never be collapsed. */
export function hTariffDeviceGroups(provider: HTariffProvider, devices: AppointmentDevice[]): AppointmentDevice[][] {
  if (provider !== "eon") return devices.map((device) => [device]);
  const groups = new Map<string, AppointmentDevice[]>();
  const fields = hTariffDeviceFields(provider).map((field) => field.key);
  for (const device of devices) {
    const key = JSON.stringify(fields.map((field) => device.data[field]?.trim() || ""));
    groups.set(key, [...(groups.get(key) || []), device]);
  }
  return [...groups.values()];
}
