# P00 validation

Tested source SHA (entry): b0943dd8cd87626cc7c8ac20979eedc830a3d5e9. Delivered checkpoint committed on branch feat/p00-industrial-rebuild.

| Check | Status | Command / exit / evidence |
|---|---|---|
| Environment capability | PASS_REAL | node v22.22.3, pnpm 10.15.0, npm registry reachable; Docker NOT available in sandbox (recorded) |
| Frozen install | PASS_REAL | `pnpm install --frozen-lockfile` exit 0; pnpm-lock.yaml present |
| Lint | PASS_REAL | `pnpm lint` exit 0 (4 packages) |
| Typecheck | PASS_REAL | `pnpm typecheck` exit 0 (4 packages, strict TS 5.9.3) |
| Unit tests | PASS_REAL | `pnpm test` exit 0; shared 9, worker 6, web 4 = 19 passed; api e2e gated to live server (3 skipped without server) |
| Build | PASS_REAL | `pnpm build` exit 0; shared dist, api dist, worker dist, web .next all produced |
| Web/API live smoke | PASS_REAL | `scripts/certification/smoke.mjs` against live api+web: 4/4 PASS (/health 200, /health/ready 200, /version 200, web / 200 SSR) |
| API live e2e | PASS_REAL | `API_TEST_URL=... vitest run` 3/3 PASS against live API |
| Worker entrypoint | PASS_REAL | `node apps/worker/dist/main.js` starts; reports database/valkey not_ready, hatchet disabled |
| Docker definitions | NOT_RUN | Docker not available in sandbox; docker-compose.yml + 3 Dockerfiles authored, real build/run deferred to Codex harness |
| PostgreSQL/Valkey live readiness | NOT_RUN | No Docker/DB in sandbox; readiness probes implemented and return explicit not_ready (honest) |
| Dependency/secret audit | PARTIAL | No real secrets committed; .env.example safe. Full license scan deferred to Codex/P10. |
| AC-28 fresh install/upgrade | PARTIAL | Frozen install + build PASS_REAL; fresh-DB migration/restore NOT_RUN (P01 scope) |
| AC-29 secrets/artifacts | PARTIAL | No secrets in source; scans deferred |

PASS_SIMULATED: none used for any real gate. Live DB/Valkey/Shopify/AI remain NOT_RUN.
