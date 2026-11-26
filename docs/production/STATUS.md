# Production status — VAARG̈ V1

As of 2026-11-26: P00 clean industrial bootstrap IMPLEMENTED (clean-room rebuild, no reuse of previous P00 code) and locally certified. Frozen install, lint, typecheck, tests, build and live smoke all PASS_REAL. Docker and live-provider gates remain NOT_RUN and are executed by Codex.

| Mission | Implementation | Verification |
|---|---|---|
| P00 Bootstrap | DONE (clean-room) | PASS_LOCAL_SOURCE (Docker/live NOT_RUN) |
| P01 Core data / identity / isolation | SOURCE DELIVERED; remediation needed | FAIL: PG18 regression suite |
| P02 Shopify / catalogue | IN_PROGRESS; partial source only | NOT CERTIFIED |
| P03 Storefront / design | TODO | NOT_RUN |
| P04 Adaptive search / experience | TODO | NOT_RUN |
| P05 Hermes / A2UI / AG-UI | TODO | NOT_RUN |
| P06 Cart / checkout / markets | TODO | NOT_RUN |
| P07 Account / purchase / memory | TODO | NOT_RUN |
| P08 Merchant / CDP / support | TODO | NOT_RUN |
| P09 Marketing | TODO | NOT_RUN |
| P10 Certification | TODO | NOT_RUN |
| P11 Deployment | TODO | NOT_RUN |

## P00 delivered
- pnpm/Turbo monorepo, strict TS 5.9.3, frozen lockfile, shared ESLint.
- @vaarg/shared Zod 4 contracts with contradictory-readiness rejection (14 tests).
- @vaarg/api NestJS/Fastify: Pino logging, request IDs, structured errors, graceful shutdown, distinct liveness/readiness, real PG+Valkey checks (4 live e2e).
- @vaarg/web Next.js 16/React 19: SSR landing, typed API connectivity + failure states, accessible layout, standalone Docker (5 tests).
- @vaarg/worker: validated config, required dependency checks, startup failure + graceful shutdown (6 tests).
- Infra: PG18+pgvector + Valkey, dev/prod Compose, private networks, 3 Dockerfiles, safe .env.example.
- certify.sh + smoke.mjs; integration risk review (Hermes/Hatchet/A2UI/AG-UI/Hydrogen).

## Next exact action
Codex: real Docker certification (compose up, build images, confirm /health/ready ready against live PG+Valkey). No P01 without instruction.


## P01 — Core Data, Identity and Isolation (SOURCE DELIVERED)

- **Status**: SOURCE DELIVERED. All 13 implementation items delivered as source.
- **Base**: `2385a06d49976305fefa59c8d188357720a659e1` (P00 merged)
- **Branch**: `arena/c1eaf44b-vaargv1`
- **Deliverable**: `packages/persistence` (`@vaarg/persistence`) — Drizzle schema
  (14 tables/6 domains), versioned migrations, RLS + restricted role, real argon2id
  merchant auth, anonymous visitor sessions + rotation, purpose consents, transactional
  inbox/outbox, idempotency/dedup/audit, Valkey session infrastructure, Zod API boundaries.
- **Tests**: 17 unit tests PASS_REAL; 10 real-PostgreSQL integration tests written and
  gated on DATABASE_URL. Docker/PostgreSQL unavailable in sandbox → real DB gates NOT_RUN;
  Codex executes real Docker certification locally.
- **AC mapping**: AC-24 (store isolation), AC-28 (fresh install/upgrade/restore),
  AC-29 (no secrets/unnecessary PII).
- **Checkpoints**: `docs/production/missions/P01/` (MISSION, TASKS, PROGRESS, DECISIONS,
  VALIDATION, HANDOFF, evidence).
- **Next**: Codex runs real PostgreSQL 18 + Valkey certification locally.

## P02 — in progress (2026-11-26)

Base: 599f8e664b32f40130745377eaa316e473637ed9. Partial Storefront adapter, scoped projection, import CLI and tests exist in the P02 working tree; HTTP catalog explicitly reports NOT_CONFIGURED pending trusted tenant resolution. PG18 synthetic import and populated migration upgrade passed. Real Shopify NOT_RUN. P01 PG18 regression suite has six failures; see missions/P02/VALIDATION.md. No P02 source delivery or release certification. Next: follow P02 HANDOFF.md.

## P03 — initiated (2026-11-26)

IN_PROGRESS; no storefront implementation or P03 verification yet. Cumulative P02 is incomplete and HTTP catalog is NOT_CONFIGURED; original mockups and brand assets absent. See missions/P03/HANDOFF.md.
