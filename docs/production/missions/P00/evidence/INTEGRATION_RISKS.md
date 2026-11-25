# P00-T09 — Integration Risks & Remaining Real Gates

**Date:** 2026-11-25
**Source SHA:** 14cb24a083fec83a3210d88bd1b1f942b716fb8e
**Mission:** P00 Industrial Bootstrap

## Summary

All P00 core implementation gates have passed. The monorepo structure, shared contracts, web/API/worker applications, Docker infrastructure, and CI-quality checks (lint, typecheck, test, build) are complete and passing.

The following integration points require external dependencies or services not available in the current sandbox environment. They are documented here for P05+ planning.

---

## 1. Hermes (Private Hierarchical Swarm)

### Status: NOT_INVESTIGATED (No public package)
- **Type:** Internal/private framework
- **Package:** Not published to npm
- **Integration:** Requires owner-provided package or custom implementation
- **P00 Action:** Created interface contracts in `packages/contracts` (workflow bookkeeping, customer memory)
- **Risk:** HIGH - Core swarm orchestration depends on this
- **Gate:** P05 real Hermes integration test (PASS_REAL requires Hermes runtime)

### Required for P05:
- Hermes SDK package (private)
- Discovery/Experience/Commerce/Memory/Marketing/Support capability implementations
- ToolBroker with allowlists, budgets, cancellation, delegation limits
- Private endpoint (no direct shell/SQL/Docker access)

---

## 2. Hatchet (Durable Workflow Orchestration)

### Status: PARTIALLY_INVESTIGATED
- **Package:** `@hatchet-dev/typescript-sdk` (MIT license, available on npm)
- **Server:** Requires Hatchet server (Docker image available)
- **Integration:** BullMQ worker already implements job queue patterns compatible with Hatchet
- **P00 Action:** Worker uses BullMQ with job queues (emails, sync, webhooks, projections, cleanup)
- **Risk:** MEDIUM - Migration from BullMQ to Hatchet SDK needed
- **Gate:** P05 Hatchet server + SDK integration test

### Required for P05:
- Hatchet server deployment (Docker Compose service)
- `@hatchet-dev/typescript-sdk` dependency
- Workflow definitions for durable jobs
- Separate Hatchet roles/DBs per ADR-0001

---

## 3. A2UI (Agent-to-UI)

### Status: NOT_INVESTIGATED (No stable npm package)
- **Type:** Emerging specification
- **Package:** No stable npm package found
- **Integration:** Component catalog + validated actions + AG-UI/SSE transport
- **P00 Action:** Defined Zod schemas for component registry and action validation in `packages/contracts`
- **Risk:** MEDIUM - Specification still evolving
- **Gate:** P05 A2UI component catalog registration and validation

### Required for P05:
- A2UI specification v1.0+
- Component catalog implementation
- Action validation middleware
- AG-UI/SSE transport layer

---

## 4. AG-UI (Agent-User Interface)

### Status: PARTIALLY_INVESTIGATED
- **Package:** `@ag-ui/core` (check npm availability)
- **Protocol:** SSE-based transport for agent↔UI communication
- **P00 Action:** Defined protocol types in `packages/contracts`; created transport abstraction in web app
- **Risk:** MEDIUM - Protocol stability
- **Gate:** P05 AG-UI/SSE end-to-end test

### Required for P05:
- `@ag-ui/core` dependency
- SSE endpoint in API
- Client-side connection management in web app
- Message protocol implementation

---

## 5. Hydrogen (Shopify React Framework)

### Status: DEFERRED (Per ADR-0001)
- **Package:** `@shopify/hydrogen` (v2024.x)
- **Status:** Optional - "conditional on demonstrated compatibility"
- **P00 Action:** Not added to dependencies
- **Risk:** LOW - Deferred to P02/P03
- **Gate:** P03 Hydrogen compatibility test (if adopted)

### Required for P03 (if adopted):
- `@shopify/hydrogen` + `@shopify/remix-oxygen` dependencies
- Storefront API client compatibility test
- SSR performance comparison

---

## 6. Shopify Storefront API

### Status: DEFERRED (Per ADR-0001)
- **Requirement:** Authorized Storefront token
- **P00 Action:** Fixtures when token absent; clearly labeled
- **Risk:** LOW - Fixtures sufficient for P00-P04
- **Gate:** P02 real Storefront API integration test

