# Validation

Tested SHA: working tree of arena/943b6362-vaargv1 (see DELIVERED_SHA in final report).
Environment: Node v22.22.3, pnpm 10.15.0 via corepack, no Docker/PG/Valkey (external runtime
unavailable → env-gated PG/live suites NOT_RUN, not FAIL).

| Command | Scope | Result |
|---|---|---|
| `corepack pnpm -r --if-present run typecheck` | shared, persistence, api, worker, web | PASS |
| `corepack pnpm -r --if-present run build` | all packages/apps (tsc + next build) | PASS |
| `corepack pnpm --filter @vaarg/shared run test` | contracts + new application contracts (22 tests) | PASS |
| `corepack pnpm --filter @vaarg/persistence run test` | 50 passed / 34 env-skipped (PG/real) | PASS |
| `corepack pnpm --filter @vaarg/api run test` | catalog unit (4) + env-skipped e2e/pg | PASS |
| `corepack pnpm --filter @vaarg/worker run test` | 9 passed / 1 env-skipped | PASS |
| `corepack pnpm --filter … run lint` (shared/persistence/api) | eslint | PASS |

New targeted tests: `packages/shared/test/application.test.ts` (8), 
`packages/persistence/test/visitor-session-cache.test.ts` (4).
Existing tests unmodified. NOT_RUN: `catalog.pg.test.ts`, `api.e2e.test.ts`, worker PG suite,
integration/p02a, rate-limit, shopify.real (require isolated PG18/Valkey/live URL env vars —
external runtime unavailable in this Arena mission). No PASS_SIMULATED claims.
