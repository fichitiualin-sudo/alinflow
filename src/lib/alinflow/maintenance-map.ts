import type { Customer, MaintenanceDeviceSelection, QuoteItem } from "./types";
import { maintenanceDeviceKey, maintenanceDeviceMatches, maintenanceDeviceSlots, maintenanceSelectionFor } from "./maintenance-devices";
import { appointmentSummaryLabel, appointmentTimeRangeLabel, isInstallationAppointment, normalizeAppointmentType } from "./appointments";
import { displayAddress } from "./format";
import { cleanQuoteItems, climateQuoteItems, climateSummary } from "./products";
import type { SharedMaintenanceInstallation } from "./shared-maintenance";
import type { MaintenanceContactPreference } from "./maintenance-contact-choice";

export type MaintenanceMapStatus = "ok" | "dueSoon" | "overdue" | "optOut" | "originalInstaller" | "unknown";
export type MaintenanceMapVisibility = { own: boolean; external: boolean };

export type MaintenanceMapPoint = {
  sharedMaintenance?: SharedMaintenanceInstallation;
  maintenanceContactPreference?: MaintenanceContactPreference;
  originalInstallerAvailable?: boolean;
  maintenanceProviderName?: string;
  appointmentId: string;
  customer: Customer;
  customerId: string;
  customerName: string;
  climateSummary: string;
  address: string;
  city: string;
  installationDate?: string;
  installationTime?: string;
  installationLabel: string;
  lastMaintenanceDate?: string;
  nextMaintenanceDue?: string;
  maintenanceCount: number;
  maintenanceDevices?: MaintenanceDeviceHistory[];
  maintenanceDeviceDataInvalid?: boolean;
  maintenanceOrigin: "own" | "external";
  maintenanceSourceName?: string;
  status: MaintenanceMapStatus;
  latitude?: number;
  longitude?: number;
  geocodeStatus?: Customer["mapGeocodeStatus"];
  geocodeError?: string;
};

export type MaintenanceMapPointGroup = {
  id: string;
  latitude: number;
  longitude: number;
  status: MaintenanceMapStatus;
  points: MaintenanceMapPoint[];
};

export const MAINTENANCE_DUE_SOON_DAYS = 60;

export function normalizeMaintenanceMapVisibility(value: unknown): MaintenanceMapVisibility {
  const saved = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    own: typeof saved.own === "boolean" ? saved.own : true,
    external: typeof saved.external === "boolean" ? saved.external : true,
  };
}

