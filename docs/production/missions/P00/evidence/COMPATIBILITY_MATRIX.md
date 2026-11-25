# P00-T02 — Compatibility Matrix & Licensing

**Date:** 2026-11-25
**Source SHA:** 14cb24a083fec83a3210d88bd1b1f942b716fb8e
**Mission:** P00 Industrial Bootstrap

## Verified Environment
| Component | Version | Status |
|---|---|---|
| Node.js | 24.21.0 (LTS) | ✅ Confirmed |
| pnpm | 10.6.1 | ✅ Confirmed |
| Docker | 29.8.1 | ✅ Confirmed |
| docker-compose | v5.5.1 (standalone) | ✅ Confirmed |
| OS | Windows 10 26100.9711 | ✅ Confirmed |

## Target Dependency Versions (Latest Stable/Canary as of Check)

### Runtime & Core
| Package | Version | License | Notes |
|---|---|---|---|
| TypeScript | 7.0.2 | Apache-2.0 | **Major version 7** - breaking changes vs 5.x. PRD specifies TS 5.9 strict. Decision: **pin to 5.9.x** for stability per PRD. |
| Node Types | 26.6.10 | MIT | Matches Node 24+ |

### Monorepo & Build
| Package | Version | License | Notes |
|---|---|---|---|
| Turborepo (turbo) | 2.11.13 | MIT | Stable |
| pnpm | 10.6.1 | MIT | Workspace protocol supported |

### Storefront (apps/web)
| Package | Version | License | Notes |
|---|---|---|---|
| Next.js | 16.5.0-canary.65 | MIT | **Canary** - Next.js 16 not yet stable. PRD says "Next.js 16/React 19". Decision: use canary with pinned version, document risk. |
| React | 19.3.0-canary-92bb0678-20261124 | MIT | **Canary** - React 19 not yet stable. Same as above. |
| React DOM | 19.3.0-canary-92bb0678-20261124 | MIT | Paired with React |

### API (apps/api)
| Package | Version | License | Notes |
|---|---|---|---|
| @nestjs/core | 12.6.2 | MIT | NestJS 12 (stable) |
| @nestjs/platform-fastify | 12.6.2 | MIT | Fastify adapter |
| fastify | 5.12.8 | MIT | Fastify 5 (stable) |

### Shared Contracts (packages/contracts)
| Package | Version | License | Notes |
|---|---|---|---|
| zod | 4.6.7 | MIT | Zod v4 (stable) - PRD says "Zod 4" ✅ |

### Worker (apps/worker)
| Package | Version | License | Notes |
|---|---|---|---|
| ioredis | 6.1.0 | MIT | Valkey/Redis client |
| pino | 10.4.0 | MIT | Structured logging |
| pino-pretty | 13.2.0 | MIT | Dev pretty printing |

### Data Layer (for P01+, install now for compatibility)
| Package | Version | License | Notes |
|---|---|---|---|
| drizzle-orm | 0.45.4 | Apache-2.0 | Drizzle ORM |
| pg | 8.23.1 | MIT | PostgreSQL driver |
| @types/pg | 8.23.1 | MIT | Types |
| pgvector | 0.3.1 | MIT | Vector extension |

### Tooling
| Package | Version | License | Notes |
|---|---|---|---|
| eslint | 10.15.0 | MIT | |
| @typescript-eslint/eslint-plugin | 8.74.0 | MIT | |
| @typescript-eslint/parser | 8.74.0 | MIT | |
| prettier | 3.10.1 | MIT | |
| vitest | 5.1.2 | MIT | Test runner |
| @vitest/ui | 5.1.2 | MIT | UI |
| tsx | 4.23.15 | MIT | TypeScript executor |

## Compatibility Decisions

### 1. TypeScript Version: **Pin to 5.9.x** (not 7.0.2)
- **Rationale:** PRD explicitly specifies "TypeScript 5.9 strict". TS 7.0 is a major release with breaking changes; ecosystem not ready.
- **Action:** Use `typescript@5.9.2` (latest 5.9.x) in lockfile.

### 2. Next.js 16 / React 19: **Use Canary with Pinned Version**
- **Rationale:** PRD specifies "Next.js 16 / React 19". Neither is stable yet.
- **Action:** Pin exact canary versions: `next@16.5.0-canary.65`, `react@19.3.0-canary-92bb0678-20261124`, `react-dom@19.3.0-canary-92bb0678-20261124`.
- **Risk:** Canary may have breaking changes. Document in DECISIONS.md.
- **Mitigation:** Lock versions exactly; test thoroughly in P00; upgrade only with evidence.

### 3. All Licenses: **Permissive** ✅
- MIT or Apache-2.0 only. No GPL, AGPL, or restrictive licenses.
- Compatible with commercial use and distribution.

### 4. Docker Base Images
| Image | Tag | License Check |
|---|---|---|
| node | 24-alpine | Docker Official Image (Apache-2.0 compatible) |
| postgres | 18-alpine | PostgreSQL License (permissive) |
| valkey/valkey | 8-alpine | BSD-3-Clause |

## Integration Requirements Investigation (T09 Preview)

### Hermes (Private Hierarchical Swarm)
- **Status:** No public npm package found. Private/internal framework.
- **Integration:** Requires custom implementation or owner-provided package.
- **P00 Action:** Create interface contracts in packages/contracts; stub implementation.

### Hatchet (Durable Workflow Orchestration)
- **Package:** `@hatchet-dev/typescript-sdk` (check availability)
- **Status:** Requires Hatchet server (Docker). SDK is MIT.
- **P00 Action:** Add SDK dependency; create Docker service definition; stub client.

### A2UI (Agent-to-UI)
- **Status:** Emerging spec. No stable npm package.
- **Integration:** Component catalog + validated actions + AG-UI/SSE transport.
- **P00 Action:** Define Zod schemas for component registry and action validation.

### AG-UI (Agent-User Interface)
- **Package:** `@ag-ui/core` (check availability)
- **Protocol:** SSE-based transport for agent↔UI communication.
- **P00 Action:** Define protocol types; create transport abstraction.

### Hydrogen (Shopify React Framework)
- **Package:** `@shopify/hydrogen` (v2024.x)
- **Status:** Optional per ADR-0001 ("conditional on demonstrated compatibility").
- **P00 Action:** Defer to P02/P03; do not add yet.

## Next Actions
1. Create root package.json with pnpm workspace + Turborepo config
2. Create packages/contracts with Zod v4 schemas
3. Create apps/web (Next.js 16 canary), apps/api (NestJS 12 + Fastify 5), apps/worker
4. Create Docker development infrastructure
5. Run frozen install and verify compatibility

## Evidence
- npm registry queries executed 2026-11-25
- All license checks: MIT or Apache-2.0
- Node/pnpm/Docker versions verified locally
