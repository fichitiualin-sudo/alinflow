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
- 68 tests passed, including native restored-schema and two-connection stock
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
- [ ] 7. Deploy the verified application revision and verify Vercel readiness.
- [ ] 8. Verify authenticated desktop/mobile workflows and refresh client tabs.

## Local Restore Boundary

The archive contains the database dump, including managed schemas. The local
restore exercises application (`public`) and authentication (`auth`) schemas,
data, functions, constraints and ACLs. Supabase-managed platform extensions,
object-storage files and the hosted authentication service require separate
platform recovery procedures and are not simulated by native PostgreSQL.