function normalizeSearch(value?: string) {
  return String(value || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

export function filterMaintenanceMapPoints(points: readonly MaintenanceMapPoint[], {
  visibility, search = "", status = "all",
}: {
  visibility: MaintenanceMapVisibility;
  search?: string;
  status?: MaintenanceMapStatus | "all";
}) {
  const query = normalizeSearch(search);
  return points.filter((point) => {
    const origin = point.maintenanceOrigin === "external" ? "external" : "own";
    const matchesStatus = status === "all" || (status === "originalInstaller"
      ? point.status === "originalInstaller" || point.maintenanceContactPreference?.choice === "original_installer"
      : point.status === status);
    if (!visibility[origin] || !matchesStatus) return false;
    return !query || normalizeSearch([
      point.customerName, point.climateSummary, point.address, point.city,
      origin === "external" ? point.maintenanceSourceName : "",
    ].join(" ")).includes(query);
  });
}

export function maintenanceMapOriginLabel(point: MaintenanceMapPoint) {
  if (point.maintenanceOrigin !== "external") return "Saját telepítés";
  const source = point.maintenanceSourceName?.trim();
  return `Karbantartásra átvett${source ? ` · ${source}` : ""}`;
}

export function hasMaintenanceMapCoordinates(
  point: MaintenanceMapPoint,
): point is MaintenanceMapPoint & { latitude: number; longitude: number } {
  return typeof point.latitude === "number"
    && Number.isFinite(point.latitude)
    && point.latitude >= -90
    && point.latitude <= 90
    && typeof point.longitude === "number"
    && Number.isFinite(point.longitude)
    && point.longitude >= -180
    && point.longitude <= 180;
}

export function groupMaintenanceMapPoints(points: readonly MaintenanceMapPoint[]): MaintenanceMapPointGroup[] {
  const groups = new Map<string, MaintenanceMapPointGroup>();
  const statusPriority: Record<MaintenanceMapStatus, number> = {
    overdue: 0, dueSoon: 1, unknown: 2, ok: 3, originalInstaller: 4, optOut: 5,
  };

  for (const point of points) {
    if (!hasMaintenanceMapCoordinates(point)) continue;
    const id = `coordinates:${point.latitude},${point.longitude}`;
    const group = groups.get(id);
    if (group) {
      group.points.push(point);
      if (statusPriority[point.status] < statusPriority[group.status]) group.status = point.status;
    } else {
      groups.set(id, {
        id,
        latitude: point.latitude,
        longitude: point.longitude,
        status: point.status,
        points: [point],
      });
    }
  }

  return Array.from(groups.values());
}

function parseIsoDate(value?: string) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addYears(value: string, years: number) {
  const date = parseIsoDate(value);
  if (!date) return undefined;
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return toIsoDate(next);
}

function daysUntil(value?: string) {
  const target = parseIsoDate(value);
  if (!target) return undefined;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.ceil((target.getTime() - start.getTime()) / 86400000);
}

function latestDate(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(parseIsoDate(value)))
    .sort((a, b) => b.localeCompare(a))[0];
}

function dateStatus(nextMaintenanceDue?: string): MaintenanceMapStatus {
  const days = daysUntil(nextMaintenanceDue);
  if (days === undefined) return "unknown";
  if (days < 0) return "overdue";
  if (days <= MAINTENANCE_DUE_SOON_DAYS) return "dueSoon";
  return "ok";
}

export function maintenanceMapSchedule(baselineDate?: string) {
  const nextMaintenanceDue = baselineDate ? addYears(baselineDate, 1) : undefined;
  return { nextMaintenanceDue, status: dateStatus(nextMaintenanceDue) };
}

export type MaintenanceDeviceEvent = {
  date?: string;
  selectedDevices?: MaintenanceDeviceSelection[] | null;
  providerName?: string | null;
};
export type MaintenanceDeviceHistory = MaintenanceDeviceSelection & {
  lastMaintenanceDate?: string;
  nextMaintenanceDue?: string;
  maintenanceCount: number;
  providerName?: string;
  status: MaintenanceMapStatus;
};

/** A partial visit advances only its selected physical devices, including when
 * two visits service different units of the same model. Missing selection is
 * the historical whole-installation contract, never an empty selection. */
export function buildMaintenanceDeviceHistory(items: QuoteItem[], installationDate: string | undefined, events: MaintenanceDeviceEvent[]) {
  const today = toIsoDate(new Date());
  return maintenanceDeviceSlots(items).map((slot): MaintenanceDeviceHistory => {
    const completed = events.filter(event => event.date && parseIsoDate(event.date)
      && event.date <= today && maintenanceDeviceMatches(slot, event.selectedDevices))
      .sort((a, b) => b.date!.localeCompare(a.date!));
    const lastMaintenanceDate = completed[0]?.date;
    return { ...slot, lastMaintenanceDate, maintenanceCount: completed.length,
      providerName: completed[0]?.providerName || undefined,
      ...maintenanceMapSchedule(lastMaintenanceDate || installationDate) };
  });
}

/** Old malformed import rows must not crash the whole map. Saving remains
 * strict; a read failure is unknown, never inferred whole-installation service. */
export function readMaintenanceDeviceHistory(items: QuoteItem[], installationDate: string | undefined, events: MaintenanceDeviceEvent[]) {
  try { return { devices: buildMaintenanceDeviceHistory(items, installationDate, events), invalid: false }; }
  catch { return { devices: [] as MaintenanceDeviceHistory[], invalid: true }; }
}

export function mergeMaintenanceDeviceHistory(current: MaintenanceDeviceHistory[], incoming: MaintenanceDeviceHistory[]) {
  const byKey = new Map(incoming.map(device => [maintenanceDeviceKey(device), device]));
  return current.map(device => {
    const other = byKey.get(maintenanceDeviceKey(device));
    if (!other) return device;
    const newer = (other.lastMaintenanceDate || "") > (device.lastMaintenanceDate || "") ? other : device;
    return { ...newer, productName: device.productName, unitNumber: device.unitNumber,
      maintenanceCount: device.maintenanceCount + other.maintenanceCount };
  });
}

export function maintenanceDeviceSchedule(devices: MaintenanceDeviceHistory[], fallbackDate?: string) {
  if (!devices.length) return maintenanceMapSchedule(fallbackDate);
  const priority: Record<MaintenanceMapStatus, number> = { overdue: 0, dueSoon: 1, unknown: 2, ok: 3, optOut: 4, originalInstaller: 5 };
  const next = [...devices].sort((a, b) => priority[a.status] - priority[b.status]
    || String(a.nextMaintenanceDue || "").localeCompare(String(b.nextMaintenanceDue || "")))[0];
  return { status: next.status, nextMaintenanceDue: next.nextMaintenanceDue };
}

export function maintenanceDeviceSummary(devices?: MaintenanceDeviceHistory[]) {
  if (!devices || devices.length < 2) return "";
  const ready = devices.filter(device => device.status === "ok").length;
  const due = devices.filter(device => device.status === "overdue").length;
  const soon = devices.filter(device => device.status === "dueSoon").length;
  const unknown = devices.filter(device => device.status === "unknown").length;
  const declined = devices.filter(device => device.status === "optOut").length;
  return [`Rendben: ${ready} / ${devices.length} klíma`, due ? `Esedékes: ${due}` : "",
    soon ? `Hamarosan: ${soon}` : "", declined ? `Nem kéri: ${declined}` : "", unknown ? `Nincs adat: ${unknown}` : ""].filter(Boolean).join(" · ");
}

function uniqueByAppointment(customers: Customer[]) {
  const byAppointment = new Map<string, Customer>();
  customers.forEach((customer) => {
    const key = customer.activeAppointmentId || `customer:${customer.id}`;
    if (!byAppointment.has(key)) byAppointment.set(key, customer);
  });
  return Array.from(byAppointment.values());
}

function pointAddress(customer: Customer) {
  return displayAddress({ ...customer, address: customer.workAddress || customer.address });
}

export function formatMapDate(value?: string) {
  return value ? value.replaceAll("-", ".") : "nincs adat";
}

export function maintenanceMapStatusLabel(status: MaintenanceMapStatus) {
  if (status === "originalInstaller") return "Az eredeti szerelőtől kéri";
  if (status === "optOut") return "Nem kéri";
  if (status === "overdue") return "Esedékes / elmaradt";
  if (status === "dueSoon") return "Hamarosan esedékes";
  if (status === "ok") return "Rendben";
  return "Nincs karbantartási adat";
}

export function maintenanceMapStatusColor(status: MaintenanceMapStatus) {
  if (status === "originalInstaller") return "#8b5cf6";
  if (status === "optOut") return "#6b7280";
  if (status === "overdue") return "#ef4444";
  if (status === "dueSoon") return "#f59e0b";
  if (status === "ok") return "#22c55e";
  return "#64748b";
}

export function maintenanceMapStatusClass(status: MaintenanceMapStatus) {
  if (status === "originalInstaller") return "border-violet-300/30 bg-violet-400/15 text-violet-200";
  if (status === "optOut") return "border-zinc-300/30 bg-zinc-500/25 text-zinc-100";
  if (status === "overdue") return "border-red-300/30 bg-red-500/20 text-red-100";
  if (status === "dueSoon") return "border-amber-300/30 bg-amber-300/20 text-amber-100";
  if (status === "ok") return "border-emerald-300/30 bg-emerald-400/20 text-emerald-100";
  return "border-slate-300/30 bg-slate-500/20 text-slate-100";
}

export function buildMaintenanceMapPoints(workCustomers: Customer[]) {
  const uniqueWorks = uniqueByAppointment(workCustomers);
  const installationWorks = uniqueWorks
    .filter((customer) => customer.activeAppointmentId)
    .filter((customer) => isInstallationAppointment(customer.appointmentType))
    .filter((customer) => !cleanQuoteItems(customer.quoteItems).length || climateQuoteItems(customer.quoteItems).length > 0)
    .filter((customer) => customer.status !== "Lemondva");
  const maintenanceWorks = uniqueWorks
    .filter((customer) => normalizeAppointmentType(customer.appointmentType) === "maintenance")
    .filter((customer) => customer.status === "Lezárva")
    .filter((customer) => customer.date && customer.date <= toIsoDate(new Date()));

  const maintenanceByInstallation = new Map<string, Customer[]>();
  maintenanceWorks.forEach((maintenance) => {
    (maintenance.maintenanceInstallationIds || []).forEach((appointmentId) => {
      const current = maintenanceByInstallation.get(appointmentId) || [];
      maintenanceByInstallation.set(appointmentId, [...current, maintenance]);
    });
  });

  return installationWorks
    .map((installation): MaintenanceMapPoint | null => {
      const appointmentId = installation.activeAppointmentId;
      if (!appointmentId) return null;

      const maintenances = maintenanceByInstallation.get(appointmentId) || [];
      const lastMaintenanceDate = latestDate(maintenances.map((maintenance) => maintenance.date));
      const deviceHistory = readMaintenanceDeviceHistory(installation.quoteItems, installation.date,
        maintenances.map(maintenance => ({ date: maintenance.date, selectedDevices: maintenanceSelectionFor(maintenance, appointmentId) })));
      const maintenanceDevices = deviceHistory.devices;
      const schedule = deviceHistory.invalid ? maintenanceMapSchedule() : maintenanceDeviceSchedule(maintenanceDevices, lastMaintenanceDate || installation.date);
      const status: MaintenanceMapStatus = installation.maintenanceOptOut ? "optOut" : schedule.status;
      const address = pointAddress(installation);
      const customerForMap = { ...installation, address: installation.workAddress || installation.address };

      return {
        appointmentId,
        customer: customerForMap,
        customerId: installation.id,
        customerName: installation.name || "Névtelen ügyfél",
        climateSummary: climateSummary(installation.quoteItems),
        address,
        city: installation.city,
        installationDate: installation.date,
        installationTime: installation.time,
        installationLabel: appointmentSummaryLabel(installation) || appointmentTimeRangeLabel(installation),
        lastMaintenanceDate,
        nextMaintenanceDue: schedule.nextMaintenanceDue,
        maintenanceCount: maintenances.length,
        maintenanceDevices,
        maintenanceDeviceDataInvalid: deviceHistory.invalid,
        maintenanceOrigin: installation.maintenanceOrigin === "external" ? "external" : "own",
        maintenanceSourceName: installation.maintenanceOrigin === "external" ? installation.maintenanceSourceName?.trim() : undefined,
        status,
        latitude: installation.mapLatitude,
        longitude: installation.mapLongitude,
        geocodeStatus: installation.mapGeocodeStatus,
        geocodeError: installation.mapGeocodeError,
      };
    })
    .filter((point): point is MaintenanceMapPoint => Boolean(point))
    .sort((a, b) => {
      const statusPriority: Record<MaintenanceMapStatus, number> = { overdue: 0, dueSoon: 1, ok: 2, originalInstaller: 3, optOut: 4, unknown: 5 };
      const priorityDiff = statusPriority[a.status] - statusPriority[b.status];
      if (priorityDiff !== 0) return priorityDiff;
      return String(a.nextMaintenanceDue || "9999-99-99").localeCompare(String(b.nextMaintenanceDue || "9999-99-99"));
    });
}
