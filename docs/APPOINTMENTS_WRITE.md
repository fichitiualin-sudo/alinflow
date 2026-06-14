# Appointment write stabilization

Phase 6 makes `appointments` the primary scheduling record while keeping `jobs` as a compatibility mirror.

## Rules

- New or edited survey, installation, and maintenance appointments are written through `public.save_appointment_with_job_mirror`.
- The database function updates or creates the `appointments` row first and mirrors the same appointment to one linked `jobs` row in the same transaction.
- The mirror link is stored in `appointments.legacy_source_key` as `jobs:<job_id>`.
- Maintenance scheduling starts with no active appointment id, so each new yearly maintenance creates its own appointment record.
- Follow-up saves for the same open appointment reuse `activeAppointmentId`, so the same appointment is updated instead of duplicated.
- Cancellations use `public.cancel_appointment_with_job_mirror` and mark the current appointment and its mirror as `Lemondva`.
- Old `jobs` data and columns are not deleted or renamed.

## Database files

- `docs/sql/20260614_ADD_APPOINTMENT_WRITE_FUNCTIONS.sql` adds the idempotent write and cancel functions.
- `docs/sql/20260614_VERIFY_APPOINTMENT_WRITES.sql` verifies that the functions exist, are executable, and that appointment mirror links are consistent.

## Rollback

Code rollback is enough to return the application to the previous compatible-read behavior. The added database functions are additive and can remain unused. If they must be removed later, remove only the functions after confirming no deployed application version still calls them.
