# Production status — VAARG̈ V1

As of 2026-11-26: P00 clean industrial bootstrap IMPLEMENTED (clean-room rebuild, no reuse of previous P00 code) and locally certified. Frozen install, lint, typecheck, tests, build and live smoke all PASS_REAL. Docker and live-provider gates remain NOT_RUN and are executed by Codex.

| Mission | Implementation | Verification |
|---|---|---|
| P00 Bootstrap | DONE (clean-room) | PASS_LOCAL_SOURCE (Docker/live NOT_RUN) |
| P01 Core data / identity / isolation | SOURCE DELIVERED | Real DB gates NOT_RUN |
| P02 Shopify / catalogue | TODO | NOT_RUN |
| P03 Storefront / design | IN PROGRESS (FL04 source delivered) | PASS_LOCAL_SOURCE (Docker/live NOT_RUN) |
| P04 Adaptive search / experience | SOURCE DELIVERED (FL05 + FL05-FIX) | PASS_LOCAL_SOURCE (Docker/live NOT_RUN) |
| P05 Hermes / A2UI / AG-UI | SOURCE DELIVERED (FL06 + FL07) | PASS_LOCAL_SOURCE (Docker/live NOT_RUN) |
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

## FL03 — industrial Shopify catalog engine (source delivery)

Application boundaries repaired (CatalogService on NestDI: injected MerchantAuthService + TenantContextResolver, no manual auth instantiation, CSRF on every cookie-capable catalog mutation, legacy /catalog preserved). Shopify adapter extended with verified 2026-10 Storefront fields (variant sku/position/compareAtPrice/image/quantityAvailable/currentlyNotInStock, product publishedAt) under additive shared contracts; CommercePort remains the provider-independent seam for future cart/checkout. New forward-only migration 0010: normalized store+market-scoped projection (products, variants with exact numeric prices, media, configured attributes, collections, membership, search documents) with RLS + vaarg_app grants, synchronized transactionally inside the existing import checkpoint (lease/CAS/receipts preserved), generation-scoped reconciliation at sweep completion. /v1/catalog API: products/collections/variants/filters/compare/related/search/status + authorized sync commands, bounded validated cursors, deterministic sorts, curated Zod DTOs, explicit NOT_CONFIGURED/NOT_SYNCED/IN_PROGRESS/STALE/FRESH. Deterministic trigram lexical search over rebuildable hashed documents; agent knowledge facade (searchCatalog/getProduct/getVariant/compareProducts/getCompatibleOptions/getRelatedProducts) with compatibility literally UNKNOWN. Typecheck/build/lint/unit tests PASS; PG/live/Docker gates NOT_RUN (sandbox lacks PostgreSQL/Docker/provider access). See missions/FL03/. Not a deployment or certification.

## FL04 — industrial storefront (P03 source delivery, 2026-11-26)

Shared contracts hardened (v1 attribute wire format `name:value` first-colon split; strict detail responses extended with market freshness `{status, completedAt, generation}`; filters accept `collection`). Web foundation: 14-kind StorefrontError taxonomy, validated storefront-host resolution (loopback-only `x-forwarded-host`), node:http transport with explicit `Host` + per-call request ids + timeout/network mapping, typed 13-method catalog client, URL-authoritative list params with validated api/form split and deterministic comma cursor trails, i18n/SEO/editorial/section composition. Pages: home (per-section honest states + adaptive boundary), products with GET filter/sort form, product detail (cache()-shared metadata, variant `?variant=` sync, JSON-LD, related + compatibility provenance), collections (+scoped products), lexical search, compare (`?ids=` authoritative), preferences (real session/consent surfaces — identity-required403 shown, never faked), health, sitemap, robots, 404/error/loading states. Constrained same-origin BFF (`/api/session`, `/api/session/rotate`, `/api/consent`): fixed paths, strict bodies (no browser-supplied customerId/source), Origin enforcement on mutations, visitor-cookie-only forwarding, constructed `https://<host>` upstream Origin, Set-Cookie relay. Verification: `turbo lint typecheck build test --force` 20/20 tasks PASS; web 47/47 tests in 5 files; production-build live smoke vs stub API 49/49 PASS (evidence under `missions/FL04/`). Docker/PostgreSQL/Valkey/live Shopify gates NOT_RUN (sandbox lacks binaries); graphify BLOCKED (command not found). Not a deployment or certification. See missions/FL04/ checkpoints.

