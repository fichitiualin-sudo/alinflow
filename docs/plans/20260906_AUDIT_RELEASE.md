# Audit Release Execution

## Scope

Execute the eight release gates in `docs/AUDIT_FIXES_20260906.md`.
Never publish database backups, credentials, or customer data in Git.
Never repair historical records by deletion or guessed reassignment.

## Confirmed Baseline

- Production Vercel commit: `f7cbe1f6ff1069732aeb5e5784aad1e1325370fe`.
- Production database: PostgreSQL 17.6.
- User confirmed a pause on every device during the release.
- Supabase Free has no scheduled project backup available.
- A full custom-format `pg_dump` archive was created locally, with a SHA-256
  manifest and successful archive-list validation. Public/auth restore succeeded.
- Backup connection uses verified TLS with the certificate linked by Supabase.
- Preflight: 46 required columns, PostgreSQL version, appointment RPC and 10
  RLS-enabled tables passed (58 checks). Inspected member-scoped policies,
  checklist/document uniqueness and dependent foreign keys.
- Production and Preview now have the explicitly approved issuer-workspace
  binding. Existing server-side invoice keys were not changed.
- 70 tests passed, including native restored-schema and two-connection stock
  contention tests. Local migration repeated successfully; all 16 verification
  checks passed and all seven issue counts are zero after the approved repair.
- All 19 public tables retain their row counts. Legacy values match the backup,
  excluding intentional new migration fields/timestamps. One floating-point
  text-format difference across PostgreSQL versions was verified binary-equal.
- User approved detaching one historical test report from a mismatched survey.
  Local and production repairs preserved the full report/signature and appointment.
  The production correction preceded the new relationship guard; no rows deleted.
- Production migration committed successfully. It added 581 completion markers
  without changing stock quantities. All 16 verification checks passed; all seven
  issue counts are zero. SQL output is retained privately outside the repository.

## Eight Gates

- [x] 1. Restore the deployed application schema/data locally and test the migration.
- [x] 2. Verify a restorable backup and maintain the confirmed writer pause.
- [x] 3. Execute and review the production read-only preflight.
- [x] 4. Configure the confirmed invoice workspace in Vercel.
- [x] 5. Apply the production migration after all prerequisites pass.
- [x] 6. Run production verification; investigate every nonzero issue count.
- [x] 7. Deploy the verified application revision and verify Vercel readiness.
- [ ] 8. Verify authenticated desktop/mobile workflows and refresh client tabs.

## Browser Acceptance Progress

- PR #88 merged as `0796e3ed8646459dfccce3fbecb9bcbff865538d`.
  Production Vercel deployment `3gSzL9irtx5hqP88eNeL7pww9w2a` succeeded.
- Refreshed authenticated production page loads existing customers, appointments,
  reports and stock. A 390x844 viewport displays maintenance controls without
  horizontal overflow. Two historical installations remain distinct.
- Found an additional UI-only defect: cancelling new maintenance returned to a
  work page with an unsaved maintenance selection. Follow-up preserves/restores
  the original installation; two additional regression tests pass.
- PR #89 merged as `8377f6865d6166f6e3c12ccc1545ae349eb2d8f9`.
  Production deployment `HbafDhVrVNe7dtiWVoDfYb8Kc5hW` succeeded. Repeated
  authenticated 390x844 testing confirms Back restores the original completed
  installation, its products and closing actions without saving the draft.
- Full write/signature acceptance with disposable UI records awaits the owner's
  confirmation. No real invoice, email or stock operation was sent during UI checks.

## Dependency Security Follow-Up

- The previously unavailable npm audit completed and reported four high-severity
  production dependency findings. This is an advisory result, not evidence of an
  exploit against this application.
- In an isolated worktree with its own dependency installation, upgraded Next.js
  from 16.2.6 to 16.3.4 and PostCSS from 8.5.14 to 8.5.23, including compatible
  transitive security fixes. No forced dependency upgrades were used.
- The complete npm audit now reports zero known vulnerabilities. All 70 tests,
  TypeScript checking and the normal Turbopack production build pass with synthetic
  build-only Supabase settings. PR #90 merged as
  `69de21a9204fe1630005d539fb26969c4b68d7d7`; production deployment
  `CSzhkm2EfpcKwynHoQ3CXDuoTZDT` is Ready.

## Approved Write Acceptance

- Owner approved a disposable, clearly named release-test customer, climate
  product and appointments, including cleanup. Existing business records must
  remain unchanged; no real invoices or emails may be sent.
- Customer/appointment creation, postal-code completion, manual billing and
  a visibly synthetic signature saved successfully through the production UI.
  Mobile signature save returned to the same installation's closing actions.
- The zero-stock test produced a visible top-of-page error and made no deduction.
- Found a further client-side blocker: shortage of a material reserved by other
  jobs prevented completion even when this job needed zero of that material.
  The stock check now skips unused materials while preserving reservations for
  materials this job actually needs. Three regressions include the reproduced
  failure, a real shortage and exact remaining availability.
- Full acceptance and deletion of the disposable test records remain in progress.

## Local Restore Boundary

The archive contains the database dump, including managed schemas. The local
restore exercises application (`public`) and authentication (`auth`) schemas,
data, functions, constraints and ACLs. Supabase-managed platform extensions,
object-storage files and the hosted authentication service require separate
platform recovery procedures and are not simulated by native PostgreSQL.
