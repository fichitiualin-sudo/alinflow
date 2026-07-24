export type AppointmentRecordRow = {
  id?: string | null;
  customer_id?: string | null;
  quote_id?: string | null;
  title?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  appointment_type?: string | null;
  status?: string | null;
  address?: string | null;
  notes?: string | null;
  cancelled_at?: string | null;
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

  return {
    ...appointment,
    ...job,
    id: appointment.id,
    legacy_source_key: appointment.legacy_source_key,
    cancelled_at: appointment.cancelled_at,
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
  const matchedJobIds = new Set<string>();

  const visibleAppointmentRows = appointmentRows.filter((row) => !isLegacyMergedAppointment(row));

  const rows = visibleAppointmentRows.flatMap((appointment) => {
    const jobId = legacyJobId(appointment);
    if (!jobId) return [appointment];

    const job = jobsById.get(jobId);
    if (!job) return jobsReadSucceeded ? [] : [appointment];

    matchedJobIds.add(jobId);
    return [mergeLegacyJob(appointment, job)];
  });

  jobRows.forEach((job) => {
    const jobId = String(job.id || "");
    if (!jobId || matchedJobIds.has(jobId)) return;
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
