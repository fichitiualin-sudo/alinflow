# Audit fixes

## Goal
Fix A01-A15 in the 2026-09-06 audit and address pagination and invoice issuer scoping.

## Current behavior
The main page coordinates client state and Supabase writes. Separate REST writes
can partially succeed. Report fallback queries cross appointment boundaries.
Invoice and mail endpoints do not verify callers.

## Invariants
Preserve existing customers, quotes, signatures and appointment history.
Never reuse one appointment's report for another appointment.
Do not issue real invoices or send real mail during verification.
No production migration or deployment without verifying configuration.

## Data model
Add appointment-scoped material usage and a persistent stock-deducted timestamp.
Backfill that timestamp only for completed installation statuses.
Add transactional quote replacement and installation completion RPCs, with RLS,
row locks, validation and repeat-call protection. Add report scope guards.
Keep archived product identities in historical items.

## Steps
- [x] Authentication and invoice issuer scope.
- [x] Report, schedule and history separation.
- [x] Transactional quote replacement and stock completion.
- [x] Appointment material persistence.
- [x] Catalog, maintenance map, feedback and paginated loading.
- [x] Regression tests, TypeScript and build.

## Verification
Run Node regression tests with mocked I/O; test authorization failure paths,
historical reports, archive/zero-price handling, pending maintenance, errors and
rescheduling. Run TypeScript and Next.js build. SQL must be applied and checked
in a separate database before production deployment.

## Rollback
Revert application changes without deleting new columns or historical records.
Do not roll back deducted stock by overwriting absolute inventory snapshots.

## Delivery
Document exact migration, environment configuration, test results and any limits.

Completed locally: 56 tests passed (including isolated PostgreSQL tests), TypeScript
passed, webpack production build passed with synthetic Supabase configuration.
See docs/AUDIT_FIXES_20260906.md. Production preflight, configuration, migration,
authenticated browser acceptance and deployment remain release gates, not completed actions.
