# P02 validation

Source SHA: 599f8e664b32f40130745377eaa316e473637ed9. Tests not yet run. AC-05, AC-25, AC-27: NOT_RUN. Real provider and PostgreSQL gate status to be determined.

- PASS_SIMULATED: `packages/persistence> .\node_modules\.bin\vitest.cmd run test/shopify.test.ts`, exit 0, 4 tests, working tree on 599f8e6 plus P02 changes. Synthetic provider; no live Shopify.
- PASS_REAL (typecheck only): `packages/persistence> .\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.test.json`, exit 0, working tree on 599f8e6 plus P02 changes.
- FAIL: full `pnpm install --offline --frozen-lockfile --ignore-scripts`, exit 1, cache lacks next-16.4.6.tgz. Online install interrupted after prolonged linking; no completion claimed. Filtered `pnpm --filter @vaarg/persistence... install --offline --frozen-lockfile --ignore-scripts`, exit 0.

- PASS_SIMULATED (real PostgreSQL 17, synthetic Storefront): `P02_TEST_DATABASE_URL=<isolated test DB> .\node_modules\.bin\vitest.cmd run test/catalog-import.test.ts`, exit 0, 1 scenario. Working tree on 599f8e6 plus P02 changes, before later freshness/cursor-history changes. Scope: checkpoint, interruption, unavailable variant, reconciliation and RLS cross-store read. Not PG18, P01 migration path or real Shopify.
- PASS_REAL: persistence test-project TypeScript, exit 0, on tree before latest freshness/cursor-history edits.

- PASS_SIMULATED: updated catalog import test on fresh isolated PostgreSQL 17, exit 0, 1 scenario, working tree on 599f8e6 plus P02 changes.
- TDD: `vitest run test/shopify.test.ts`, currency mismatch initially FAIL exit 1 (accepts USD for EUR), then PASS_SIMULATED exit 0 (5 tests) after validation fix. No live Shopify.

- PASS_SIMULATED: seven adapter tests, one future webhook HMAC test, real Storefront test skipped; current working tree on 599f8e6. Authorization and pacing tests were observed failing before implementation.
- PASS_REAL (limited): persistence TypeScript build and test typecheck exit 0 before last retry/pacing changes; CLI emitted NOT_CONFIGURED without configuration (process nonzero by design).
- PASS_REAL: `pnpm install --frozen-lockfile --ignore-scripts`, exit 0; install scripts intentionally not exercised.
- Webhook test setup included incorrect working-directory commands; corrected and passing.

- PASS_SIMULATED: `vitest run test/catalog-import.test.ts` with isolated PG18 and synthetic provider, exit 0; checks recovery, RLS, stale/availability and reconciliation.
- PASS_REAL: `node dist/db/migrate.js` on isolated fresh PG18+pgvector, exit 0; applied migrations 0000, 0001, 0002; second execution exit 0, all skipped. Upgrade from populated P01 still NOT_RUN.
- P01 context regression: real PG18 test first FAIL exit 1 syntax error near $1; after set_config fix PASS_REAL exit 0, 1 test, including pooled context cleanup.
- `pnpm typecheck` exit 0; `pnpm test` exit 0 with Shopify/DB suites skipped in that invocation; tested working tree on 599f8e6 prior to latest changes. `pnpm lint` exit 1: four P02 CLI no-console violations (subsequently corrected) and six pre-existing P01 lint violations.

- PASS_REAL: `vitest run test/catalog-upgrade.test.ts`, isolated PG18/pgvector, exit 0; P01 migrations, existing synthetic store, P02 migration, store preserved.
- PASS_SIMULATED: `vitest run test/shopify.test.ts`, exit 0, 9 synthetic tests after collection and media additions; no live Shopify.
- PASS_SIMULATED: updated catalog import on PG18, exit 0; includes duplicate item, recovery, isolation, and rejection of superuser. Unsafe-role scenario initially failed before fix.
- FAIL: inherited P01 integration suite on isolated PG18: initial run 10 failures from wrong test imports; after path correction 6 failed, 5 passed. Failing tests: invalid pg_tables RLS query, superuser isolation assumption, conflicting runtime role password in shared test server, rotated session still resolving, concurrent idempotency duplicate, webhook inbox dedup. Four asynchronous errors were also reported. Not proof of P01 isolation. Detailed raw output deliberately not saved (may contain connection and synthetic payload internals).
- PASS_SIMULATED: API catalog status unit test exit 0; it was first observed failing against the P00 echo. HTTP projection integration remains NOT_RUN/NOT_IMPLEMENTED.
- PASS_REAL: `pnpm build` exit 0 on earlier P02 working tree before subsequent changes; final tree requires rerun. Targeted P02 lint and TypeScript passed before latest changes.

## Current working-tree gates

- Environment: Windows / Node v24.21.0 / pnpm 10.15.0. Source 599f8e664b32f40130745377eaa316e473637ed9 plus uncommitted P02 changes; per-file hashes in exported checkpoint manifest.
- `pnpm install --frozen-lockfile --ignore-scripts`: exit 0; install lifecycle scripts not tested.
- `pnpm typecheck`: exit 0, evidence/typecheck-final.log.
- `pnpm test`: exit 0, evidence/test-final.log; includes 9 synthetic Shopify tests, HMAC test and HTTP NOT_CONFIGURED test; real provider and DB-gated suites skipped in this run.
- `pnpm build`: exit 0, evidence/build-final.log.
- `pnpm lint`: exit 1, evidence/lint-final.log: six P01 errors in migration runner and existing integration tests. Targeted P02 lint passed before latest minor changes.
- `git diff --check`: exit 0 (tracked diff only).
- AC-05: partial synthetic contract/projection evidence; real catalog and real price/stock agreement NOT_RUN.
- AC-25: partial synthetic market/language/currency context evidence; configured two-market real scenario NOT_RUN.
- AC-27: partial PG18 synthetic page checkpoint/recovery evidence; Hatchet restart/runtime gate NOT_RUN.
- Live Shopify, full P01 isolation, API projection, production smoke, full certification: NOT_RUN or FAIL as noted; no V1 GO.

## P02A consolidation (2026-11-26)
P02 source from a4ea19c integrated over main 3a3db51; P01 PG18 regression and lint remediated. Real PG18 with synthetic Storefront import and populated upgrade passed on P02A working tree. API live tests passed; web smoke failed because local web launch was rejected by automatic approval review. Real Shopify, trusted domain/store binding, HTTP projection and full P02 remain incomplete. See ../P02A/evidence/local-tests.md for commands and limits.

Final P02A combined PG18 run: 26 tests passed including synthetic import and populated upgrade through migration 0007; see ../P02A/VALIDATION.md. Real Shopify and HTTP projection remain NOT_RUN.
