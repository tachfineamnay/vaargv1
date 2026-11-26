# P00 validation

Tested source SHA at mission entry: 626c426002e34eb1d3ac3f4b7f6898cfc2d92676
Delivered on branch arena/4c6c91c7-vaargv1 (clean-room rebuild; previous P00 code preserved in git history).

| Check | Status | Command / exit / evidence |
|---|---|---|
| Environment capability | PASS_REAL | node v22.22.3, pnpm 10.15.0 (corepack), registry reachable; Docker NOT available in sandbox |
| Frozen install | PASS_REAL | `pnpm install --frozen-lockfile` exit 0; pnpm-lock.yaml committed |
| Lint | PASS_REAL | `pnpm lint` exit 0 (4 packages, shared ESLint flat config) |
| Typecheck | PASS_REAL | `pnpm typecheck` exit 0 (5 tasks, strict TS 5.9.3) |
| Unit tests | PASS_REAL | `pnpm test` exit 0; shared 14 + web 5 + worker 6 = 25 passed; api e2e gated to live server |
| Build | PASS_REAL | `pnpm build` exit 0; shared dist, api dist, worker dist, web .next all produced |
| API live e2e | PASS_REAL | `API_TEST_URL=... vitest run` 4/4 PASS against live API (/health/live, /version, /health/ready, request-id header) |
| Web/API live smoke | PASS_REAL | `scripts/certification/smoke.mjs` against live api+web: 4/4 PASS |
| Worker startup failure | PASS_REAL | `node apps/worker/dist/main.js` with unreachable deps exits 1 with structured error (WORKER_REQUIRE_READY=true) |
| Worker graceful shutdown | PASS_REAL | SIGTERM/SIGINT closes PG + Valkey cleanly (no unhandled crash) |
| certify.sh | PASS_REAL | `pnpm certify` all steps PASS; Status: PASS_LOCAL_SOURCE |
| Docker definitions | NOT_RUN | Docker unavailable in sandbox; compose dev+prod, 3 Dockerfiles, init.sql authored; real build/run deferred to Codex |
| PostgreSQL 18 + pgvector live | NOT_RUN | No Docker/DB in sandbox; readiness probes implemented and return explicit not_ready (honest) |
| Valkey live | NOT_RUN | No Docker in sandbox |
| Hermes/Hatchet/A2UI/AG-UI/Hydrogen | NOT_RUN | Integration review recorded from official sources; no runtime integration in P00 |
| Shopify / AI providers | NOT_RUN | No credentials; .env.example exposes placeholders only |
| AC-28 fresh install/upgrade | PARTIAL | Frozen install + build PASS_REAL; fresh-DB migration/restore NOT_RUN (P01 scope) |
| AC-29 secrets/artifacts | PARTIAL | No secrets in source; full scan deferred to Codex/P10 |

PASS_SIMULATED: none used to satisfy any real gate. Live DB/Valkey/Shopify/AI/Hermes/Hatchet remain NOT_RUN.
