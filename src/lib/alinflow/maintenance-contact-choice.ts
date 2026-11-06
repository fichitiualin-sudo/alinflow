import type { MaintenanceMapPoint } from "./maintenance-map";
import { maintenanceDeviceSchedule, maintenanceMapSchedule } from "./maintenance-map";
import type { MaintenanceDeviceSelection, QuoteItem } from "./types";
import { maintenanceDeviceKey, maintenanceDeviceSlots } from "./maintenance-devices";

export type MaintenanceContactChoice = "open" | "original_installer" | "declined";
export type MaintenanceDeviceDeclinedDate = MaintenanceDeviceSelection & { declinedAt: string };

/** A read-only view of the choice shared by the original installation and its recipients. */
export type MaintenanceContactPreference = {
  installationId: string;
  sourceInstallationId: string;
  sourceWorkspaceId: string;
  sourceWorkspaceName: string;
  choice: MaintenanceContactChoice;
  updatedAt: string;
  isSource: boolean;
  /** Whole legacy refusal remains choice=declined; open may refuse only these units. */
  declinedDevices?: MaintenanceDeviceSelection[] | null;
  declinedAt?: string | null;
  declinedDeviceDates?: MaintenanceDeviceDeclinedDate[] | null;
};

function isRefusalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  return Boolean(match && Number.isFinite(Date.parse(value))
    && new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) === match[1]);
}

function isMaintenanceDeviceDeclinedDates(value: unknown): value is MaintenanceDeviceDeclinedDate[] {
  return Array.isArray(value) && value.length <= 1000
    && value.every(device => device && typeof device === "object" && !Array.isArray(device)
      && Object.keys(device).every(key => ["productName", "unitNumber", "declinedAt"].includes(key))
      && isRefusalTimestamp(device.declinedAt))
    && isMaintenanceDeviceSelectionList(value.map(({ productName, unitNumber }) => ({ productName, unitNumber })));
}

export function isMaintenanceDeviceSelectionList(value: unknown): value is MaintenanceDeviceSelection[] {
  if (!Array.isArray(value) || value.length > 1000) return false;
  const keys = new Set<string>();
  return value.every(device => {
    if (!device || typeof device !== "object" || Array.isArray(device)
      || Object.keys(device).some(key => key !== "productName" && key !== "unitNumber")
      || typeof device.productName !== "string" || !device.productName.trim()
      || device.productName.trim().length > 300 || !Number.isInteger(device.unitNumber) || device.unitNumber < 1 || device.unitNumber > 1000) return false;
    const key = maintenanceDeviceKey(device);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

export function isMaintenanceContactPreference(value: unknown): value is MaintenanceContactPreference {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["installationId", "sourceInstallationId", "sourceWorkspaceId", "sourceWorkspaceName", "updatedAt"]
    .every(key => typeof row[key] === "string" && Boolean(row[key]))
    && ["open", "original_installer", "declined"].includes(String(row.choice))
    && typeof row.isSource === "boolean"
    && (row.declinedDevices == null || isMaintenanceDeviceSelectionList(row.declinedDevices))
    && (row.declinedAt == null || isRefusalTimestamp(row.declinedAt))
    && (row.declinedDeviceDates == null || isMaintenanceDeviceDeclinedDates(row.declinedDeviceDates));
}

export function preferenceDeclinesDevice(preference: MaintenanceContactPreference | undefined, device: MaintenanceDeviceSelection, legacyOptOut = false) {
  if (!preference) return legacyOptOut;
  return preference.choice === "declined"
    || Boolean(preference.declinedDevices?.some(declined => maintenanceDeviceKey(declined) === maintenanceDeviceKey(device)));
}

export function declinedMaintenanceDevices(items: QuoteItem[], preference?: MaintenanceContactPreference, legacyOptOut = false) {
  return maintenanceDeviceSlots(items).filter(device => preferenceDeclinesDevice(preference, device, legacyOptOut));
}

/** A preference's version is never evidence of when the refusal was made. */
export function maintenanceDeclinedAt(preference?: MaintenanceContactPreference, legacyOptOut = false, legacyOptOutAt?: string | null) {
  const value = preference ? (preference.choice === "declined" ? preference.declinedAt : undefined)
    : legacyOptOut ? legacyOptOutAt : undefined;
  return isRefusalTimestamp(value) ? value : undefined;
}

export function maintenanceDeviceDeclinedAt(preference: MaintenanceContactPreference | undefined, device: MaintenanceDeviceSelection,
  legacyOptOut = false, legacyOptOutAt?: string | null) {
  if (!preference) return maintenanceDeclinedAt(undefined, legacyOptOut, legacyOptOutAt);
  if (!preferenceDeclinesDevice(preference, device)) return undefined;
  // The last device can complete a whole refusal while earlier devices still
  // have unknown dates. The whole-installation timestamp cannot date those.
  const value = preference.declinedDeviceDates?.find(row => maintenanceDeviceKey(row) === maintenanceDeviceKey(device))?.declinedAt;
  return isRefusalTimestamp(value) ? value : undefined;
}

export function formatMaintenanceRefusalDate(value?: string | null) {
  if (!isRefusalTimestamp(value)) return "";
  const parts = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(entry => entry.type === type)?.value || "";
  return `${part("year")}.${part("month")}.${part("day")}. ${part("hour")}:${part("minute")}`;
}

export function applyMaintenanceContactPreferences(points: MaintenanceMapPoint[], preferences: MaintenanceContactPreference[]): MaintenanceMapPoint[] {
  const byInstallation = new Map(preferences.map(preference => [preference.installationId, preference]));
  const bySource = new Map(preferences.filter(preference => !preference.isSource)
    .map(preference => [`${preference.sourceWorkspaceId}:${preference.sourceInstallationId}`, preference]));
  return points.map(point => {
    const preference = point.sharedMaintenance
      ? bySource.get(`${point.sharedMaintenance.sourceWorkspaceId}:${point.sharedMaintenance.installationId}`)
      : byInstallation.get(point.appointmentId);
    const originalInstallerAvailable = Boolean(point.originalInstallerAvailable || point.sharedMaintenance || point.maintenanceOrigin === "own");
    const legacyOptOut = point.status === "optOut" || Boolean(point.customer?.maintenanceOptOut);
    const declined = preference ? preference.choice === "declined" : legacyOptOut;
    const maintenanceDevices = point.maintenanceDevices?.map(device => ({ ...device,
      status: preferenceDeclinesDevice(preference, device, legacyOptOut) ? "optOut" as const
        : maintenanceMapSchedule(device.lastMaintenanceDate || point.installationDate).status,
    }));
    const schedule = point.maintenanceDeviceDataInvalid ? maintenanceMapSchedule()
      : maintenanceDevices ? maintenanceDeviceSchedule(maintenanceDevices, point.lastMaintenanceDate || point.installationDate)
      : maintenanceMapSchedule(point.lastMaintenanceDate || point.installationDate);
    return { ...point, originalInstallerAvailable, maintenanceContactPreference: preference,
      maintenanceDevices, nextMaintenanceDue: declined ? point.nextMaintenanceDue : schedule.nextMaintenanceDue,
      status: declined ? "optOut" : schedule.status };
  });
}
