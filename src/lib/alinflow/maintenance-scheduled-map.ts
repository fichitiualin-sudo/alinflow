import type { Customer, MaintenanceDeviceSelection } from "./types";
import { normalizeAppointmentType } from "./appointments";
import { maintenanceDeviceKey, maintenanceSelectionFor, selectedMaintenanceDevices } from "./maintenance-devices";
import { maintenanceDeviceSchedule, type MaintenanceMapPoint } from "./maintenance-map";

/** Pending shared visits are deliberately separate from completed history. */
export type SharedMaintenanceSchedule = {
  installationId: string;
  sourceWorkspaceId: string;
  sourceInstallationId: string;
  maintenanceAppointmentId: string;
  date: string;
  time?: string;
  selectedDevices?: MaintenanceDeviceSelection[] | null;
  providerName?: string;
};

type Schedule = Pick<SharedMaintenanceSchedule, "maintenanceAppointmentId" | "date" | "time" | "selectedDevices">;

function validSchedule(value: Schedule): boolean {
  if (!value.maintenanceAppointmentId?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value.time || "")) return false;
  const date = new Date(`${value.date}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.date;
}

/** Apply last, after shared completed history and contact preferences. A booking
 * changes only display status; it never advances a service date or counter. */
export function applyScheduledMaintenance(
  points: MaintenanceMapPoint[],
  workCustomers: Customer[],
  sharedSchedules: SharedMaintenanceSchedule[] = [],
): MaintenanceMapPoint[] {
  const localByInstallation = new Map<string, { customerId: string; schedule: Schedule }[]>();
  for (const work of workCustomers) {
    if (normalizeAppointmentType(work.appointmentType) !== "maintenance"
      || work.status !== "Időpont foglalva" || work.appointmentCancelledAt
      || !work.activeAppointmentId || !work.date) continue;
    for (const installationId of work.maintenanceInstallationIds || []) {
      const schedule: Schedule = { maintenanceAppointmentId: work.activeAppointmentId,
        date: work.date, time: work.time, selectedDevices: maintenanceSelectionFor(work, installationId) };
      if (!validSchedule(schedule)) continue;
      const rows = localByInstallation.get(installationId) || [];
      rows.push({ customerId: work.id, schedule });
      localByInstallation.set(installationId, rows);
    }
  }
  const validShared = sharedSchedules.filter(validSchedule);

  return points.map(point => {
    if (point.status === "optOut" || point.maintenanceDeviceDataInvalid) return point;
    const schedules = (localByInstallation.get(point.appointmentId) || [])
      .filter(row => row.customerId === point.customerId).map(row => row.schedule);
    for (const row of validShared) {
      // Unaccepted mirrors have a synthetic appointment ID. Accepted mirrors
      // and source installations use the local ID returned by the guarded RPC.
      const shared = point.sharedMaintenance;
      const matches = shared
        ? row.sourceWorkspaceId === shared.sourceWorkspaceId && row.sourceInstallationId === shared.installationId
        : row.installationId === point.appointmentId;
      if (matches) schedules.push(row);
    }
    schedules.sort((a, b) => a.date.localeCompare(b.date) || a.time!.localeCompare(b.time!));
    if (!schedules.length) return point;

    const resolved = schedules.flatMap(schedule => {
      try {
        const devices = selectedMaintenanceDevices(point.customer.quoteItems, schedule.selectedDevices);
        return [{ schedule, keys: new Set(devices.map(maintenanceDeviceKey)) }];
      } catch { return []; } // Malformed partial selections must never expand to all devices.
    });
    const devices = point.maintenanceDevices || [];
    if (!devices.length) {
      const next = resolved.find(({ schedule }) => schedule.selectedDevices == null
        && (!point.lastMaintenanceDate || schedule.date > point.lastMaintenanceDate))?.schedule;
      return next ? { ...point, status: "scheduled", scheduledMaintenanceDate: next.date,
        scheduledMaintenanceTime: next.time!.slice(0, 5) } : point;
    }
    const maintenanceDevices = devices.map(device => {
      if (device.status === "optOut") return device;
      const next = resolved.find(({ schedule, keys }) => keys.has(maintenanceDeviceKey(device))
        && (!device.lastMaintenanceDate || schedule.date > device.lastMaintenanceDate))?.schedule;
      return next ? { ...device, status: "scheduled" as const, scheduledMaintenanceDate: next.date,
        scheduledMaintenanceTime: next.time!.slice(0, 5) } : device;
    });
    const first = maintenanceDevices.filter(device => device.status === "scheduled")
      .sort((a, b) => a.scheduledMaintenanceDate!.localeCompare(b.scheduledMaintenanceDate!)
        || a.scheduledMaintenanceTime!.localeCompare(b.scheduledMaintenanceTime!))[0];
    if (!first) return point;
    return { ...point, maintenanceDevices, status: maintenanceDeviceSchedule(maintenanceDevices).status,
      scheduledMaintenanceDate: first.scheduledMaintenanceDate, scheduledMaintenanceTime: first.scheduledMaintenanceTime };
  });
}
