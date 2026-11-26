# P00 tasks (clean-room)
Atomic, dependency-ordered. Update status and evidence after each task.

- [x] P00-T01 — Verify repo/HEAD/dirty state, documents/hashes and runtime capabilities.
- [x] P00-T02 — Create docs/production/ARENA_EXECUTION.md and P00 mission checkpoints; record source SHA + PRD SHA-256.
- [x] P00-T03 — Root pnpm workspace + Turborepo, strict TS 5.9, shared ESLint, frozen lockfile, root commands.
- [x] P00-T04 — Shared Zod 4 contracts: runtime config, health, readiness (reject contradictory states), dependency status, API errors.
- [x] P00-T05 — Web: Next.js 16 / React 19 App Router, SSR landing, typed API connectivity, failure states, accessible layout, standalone Docker.
- [x] P00-T06 — API: NestJS/Fastify, Pino logging, request IDs, structured errors, graceful shutdown, distinct liveness/readiness, real PG+Valkey checks.
- [x] P00-T07 — Worker: executable Node entrypoint, validated config, required dependency checks, lifecycle, startup failure, graceful shutdown.
- [x] P00-T08 — Infrastructure: PG 18 + pgvector, Valkey, web/api/worker Dockerfiles, dev + production Compose, private networks, safe env examples.
- [x] P00-T09 — Verification: meaningful behavioral tests, root lint/typecheck/test/build/frozen-install/local smoke commands.
- [x] P00-T10 — Review Hermes, Hatchet, A2UI, AG-UI, Hydrogen integration constraints from official sources.
- [x] P00-T11 — Run all available checks, fix causes, record real vs simulated evidence.
- [x] P00-T12 — Update STATUS + all checkpoints, SHA-256 manifest, coherent local commit.

Dependencies: T01 first; T02 before coding; T03 before contracts/apps; T04 before T05–T07; T08 before T09 live smoke; T10 independent; T11 after T03–T09; T12 last.
