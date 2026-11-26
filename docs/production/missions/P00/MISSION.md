# P00 — Industrial bootstrap

Status: COMPLETE (source delivered). Source SHA at mission entry: `b0943dd8cd87626cc7c8ac20979eedc830a3d5e9`.
Normative inputs: [PRD](../../../product/PRD.md), [ROADMAP P00](../../ROADMAP.md), [AGENTS](../../../../AGENTS.md), [P00 prompt](../../prompts/P00.md). Verified [source manifest](../../SOURCE_MANIFEST.md).

## Scope delivered
- Root pnpm workspace + Turborepo, strict TypeScript 5.9.3, frozen lockfile, lint/format, root dev/build/typecheck/lint/test/smoke/certify commands.
- Shared Zod 4.6.7 contracts package (env, errors, store, telemetry, contracts) with unit tests.
- Executable NestJS 12 / Fastify 5 API: /health, /health/ready (real DB+Valkey probes), /version, /catalog. Real pg + ioredis clients.
- Executable Next.js 16 / React 19 web: SSR home, collection pages, health page, navigation.
- Real Node worker entrypoint: explicit PostgreSQL/Valkey readiness, Hatchet-ready (disabled by default), job runner.
- .env.example, docker-compose (PostgreSQL 18 + Valkey 8), per-app Dockerfiles, .dockerignore.
- Local certification scripts (certify.sh, smoke.mjs).

## Invariants preserved
- Shopify is transaction authority; no fabricated commerce. No P01 migrations or business schemas.
- Hermes/Hatchet remain approved future runtime architecture; Hatchet wired but disabled. No BullMQ, no fake jobs.
- No canary foundations; all versions pinned stable. No real credentials committed.
- AC-28/29 partial evidence only; no full acceptance claimed.
