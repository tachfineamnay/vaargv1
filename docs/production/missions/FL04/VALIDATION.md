# FL04 Validation

Environment: Arena sandbox, node v22.22.3, pnpm 10.15.0 (corepack-activated), no Docker,
no PostgreSQL, no Valkey, no Shopify access. External-service gates: NOT_RUN is an honest
outcome; implementation continued independently per mission order.

| Check | Command | Result | Evidence |
|---|---|---|---|
| GRAPHIFY | `graphify --version` | NOT_RUN (command not found, exit 127) | mission start; GRAPHIFY_BLOCKED |
| Install | `pnpm install --frozen-lockfile` | PASS (exit 0, 29.9s) | session log |
| Checkpoint gate (5 files before code) | manual | SATISFIED | missions/FL04/{MISSION,TASKS,PROGRESS,DECISIONS,VALIDATION}.md |
| Shared contracts (attribute preprocess, detail freshness) | `npx vitest run` (packages/shared) | PASS 26/26 | session log |
| API listFiltersV1 + attribute wire tests | `npx vitest run` (apps/api) | PASS 10/10 | session log |
| Full monorepo gates | `npx turbo run lint typecheck build test --force` | PASS (20/20 tasks, exit 0) | evidence/turbo-checks.txt |
| Web unit tests (5 files) | `npx vitest run` (apps/web) | PASS 47/47 | evidence/turbo-checks.txt |
| Host forwarding (tenant authority) | catalog-client suite asserts upstream `Host` header | PASS | test/catalog-client.test.ts |
| BFF same-origin / cookie-only / consent constraint | BFF suite invokes route handlers against stub API | PASS (16 tests) | test/web.test.tsx |
| Home composition + per-section failure states | page suite (fulfilled/failed/empty/not-configured) | PASS (4 tests) | test/page.test.tsx |
| Live smoke (production build + stub API) | curl suite vs `next start :3000` + `smoke-stub.mjs :4112` | PASS 49/49 | evidence/web-smoke.txt |
| Session/consent BFF live flows | curl POST/GET/DELETE/rotate/consent incl. cross-origin 403, smuggle 400 | PASS | evidence/web-smoke.txt |
| Sitemap/robots/404/unknown-host surfaces | curl | PASS | evidence/web-smoke.txt |
| Real PG / Valkey / live Shopify / Docker | gated | NOT_RUN | no binaries; apt network blocked |
| Graphify pipeline | `graphify` | BLOCKED | command not found |

Notes:
- The live smoke runs the real production `next build` output against
  `test/support/smoke-stub.mjs` (standalone Node stub of the v1 wire shapes) because
  Docker/Postgres/Valkey are unavailable in this sandbox. Wire shapes are validated by
  the same shared Zod contracts used in unit tests.
- Docker compose, real-PostgreSQL, Valkey and live Shopify certification remain NOT_RUN
  and are explicitly out of scope for this sandbox (same posture as FL01–FL03).
