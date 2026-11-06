import type { Customer, MaintenanceDeviceSelection, QuoteItem } from "./types";
import { isInstallationAppointment } from "./appointments";
import { maintenanceDeviceKey, maintenanceDeviceSlots, maintenanceSelectionFor, selectedMaintenanceDevices } from "./maintenance-devices";

export type SavedMaintenanceDeviceLink = {
  installation_appointment_id: string;
  selected_devices?: MaintenanceDeviceSelection[] | null;
};

const CONSISTENCY_MESSAGE = "A klímák kiválasztása nem egyezik a mentett időponttal. Mentsd újra a karbantartási időpontot.";

function sameKeys(left: Set<string>, right: Set<string>) {
  return left.size === right.size && Array.from(left).every(key => right.has(key));
}

function modelQuantities(devices: MaintenanceDeviceSelection[]) {
  const counts = new Map<string, number>();
  for (const device of devices) {
    const model = device.productName.trim().toLocaleLowerCase("hu-HU");
    counts.set(model, (counts.get(model) || 0) + 1);
  }
  return counts;
}

function sameQuantities(left: Map<string, number>, right: Map<string, number>) {
  return left.size === right.size && Array.from(left).every(([model, quantity]) => right.get(model) === quantity);
}

/** Read-only precondition for signing, closing and invoicing maintenance. The
 * caller supplies database rows scoped to this workspace/customer/appointment.
 * Quote and link writes are separate, so either may be left behind by a failed
 * save; neither the visible quote nor the links alone can prove consistency. */
export function assertMaintenanceDeviceConsistency(
  customer: Customer,
  items: QuoteItem[],
  installations: Customer[],
  savedLinks: SavedMaintenanceDeviceLink[],
  savedItems: QuoteItem[],
): void {
  try {
    const ids = customer.maintenanceInstallationIds
      ?? customer.maintenanceInstallations?.map(installation => installation.appointmentId) ?? [];
    const selections = Object.entries(customer.maintenanceDeviceSelections || {});
    const explicitSelection = selections.length > 0
      || Boolean(customer.maintenanceInstallations?.some(installation => installation.selectedDevices != null));
    // Old manually entered maintenance jobs predate installation links.
    if (!ids.length && !savedLinks.length && !explicitSelection) return;

    if (!customer.id || !ids.length || ids.some(id => typeof id !== "string" || !id.trim())) throw new Error();
    const requestedIds = new Set(ids);
    if (requestedIds.size !== ids.length) throw new Error();
    if (selections.some(([id, selection]) => !requestedIds.has(id) && (!Array.isArray(selection) || selection.length > 0))) throw new Error();

    const links = new Map<string, SavedMaintenanceDeviceLink>();
    for (const link of savedLinks) {
      if (!link || !requestedIds.has(link.installation_appointment_id) || links.has(link.installation_appointment_id)) throw new Error();
      links.set(link.installation_appointment_id, link);
    }
    if (!sameKeys(requestedIds, new Set(links.keys()))) throw new Error();

    const selectedDevices: MaintenanceDeviceSelection[] = [];
    for (const id of ids) {
      const sources = installations.filter(installation => installation.activeAppointmentId === id);
      if (sources.length !== 1 || sources[0].id !== customer.id || !isInstallationAppointment(sources[0].appointmentType)) throw new Error();
      const sourceItems = sources[0].quoteItems;
      const desired = selectedMaintenanceDevices(sourceItems, maintenanceSelectionFor(customer, id));
      const saved = selectedMaintenanceDevices(sourceItems, links.get(id)!.selected_devices);
      if (!desired.length || !sameKeys(new Set(desired.map(maintenanceDeviceKey)), new Set(saved.map(maintenanceDeviceKey)))) throw new Error();
      selectedDevices.push(...desired);
    }

    const expected = modelQuantities(selectedDevices);
    if (!sameQuantities(expected, modelQuantities(maintenanceDeviceSlots(items)))
      || !sameQuantities(expected, modelQuantities(maintenanceDeviceSlots(savedItems)))) throw new Error();
  } catch {
    throw new Error(CONSISTENCY_MESSAGE);
  }
}
