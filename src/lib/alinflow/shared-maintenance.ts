import type { Customer, MaintenanceDeviceSelection } from "./types";
import type { MaintenanceMapPoint } from "./maintenance-map";
import { readMaintenanceDeviceHistory, maintenanceDeviceSchedule, maintenanceMapSchedule, mergeMaintenanceDeviceHistory, type MaintenanceDeviceEvent } from "./maintenance-map";

export type MaintenanceAccessGrant = {
  id: string; sourceWorkspaceId: string; targetUserId: string; targetWorkspaceId: string;
  targetWorkspaceName: string; agreementReference: string; scope: "historical_installations";
  cutoffDate: string; createdAt: string; revokedAt: string | null;
};
export type SharedMaintenanceInstallation = {
  grantId: string; installationId: string; sourceWorkspaceId: string; sourceWorkspaceName: string;
  customer: { name: string; phone: string; email: string; postalCode: string; city: string; address: string };
  installationDate: string; installationTime: string;
  climates: Array<{ productName: string; quantity: number }>;
  latitude: number | null; longitude: number | null; lastMaintenanceDate: string | null; maintenanceCount: number;
  lastMaintenanceProviderName?: string | null;
  maintenanceHistory?: Array<MaintenanceDeviceEvent & { status?: string }>;
  maintenanceOptOut?: boolean; maintenanceOptOutAt?: string | null;
  targetCustomerId?: string | null; targetInstallationId?: string | null;
};
export type SharedMaintenanceOptOut = {
  maintenanceOptOut: boolean; maintenanceOptOutAt: string | null; targetInstallationId: string | null;
};
export type SharedMaintenanceResult = { installationId: string; date: string; providerName: string; status: string; selectedDevices?: MaintenanceDeviceSelection[] | null };

function sourceDeviceHistory(item: SharedMaintenanceInstallation, quoteItems: Customer["quoteItems"]) {
  const events = item.maintenanceHistory?.filter(event => !event.status || event.status === "Lezárva")
    ?? (item.lastMaintenanceDate ? [{ date: item.lastMaintenanceDate, providerName: item.lastMaintenanceProviderName || item.sourceWorkspaceName }] : []);
  return readMaintenanceDeviceHistory(quoteItems, item.installationDate, events);
}

/** This display-only object never enters customer persistence or ordinary customer actions. */
export function sharedMaintenanceMapPoint(item: SharedMaintenanceInstallation): MaintenanceMapPoint {
  const id = `shared:${item.grantId}:${item.installationId}`;
  const quoteItems = item.climates.map((climate, index) => ({ productId: `manual-${index}`, productName: climate.productName,
    customName: climate.productName, quantity: climate.quantity, isManual: true, customPrice: 0, customInstallPrice: 0 }));
  const customer: Customer = { ...item.customer, id, source: "Karbantartási megbízás", status: "Lezárva", need: "Karbantartás",
    date: item.installationDate, time: item.installationTime, appointmentType: "installation", quoteItems,
    maintenanceOrigin: "external", maintenanceSourceName: item.sourceWorkspaceName,
    maintenanceOptOut: item.maintenanceOptOut === true, maintenanceOptOutAt: item.maintenanceOptOutAt || undefined };
  const baseDate = item.lastMaintenanceDate || item.installationDate;
  const deviceHistory = sourceDeviceHistory(item, quoteItems);
  const maintenanceDevices = deviceHistory.devices;
  const schedule = deviceHistory.invalid ? maintenanceMapSchedule() : maintenanceDeviceSchedule(maintenanceDevices, baseDate);
  return { appointmentId: id, customer, customerId: id, customerName: item.customer.name,
    climateSummary: item.climates.map(c => `${c.quantity} db ${c.productName}`).join(" · "),
    address: [item.customer.postalCode, item.customer.city, item.customer.address].filter(Boolean).join(" "), city: item.customer.city,
    installationDate: item.installationDate, installationTime: item.installationTime, installationLabel: "Átvett telepítés",
    lastMaintenanceDate: item.lastMaintenanceDate || undefined, maintenanceCount: item.maintenanceCount,
    maintenanceDevices,
    maintenanceDeviceDataInvalid: deviceHistory.invalid,
    maintenanceProviderName: item.lastMaintenanceProviderName || undefined,
    maintenanceOrigin: "external", maintenanceSourceName: item.sourceWorkspaceName,
    ...schedule, status: item.maintenanceOptOut ? "optOut" : schedule.status,
    latitude: item.latitude ?? undefined, longitude: item.longitude ?? undefined,
    sharedMaintenance: item };
}