### Required for P02:
- Valid Shopify Storefront API token
- Shopify store domain
- Real product/collection data for testing

---

## 7. PostgreSQL / Valkey Runtime

### Status: DEFINITIONS_READY / RUNTIME_NOT_AVAILABLE
- **Docker:** Definitions complete in docker-compose.yml
- **Runtime:** Not available in current sandbox (no Docker daemon)
- **P00 Action:** All schemas, migrations, Dockerfiles, health checks created
- **Risk:** LOW - Standard infrastructure
- **Gate:** P01 real database integration test (fresh/upgrade migrations)

### Required for P01:
- Docker daemon or external PostgreSQL 18 + pgvector
- Docker daemon or external Valkey 8
- Migration test (fresh + upgrade from populated data)

---

## 8. External AI Providers (Gemini / DeepSeek)

### Status: DEFERRED
- **Packages:** Direct API keys (no SDK dependencies yet)
- **P00 Action:** Contracts defined for AI provider interfaces
- **Risk:** LOW - Can use fixtures until keys available
- **Gate:** P05 real AI provider integration test

### Required for P05:
- Valid Gemini API key or DeepSeek API key
- Provider quota/rate limit testing
- Fallback behavior verification

---

## 9. Email Infrastructure

### Status: DEFERRED
- **Package:** Resend candidate (EmailPort abstraction created)
- **P00 Action:** Email job queue defined in worker
- **Risk:** LOW - Standard infrastructure
- **Gate:** P09 real email send test (authorized test mailbox only)

### Required for P09:
- Resend API key or SMTP credentials
- Domain with SPF/DKIM/DMARC
- Authorized test mailbox

---

## 10. Real Smoke Tests (Docker)

### Status: INFRASTRUCTURE_NOT_AVAILABLE
- **Docker:** Definitions complete but daemon not in sandbox
- **P00 Action:** All docker-compose files, Dockerfiles, health checks created
- **Risk:** NONE - Standard infrastructure
- **Gate:** P10 local certification with real Docker runtime

### Required for P10:
- Docker daemon with compose v2
- Full stack startup (postgres, valkey, api, web, worker)
- Health/readiness endpoint verification
- k6 load test execution

---

## Summary Table

| Integration | Status | Risk | Required For | Real Gate |
|---|---|---|---|---|
| Hermes | NOT_INVESTIGATED | HIGH | P05 | PASS_REAL |
| Hatchet | PARTIALLY_INVESTIGATED | MEDIUM | P05 | PASS_REAL |
| A2UI | NOT_INVESTIGATED | MEDIUM | P05 | PASS_REAL |
| AG-UI | PARTIALLY_INVESTIGATED | MEDIUM | P05 | PASS_REAL |
| Hydrogen | DEFERRED | LOW | P03 (optional) | PASS_REAL |
| Shopify Storefront | DEFERRED | LOW | P02 | PASS_REAL |
| PostgreSQL/Valkey | DEFINITIONS_READY | LOW | P01 | PASS_REAL |
| AI Providers | DEFERRED | LOW | P05 | PASS_REAL |
| Email | DEFERRED | LOW | P09 | PASS_REAL |
| Docker Smoke | INFRA_NOT_AVAILABLE | NONE | P10 | PASS_REAL |

---

## Next Actions

1. **T10:** Update all checkpoint files, prepare local commit, handoff
2. **P01:** Begin with PostgreSQL/Valkey runtime setup (requires Docker daemon)
3. **P05:** Hermes/Hatchet/A2UI/AG-UI integration planning

---

## Evidence

All P00 gates PASS_REAL with evidence:
- `pnpm install --frozen-lockfile` (exit 0)
- `pnpm run lint` (exit 0, 4 packages)
- `pnpm run typecheck` (exit 0, 4 packages)
- `pnpm run test` (exit 0, 14 tests passed)
- `pnpm run build` (exit 0, 4 packages built)
- Docker definitions: `docker-compose.yml`, `.dev.yml`, `.prod.yml`, `Dockerfile`s, `init.sql`
- Dependency audit: All licenses MIT/Apache-2.0, no secrets
