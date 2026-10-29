import type { MaintenanceMapPoint } from "./maintenance-map";
import { maintenanceMapSchedule } from "./maintenance-map";

export type MaintenanceContactChoice = "open" | "original_installer" | "declined";

/** A read-only view of the choice shared by the original installation and its recipients. */
export type MaintenanceContactPreference = {
  installationId: string;
  sourceInstallationId: string;
  sourceWorkspaceId: string;
  sourceWorkspaceName: string;
  choice: MaintenanceContactChoice;
  updatedAt: string;
  isSource: boolean;
};

export function isMaintenanceContactPreference(value: unknown): value is MaintenanceContactPreference {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["installationId", "sourceInstallationId", "sourceWorkspaceId", "sourceWorkspaceName", "updatedAt"]
    .every(key => typeof row[key] === "string" && Boolean(row[key]))
    && ["open", "original_installer", "declined"].includes(String(row.choice))
    && typeof row.isSource === "boolean";
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
    if (!preference) return { ...point, originalInstallerAvailable };
    const schedule = maintenanceMapSchedule(point.lastMaintenanceDate || point.installationDate);
    return { ...point, originalInstallerAvailable, maintenanceContactPreference: preference,
      status: preference.choice === "declined" ? "optOut"
        : preference.choice === "original_installer" && !preference.isSource ? "originalInstaller" : schedule.status };
  });
}