/** Keep one marker per accepted installation, retaining the source's permitted
 * maintenance summary alongside the recipient's own subsequent work history. */
export function mergeSharedMaintenancePoints(ownPoints: MaintenanceMapPoint[], received: SharedMaintenanceInstallation[]): MaintenanceMapPoint[] {
  const sourceByTargetInstallation = new Map(received
    .filter(item => item.targetInstallationId)
    .map(item => [item.targetInstallationId!, item]));
  const ownedIds = new Set(ownPoints.map(point => point.appointmentId));
  const merged = ownPoints.map(point => {
    const source = sourceByTargetInstallation.get(point.appointmentId);
    if (!source) return point;
    const ownLast = point.lastMaintenanceDate || "";
    const sourceLast = source.lastMaintenanceDate || "";
    const lastMaintenanceDate = [ownLast, sourceLast].sort().at(-1) || undefined;
    const sourceHistory = sourceDeviceHistory(source, point.customer.quoteItems || []);
    const maintenanceDevices = point.maintenanceDevices
      ? mergeMaintenanceDeviceHistory(point.maintenanceDevices, sourceHistory.devices) : undefined;
    const maintenanceDeviceDataInvalid = point.maintenanceDeviceDataInvalid || sourceHistory.invalid;
    const schedule = maintenanceDeviceDataInvalid ? maintenanceMapSchedule() : maintenanceDevices
      ? maintenanceDeviceSchedule(maintenanceDevices, point.installationDate || source.installationDate)
      : maintenanceMapSchedule(lastMaintenanceDate || point.installationDate || source.installationDate);
    return { ...point, originalInstallerAvailable: true, lastMaintenanceDate, maintenanceCount: point.maintenanceCount + source.maintenanceCount,
      maintenanceDevices,
      maintenanceDeviceDataInvalid,
      ...schedule, status: point.status === "optOut" ? point.status : schedule.status,
      maintenanceProviderName: sourceLast > ownLast ? source.lastMaintenanceProviderName || source.sourceWorkspaceName : point.maintenanceProviderName };
  });
  return [...merged, ...received.filter(item => !item.targetInstallationId || !ownedIds.has(item.targetInstallationId)).map(sharedMaintenanceMapPoint)];
}

export function applySharedMaintenanceResults(points: MaintenanceMapPoint[], results: SharedMaintenanceResult[]) {
  return points.map(point => {
    const completed = results.filter(result => result.installationId === point.appointmentId && result.status === "Lezárva" && result.date)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (!completed.length) return point;
    const latest = completed[0];
    const date = [point.lastMaintenanceDate || "", latest.date].sort().at(-1)!;
    const partnerHistory = point.maintenanceDevices
      ? readMaintenanceDeviceHistory(point.customer.quoteItems || [], point.installationDate, completed) : undefined;
    const maintenanceDevices = point.maintenanceDevices && partnerHistory
      ? mergeMaintenanceDeviceHistory(point.maintenanceDevices, partnerHistory.devices) : undefined;
    const maintenanceDeviceDataInvalid = point.maintenanceDeviceDataInvalid || partnerHistory?.invalid;
    const schedule = maintenanceDeviceDataInvalid ? maintenanceMapSchedule() : maintenanceDevices ? maintenanceDeviceSchedule(maintenanceDevices, point.installationDate) : maintenanceMapSchedule(date);
    return { ...point, lastMaintenanceDate: date, maintenanceCount: point.maintenanceCount + completed.length,
      maintenanceDevices,
      maintenanceDeviceDataInvalid,
      ...schedule, status: point.status === "optOut" ? point.status : schedule.status,
      maintenanceProviderName: latest.date >= (point.lastMaintenanceDate || "") ? latest.providerName : point.maintenanceProviderName };
  });
}