## FL05-FIX targeted consolidation (2026-11-27)
FIX01–FIX09 source implemented from a94deb2745fc3e3923dcc8527f7d25123e2fda4e.
Four affected typechecks and 77 focused tests pass (SQL/capability tests simulated);
3 real PostgreSQL gates NOT_RUN. Forward 0013/provider reindex and real
PostgreSQL/pgvector/Valkey/provider verification remain operator gates.
Checkpoints: `docs/production/missions/FL05-FIX/`. No FL06 implementation or deployment.

## FL06 — confined Hermes multi-agent runtime & Hatchet durable orchestration (source delivery, 2026-11-27)
Implemented from `5c4731f74639eefe85f6a4e3921c2b9a3d08b422` (`main`). Pinned `NousResearch/hermes-agent@v0.23.4` (`8fc0374447313e276f6b9a2764bfc750190c966a`) behind `AgentPort` (`HermesAgentAdapter`) and `@hatchet-dev/typescript-sdk@1.49.1` behind `WorkflowOrchestrationPort` (`HatchetWorkflowDispatcher` + worker host). Forward migration `0014_intelligence_domain.sql` adds 11 store-scoped RLS tables (`conversations`, `agent_prompt_versions`, `provider_policies`, `agent_policies`, `agent_runs`, `messages`, `conversation_summaries`, `tool_invocations`, `model_usage`, `action_proposals`, `workflow_executions`) with `FORCE ROW LEVEL SECURITY`, `vaarg_app` grants, and `purge_expired_intelligence`. Enforces bounded `Master -> Specialist` hierarchy (`depth <= 1`, `maxConcurrentChildren <= 3`, zero grandchildren) across 7 explicit roles (`master`, `discovery`, `experience`, `commerce`, `memory`, `marketing`, `support`), preventive shared parent+child PostgreSQL budget reservations, direct-only Gemini API & DeepSeek API policies (`allowImplicitFallback: false`), server-owned `ToolBroker` over FL05-FIX `ExperienceCapabilities` + private authenticated bridge/MCP (`/internal/v1/*`), CAS `expectedContextVersion` composition publishing, private confined Hermes deployment (`deploy/hermes/`), and 3 real Hatchet workflows (`vaarg.catalog.sync`, `vaarg.embeddings.refresh`, `vaarg.experience.retention_cleanup`). Verification: `pnpm build` (5/5), `pnpm typecheck` (7/7), `pnpm lint` (5/5), and `pnpm test` (7/7) PASS; live Docker/PostgreSQL/Valkey/Hermes/Hatchet/provider gates NOT_RUN (`GRAPHIFY_BLOCKED`). Not a deployment or commercial certification. See `docs/production/missions/FL06/`.

## FL07 — agentic storefront, A2UI 1.0 & AG-UI 1.0.5 streaming (source delivery, 2026-11-27)
Implemented from `206c9aff23b0fa714b583ef18ea62a64e02104cf` (`main`) on `arena/a0dd7ed0-vaargv1`. Includes Task 0 FL06 hardening (`GET /v1/agent/runs/:runId/result` strictly non-mutating + idempotent `POST /v1/agent/runs/:runId/publish`, child specialist provider/model resolved by `HermesBridgeController.registerSubagentStart` with zero Python Gemini fallback, bounded Hatchet catalog continuation auto-dispatch + `continuation_required` status preservation, and out-of-band HMAC-SHA256 `vaarg-confinement@1.1.0` runtime attestation). Pinned official `@ag-ui/core@1.0.5` and `@ag-ui/encoder@1.0.5`. Forward migration `0015_fl07_agentic_surfaces_and_streams.sql` adds store-scoped RLS table `agent_run_stream_events` (`UNIQUE (store_id, run_id, event_seq)`) for `Last-Event-ID` cursor replay and `vaarg.run.v1.resync_required` snapshot recovery, separating transport disconnect from `POST /v1/agent/runs/:runId/cancel`. Delivers deterministic A2UI `1.0` compiler (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`), server+client fail-closed DAG/pointer/XSS/RPC validator, 10 active VAARG React 19 A2UI catalog adapters + 5 typed FL08–FL10 future contracts, 12 constrained same-origin Next.js BFF routes (unbuffered `node:http` SSE relay), persistent `PersonalShopperDrawer`, monotonic `ExperienceContext` synchronization (`vaarg.context.v1.sync`), and controlled `POST /v1/agent/actions` (`UNAVAILABLE_IN_CURRENT_PHASE` for FL08–FL11 mutations). Verification: `pnpm build` (5/5), `pnpm typecheck` (7/7), `pnpm lint` (5/5), and `pnpm test` (7/7, 231 passed) PASS_REAL; live Docker/PostgreSQL/Valkey/Hermes/Hatchet/provider gates NOT_RUN (`GRAPHIFY_BLOCKED`). Not a deployment or commercial certification. See `docs/production/missions/FL07/`.


