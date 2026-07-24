import type { Customer } from "./types";
import { appointmentSummaryLabel, appointmentTimeRangeLabel, isInstallationAppointment, normalizeAppointmentType } from "./appointments";
import { displayAddress } from "./format";
import { climateSummary } from "./products";

export type MaintenanceMapStatus = "ok" | "dueSoon" | "overdue" | "unknown";

export type MaintenanceMapPoint = {
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
  status: MaintenanceMapStatus;
  latitude?: number;
  longitude?: number;
  geocodeStatus?: Customer["mapGeocodeStatus"];
  geocodeError?: string;
};

export const MAINTENANCE_DUE_SOON_DAYS = 60;

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
  if (status === "overdue") return "Esedékes / elmaradt";
  if (status === "dueSoon") return "Hamarosan esedékes";
  if (status === "ok") return "Rendben";
  return "Nincs karbantartási adat";
}

export function maintenanceMapStatusColor(status: MaintenanceMapStatus) {
  if (status === "overdue") return "#ef4444";
  if (status === "dueSoon") return "#f59e0b";
  if (status === "ok") return "#22c55e";
  return "#64748b";
}

export function maintenanceMapStatusClass(status: MaintenanceMapStatus) {
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
    .filter((customer) => customer.status !== "Lemondva");
  const maintenanceWorks = uniqueWorks
    .filter((customer) => normalizeAppointmentType(customer.appointmentType) === "maintenance")
    .filter((customer) => customer.status !== "Lemondva");

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
      const baselineDate = lastMaintenanceDate || installation.date;
      const nextMaintenanceDue = baselineDate ? addYears(baselineDate, 1) : undefined;
      const status = dateStatus(nextMaintenanceDue);
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
        nextMaintenanceDue,
        maintenanceCount: maintenances.length,
        status,
        latitude: installation.mapLatitude,
        longitude: installation.mapLongitude,
        geocodeStatus: installation.mapGeocodeStatus,
        geocodeError: installation.mapGeocodeError,
      };
    })
    .filter((point): point is MaintenanceMapPoint => Boolean(point))
    .sort((a, b) => {
      const statusPriority: Record<MaintenanceMapStatus, number> = { overdue: 0, dueSoon: 1, unknown: 2, ok: 3 };
      const priorityDiff = statusPriority[a.status] - statusPriority[b.status];
      if (priorityDiff !== 0) return priorityDiff;
      return String(a.nextMaintenanceDue || "9999-99-99").localeCompare(String(b.nextMaintenanceDue || "9999-99-99"));
    });
}
