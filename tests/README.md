# Regression tests

Run from the repository root:

```powershell
npm.cmd test
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The JavaScript tests compile the actual TypeScript modules and selected page
functions. External requests are mocked and network calls fail unless explicitly
intercepted. React server rendering checks the archived product controls.
Fixtures contain synthetic identities only.

## PostgreSQL tests

The SQL suite uses PGlite 0.5.8, an isolated local PostgreSQL WASM runtime.
Set `PGLITE_MODULE_PATH` to its absolute `dist/index.cjs` path before running tests:

```powershell
$env:PGLITE_MODULE_PATH=(Resolve-Path ../../outputs/alinflow-fixes-2026-09-06/test-deps/package/dist/index.cjs).Path
npm.cmd test
```

That relative path is specific to the local audit workspace. On another machine,
provide an isolated PGlite 0.5.8 package and set the corresponding absolute path.
It is not a production application dependency and is not committed here.

The public npm package archive used for this run had this SHA512 digest (base64):

```text
n9tsbUOhwx2epK1V0ZG9Ar4SHWUju04dhmzZXiSBXwBoleOvIfals33NAaWgagQVAL4Rbvx/Ptsu3P+pA09f6Q==
```

Without the environment variable the SQL suite explicitly reports a skip.
A release check must include it and finish with zero skipped tests.

The suite starts with a synthetic schema, installs the existing appointment RPC,
checks preflight, applies the new migration twice, then verifies transactional
rollback, repeated completion, scope guards, persisted resources and permissions.
The read-only verification script is executed and its results asserted too.
PGlite serializes queries: this does not replace a multi-connection PostgreSQL
concurrency test or testing the deployed Supabase RLS and schema.

See [PGlite documentation](https://pglite.dev/docs/about).

## Restored Deployment Tests

`deployed-schema.test.cjs` adds native PostgreSQL checks using an isolated `pg`
8.16.3 client. Set `LOCAL_PG_MODULE_PATH` to its package directory, and provide
local PostgreSQL credentials through environment variables. The suite refuses
any host except `127.0.0.1`, port `55436`, database `alinflow_restore`.

Restore the deployed public/auth schema and data, including schema ACLs, then
apply the audit migration first. Synthetic regression fixtures are rolled back.
The concurrency test creates a uniquely named local database clone, uses two
independent authenticated connections, then drops only that disposable clone.
It tests simultaneous completion, stock exhaustion, repeated completion and
concurrent delta adjustments. Never point these tests at a hosted database.

The complete release run has 68 passing tests, with both database suites enabled.
