export type AppointmentRecordRow = {
  id?: string | null;
  customer_id?: string | null;
  workspace_id?: string | null;
  quote_id?: string | null;
  title?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  appointment_type?: string | null;
  status?: string | null;
  address?: string | null;
  notes?: string | null;
  cancelled_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geocoded_at?: string | null;
  geocode_status?: string | null;
  geocode_error?: string | null;
  maintenance_opt_out?: boolean | null;
  maintenance_opt_out_at?: string | null;
  maintenance_origin?: string | null;
  maintenance_source_name?: string | null;
  created_by?: string | null;
  legacy_source_key?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function timestamp(value?: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function legacyJobId(row: AppointmentRecordRow) {
  const match = String(row.legacy_source_key || "").match(/^jobs:(.+)$/);
  return match?.[1] || undefined;
}

function mirroredAppointmentId(row: AppointmentRecordRow) {
  const match = String(row.legacy_source_key || "").match(/^appointments:(.+)$/);
  return match?.[1] || undefined;
}

function sameAppointmentScope(appointment: AppointmentRecordRow, job: AppointmentRecordRow) {
  return (!appointment.customer_id || !job.customer_id || appointment.customer_id === job.customer_id)
    && (!appointment.workspace_id || !job.workspace_id || appointment.workspace_id === job.workspace_id);
}

function appointmentMirrorAliases(appointmentRows: AppointmentRecordRow[], jobRows: AppointmentRecordRow[]) {
  const appointmentsById = new Map(appointmentRows.filter((row) => row.id).map((row) => [String(row.id), row]));
  const appointmentsByJobId = new Map<string, AppointmentRecordRow[]>();
  appointmentRows.forEach((appointment) => {
    const jobId = legacyJobId(appointment);
    if (!jobId || !appointment.id) return;
    appointmentsByJobId.set(jobId, [...(appointmentsByJobId.get(jobId) || []), appointment]);
  });

  const aliases = new Map<string, string>();
  jobRows.forEach((job) => {
    if (!job.id) return;
    const targetId = mirroredAppointmentId(job);
    const candidates = targetId
      ? [appointmentsById.get(targetId)].filter((row): row is AppointmentRecordRow => Boolean(row))
      : appointmentsByJobId.get(job.id) || [];
    const matching = candidates.filter((appointment) => {
      const forwardId = legacyJobId(appointment);
      return appointment.id && sameAppointmentScope(appointment, job)
        && (!forwardId || forwardId === job.id);
    });
    if (matching.length !== 1) return;
    const appointmentId = String(matching[0].id);
    // A real appointment ID must never be rewritten as another appointment's job alias.
    if (appointmentsById.has(job.id) && job.id !== appointmentId) return;
    aliases.set(job.id, appointmentId);
  });
  return aliases;
}

/** Exact job IDs that can safely be replaced with visible canonical appointment IDs. */
export function appointmentIdAliases(
  appointmentRows: AppointmentRecordRow[] = [],
  jobRows: AppointmentRecordRow[] = [],
): Map<string, string> {
  const visibleIds = new Set(appointmentRows.filter((row) => !isLegacyMergedAppointment(row)).map((row) => row.id));
  return new Map([...appointmentMirrorAliases(appointmentRows, jobRows)].filter(([, id]) => visibleIds.has(id)));
}

function isCancelled(row: AppointmentRecordRow) {
  return Boolean(row.cancelled_at)
    || String(row.status || "").trim().toLocaleLowerCase("hu-HU") === "lemondva";
}

function isLegacyMergedAppointment(row: AppointmentRecordRow) {
  const legacySourceKey = String(row.legacy_source_key || "");
  const notes = String(row.notes || "");

  return legacySourceKey.startsWith("legacy-klima-xlsx:merged:")
    || notes.includes("legacy_merged_into:");
}

function compareAppointmentRows(first: AppointmentRecordRow, second: AppointmentRecordRow) {
  const cancellationDifference = Number(isCancelled(first)) - Number(isCancelled(second));
  if (cancellationDifference !== 0) return cancellationDifference;

  const createdDifference = timestamp(second.created_at) - timestamp(first.created_at);
  if (createdDifference !== 0) return createdDifference;

  const updatedDifference = timestamp(second.updated_at) - timestamp(first.updated_at);
  if (updatedDifference !== 0) return updatedDifference;

  return String(second.id || "").localeCompare(String(first.id || ""));
}

function mergeLegacyJob(
  appointment: AppointmentRecordRow,
  job: AppointmentRecordRow,
): AppointmentRecordRow {
  if (timestamp(job.updated_at) <= timestamp(appointment.updated_at)) return appointment;

  // Only legacy editable work fields can be newer. Identity, server version,
  // geocoding and maintenance metadata always belong to the real appointment.
  const legacyFields: (keyof AppointmentRecordRow)[] = [
    "quote_id", "title", "scheduled_date", "scheduled_time", "appointment_type", "status", "address", "notes",
  ];
  return {
    ...appointment,
    ...Object.fromEntries(legacyFields.filter((key) => key in job).map((key) => [key, job[key]])),
  };
}

export function compatibleAppointmentRows(
  appointmentRows: AppointmentRecordRow[] = [],
  jobRows: AppointmentRecordRow[] = [],
  options: { jobsReadSucceeded?: boolean } = {},
) {
  const jobsReadSucceeded = options.jobsReadSucceeded !== false;
  const jobsById = new Map(
    jobRows
      .filter((row) => row.id)
      .map((row) => [String(row.id), row]),
  );
  const aliases = appointmentMirrorAliases(appointmentRows, jobRows);
  const jobsByAppointmentId = new Map<string, AppointmentRecordRow[]>();
  jobRows.forEach((job) => {
    const appointmentId = job.id ? aliases.get(job.id) : undefined;
    if (!appointmentId) return;
    jobsByAppointmentId.set(appointmentId, [...(jobsByAppointmentId.get(appointmentId) || []), job]);
  });

  const visibleAppointmentRows = appointmentRows.filter((row) => !isLegacyMergedAppointment(row));

  const rows = visibleAppointmentRows.flatMap((appointment) => {
    const jobId = legacyJobId(appointment);
    if (jobId && !jobsById.has(jobId) && jobsReadSucceeded) return [];
    const [job] = [...(jobsByAppointmentId.get(String(appointment.id)) || [])]
      .sort((first, second) => timestamp(second.updated_at) - timestamp(first.updated_at));
    return [job ? mergeLegacyJob(appointment, job) : appointment];
  });

  jobRows.forEach((job) => {
    const jobId = String(job.id || "");
    if (!jobId || aliases.has(jobId)) return;
    rows.push(job);
  });

  return rows;
}

export function currentAppointmentsByCustomer(rows: AppointmentRecordRow[] = []) {
  const rowsByCustomer = new Map<string, AppointmentRecordRow[]>();

  rows.forEach((row) => {
    const customerId = String(row.customer_id || "");
    if (!customerId) return;
    const customerRows = rowsByCustomer.get(customerId) || [];
    customerRows.push(row);
    rowsByCustomer.set(customerId, customerRows);
  });

  const currentByCustomer = new Map<string, AppointmentRecordRow>();
  rowsByCustomer.forEach((customerRows, customerId) => {
    const [current] = [...customerRows].sort(compareAppointmentRows);
    if (current) currentByCustomer.set(customerId, current);
  });

  return currentByCustomer;
}

export function appointmentsByCustomer(rows: AppointmentRecordRow[] = []) {
  const rowsByCustomer = new Map<string, AppointmentRecordRow[]>();

  rows.forEach((row) => {
    const customerId = String(row.customer_id || "");
    if (!customerId) return;
    const customerRows = rowsByCustomer.get(customerId) || [];
    customerRows.push(row);
    rowsByCustomer.set(customerId, customerRows);
  });

  rowsByCustomer.forEach((customerRows, customerId) => {
    rowsByCustomer.set(customerId, [...customerRows].sort(compareAppointmentRows));
  });

  return rowsByCustomer;
}

export function isMissingAppointmentsTableError(error: unknown) {
  const value = error as {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
  } | null;
  const text = `${value?.message || ""} ${value?.details || ""} ${value?.hint || ""} ${value?.code || ""}`.toLocaleLowerCase("hu-HU");

  return text.includes("appointments")
    && (
      text.includes("does not exist")
      || text.includes("schema cache")
      || text.includes("could not find")
      || text.includes("relation")
    );
}
