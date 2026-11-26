# P00 progress

2026-11-26 — Clean-room P00 rebuild started.

## T01 — DONE
- Branch: arena/4c6c91c7-vaargv1 (session-pinned; mission requested arena/v1-build — deviation recorded, current branch name is fixed). HEAD: 626c426002e34eb1d3ac3f4b7f6898cfc2d92676.
- PRD SHA-256: 7e49d94144b4fd24b8968652664c354d5d8949946d9d9773c8314cbb630f8596 (matches SOURCE_MANIFEST.md).
- Runtime: node v22.22.3, pnpm 10.15.0 (corepack), npm 10.9.8. Docker: NOT available in sandbox.
- Previous P00 app code present in tree (merged via PR #1) — will NOT be reused; preserved in git history.

## T02 — DONE
- Created docs/production/ARENA_EXECUTION.md (execution and handoff rules per owner override).
- Updated MISSION.md and TASKS.md with source SHA + PRD SHA-256.

Next exact action: T03 — rebuild root monorepo from the documentation baseline (remove previous app code, write fresh workspace config).

## T03 — DONE
- Removed previous P00 application code (preserved in git history via merged PR #1). Fresh root workspace: pnpm 10.15.0, Turborepo 2.11.13, TS 5.9.3 strict, shared ESLint flat config, Prettier, .npmrc, root dev/build/typecheck/lint/test/smoke/certify/db commands.

## T04 — DONE
- @vaarg/shared: Zod 4.6.7 contracts (env, errors, store, telemetry, contracts). Readiness schema rejects contradictory states via Zod refinement (ready w/ required not_ready; not_ready w/ all required ready). 14 unit tests PASS_REAL.

## T05/T06 (API) — IN PROGRESS
- @vaarg/api: NestJS 12/Fastify 5, Pino structured logging with redaction, request IDs (accept-or-generate), structured error filter, graceful shutdown, distinct /health/live vs /health/ready, real pg + ioredis probes. Build PASS. Live e2e 4/4 PASS_REAL.

Next exact action: finish @vaarg/web (Next.js 16 / React 19 App Router, SSR landing, typed API connectivity, failure states, accessible layout, standalone Docker).

## T05 — DONE
- @vaarg/web: Next.js 16.4.6 / React 19.3.1 App Router. SSR landing with typed API connectivity client (probeApiStatus), connected/unreachable/invalid_response failure states rendered via ApiStatusPanel, accessible layout (skip link, aria labels, focus styles), /collections + /health routes. Build PASS; 5 unit tests PASS_REAL.

## T06 — DONE
- @vaarg/api: NestJS 12.6.2 / Fastify 5.12.8. Pino 10.4.0 structured logging with redaction, request IDs (accept-or-generate via onRequest hook), structured AppError filter, graceful shutdown (enableShutdownHooks), distinct /health/live vs /health/ready, real pg + ioredis readiness probes. Build PASS; live e2e 4/4 PASS_REAL.

## T07 — DONE
- @vaarg/worker: executable Node entrypoint. Validated config (Zod), real required dependency checks (PG + Valkey), Pino logging, lifecycle, startup failure (exit 1 when required deps unreachable, WORKER_REQUIRE_READY opt-out), graceful shutdown (resilient ioredis close). Build PASS; 6 tests PASS_REAL; startup-failure exit=1 verified.

Next exact action: T08 — infrastructure (PG 18 + pgvector, Valkey, Dockerfiles, dev + production Compose, private networks, safe env examples).

## T08 — DONE
- docker-compose.dev.yml + docker-compose.prod.yml: pgvector/pgvector:pg18 (correct PG18 volume mount /var/lib/postgresql, PGDATA /var/lib/postgresql/18/docker), Valkey 8, init.sql creates `vector` extension (correct name), private internal network, no host socket/privileged, shm_size for pgvector. Dev exposes ports for local use; prod publishes none.
- Dockerfiles for web, api, worker with reproducible frozen-lockfile workspace dependency packaging.
- .env.example (safe placeholders), .dockerignore.

## T09 — DONE
- scripts/certification/certify.sh (frozen install, lint, typecheck, tests, build → evidence log) + smoke.mjs (live api/web probes) + README.

Next exact action: T11 — run all available checks, fix causes, record real vs simulated evidence.

## T10 — DONE
- Integration review recorded in INTEGRATION_RISKS.md from official sources:
  Hermes (NousResearch/hermes-agent delegation toolset), Hatchet (hatchet-dev/hatchet, TS SDK, Postgres mandatory),
  A2UI (a2ui-project/a2ui generative UI spec + catalog validation), AG-UI (ag-ui-protocol/ag-ui event transport, 1.0 frozen),
  Hydrogen (Shopify/hydrogen, calendar versioning, conditional per ADR-0001). No invented contracts; runtime compatibility NOT claimed.

## T11 — DONE
- Ran all available local gates: frozen install, lint, typecheck, tests, build, certify.sh — all PASS.
- Live smoke (api+web): 4/4 PASS_REAL. API e2e against live server: 4/4 PASS_REAL.
- Worker startup-failure behavior verified (exit 1 when required deps unreachable).
- Docker unavailable in sandbox: Docker code + smoke scripts completed; real runtime gates remain NOT_RUN.

Next exact action: T12 — finalize VALIDATION, STATUS, HANDOFF, SHA-256 manifest, coherent local commit.
