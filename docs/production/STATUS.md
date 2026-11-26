# Production status — VAARG̈ V1

As of 2026-11-26: P00 clean industrial bootstrap IMPLEMENTED (clean-room rebuild, no reuse of previous P00 code) and locally certified. Frozen install, lint, typecheck, tests, build and live smoke all PASS_REAL. Docker and live-provider gates remain NOT_RUN and are executed by Codex.

| Mission | Implementation | Verification |
|---|---|---|
| P00 Bootstrap | DONE (clean-room) | PASS_LOCAL_SOURCE (Docker/live NOT_RUN) |
| P01 Core data / identity / isolation | SOURCE DELIVERED | Real DB gates NOT_RUN |
| P02 Shopify / catalogue | TODO | NOT_RUN |
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
P00 live Docker gates remain pending for final Codex certification. Continue Arena source missions only upon owner instruction.


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
  VALIDATION, evidence).
- **Next**: P02 in Arena on the cumulative branch, when authorized. Real PostgreSQL 18 + Valkey certification remains pending for final Codex validation.

## P02A — foundation consolidation (2026-11-26)
Source base 3a3db51722b02f292da57fe02bddbe2f206f5d3d plus P02 a4ea19cf76e7cca2d2d44853aab2cf90a8491fed source, local working tree on codex/p02a-foundation. IN_PROGRESS: core DB/session/idempotency/inbox remediation implemented; focused isolated PG18 restricted-role tests passed. P02 catalog HTTP is NOT_CONFIGURED and merchant/visitor HTTP session integration is absent; real Shopify and clean-install gates NOT_RUN; web smoke BLOCKED by automatic approval rejection. No release certification. See missions/P02A for checkpoints and evidence. Next: trusted store/domain binding and secure HTTP session integration, then rerun blocked gates.

P02A postscript: migration 0007 disables direct login and removes the inherited password from cluster-wide vaarg_app; restricted login roles must be provisioned before upgrading. Final six-file synthetic PG18 regression: 26 passed. Assess any shared-cluster impact before any future authorized migration.

## FL01 — industrial runtime foundation (source delivery)
Container packaging, full Compose stack, migration locking/checksums and restricted-role provisioning, operational probes and safe volume commands implemented. Docker, PostgreSQL/Valkey and Coolify gates remain NOT_RUN; this is not a deployment or commercial certification. Migration 0007 has cluster-wide role implications; see `missions/FL01/` and `deploy/README.md` before any authorized upgrade.

## FL02 — core application foundation (source delivery)
Application boundaries separated into explicit NestJS modules (infra, tenant, identity, sessions, privacy, catalog) with DI and shared Zod contracts. Trusted tenant resolver (operator bindings + Host + RLS store status + correlation id), merchant identity module (argon2id login/logout/me/refresh, guards, role→permission map, HttpOnly host-only cookies, CSRF on cookie mutations), visitor session HTTP lifecycle (create/current/rotate/revoke with store-scoped write-through Valkey cache), consent endpoints (retrieval/update/withdrawal, append-only history + audit, purpose checks), TRUST_PROXY explicit proxy boundary. Existing catalog routes, tests and FL01 mechanisms preserved untouched. Typecheck/build/lint/unit tests PASS; PG/live e2e NOT_RUN (external runtime unavailable). See missions/FL02/ checkpoints. Not a deployment or certification.
