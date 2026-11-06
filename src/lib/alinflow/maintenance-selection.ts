import type { Customer } from "./types";

/** Only exact, scope-checked mirror aliases from the current load are accepted. */
export function canonicalAppointmentIds(ids: string[], aliases: Map<string, string>) {
  return Array.from(new Set(ids.filter(Boolean).map((id) => aliases.get(id) || id)));
}

export function canonicalCustomerAppointments(customer: Customer, aliases: Map<string, string>): Customer {
  const installations = customer.maintenanceInstallations;
  const byId = new Map<string, NonNullable<Customer["maintenanceInstallations"]>[number]>();
  installations?.forEach((installation) => {
    const appointmentId = aliases.get(installation.appointmentId) || installation.appointmentId;
    if (!byId.has(appointmentId) || installation.appointmentId === appointmentId) {
      byId.set(appointmentId, { ...installation, appointmentId });
    }
  });
  const selections = customer.maintenanceDeviceSelections;
  const selectionsById = new Map<string, NonNullable<Customer["maintenanceDeviceSelections"]>[string]>();
  Object.entries(selections || {}).forEach(([id, selection]) => {
    const appointmentId = aliases.get(id) || id;
    if (!selectionsById.has(appointmentId) || id === appointmentId) {
      selectionsById.set(appointmentId, selection);
    }
  });
  return {
    ...customer,
    activeAppointmentId: customer.activeAppointmentId
      ? aliases.get(customer.activeAppointmentId) || customer.activeAppointmentId : undefined,
    maintenanceInstallationIds: customer.maintenanceInstallationIds
      ? canonicalAppointmentIds(customer.maintenanceInstallationIds, aliases) : undefined,
    maintenanceInstallations: installations ? Array.from(byId.values()) : undefined,
    maintenanceDeviceSelections: selections ? Object.fromEntries(selectionsById) : undefined,
  };
}
