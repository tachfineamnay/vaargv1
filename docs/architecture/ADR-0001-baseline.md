# ADR-0001 — V1 architecture baseline
Status: accepted design direction; implementation compatibility unverified.
Date: 2026-11-25.

Use a modular TypeScript monorepo (web/API/worker), Node 24 LTS/pnpm 10/Turborepo, Next.js 16/React 19, NestJS/Fastify, Zod 4, PostgreSQL 18/Drizzle, Valkey. Pin exact releases and test compatibility. Shopify is transaction authority; Storefront API first, Admin/Customer Account later in the same V1. Hydrogen SDK conditional on demonstrated compatibility. Domain ports isolate providers. Market context is explicit.

Hermes is the master with Discovery/Experience/Commerce/Memory/Marketing/Support capabilities; Hatchet owns durable jobs. AI SDK optional adapter/auxiliary, not competing orchestrator. Gemini/DeepSeek direct keys initially; no implicit fallback. A2UI catalog and AG-UI/SSE bridge must be proven. PostgreSQL owns durable customer profile/provenance, consent, purchase projection and workflow bookkeeping. Valkey owns short-lived context. Search uses FTS/trigram/vector; no external search service by default.

Store ID and configuration are first-class. Prove isolation with two synthetic stores, not a multi-merchant SaaS implementation. No live store duplication or second commerce engine in V1. Docker/Coolify and local/self-hosted certification only.

Rationale: product continuity, low latency, explicit authority, recoverable workflows, independent commerce and AI adapters. Alternatives deferred: Kubernetes, autonomous unbounded swarm, extra vector DB, separate microservices, custom checkout. Exact versions, performance, licensing and external permissions remain verification gates.

Normative detail: [PRD](../product/PRD.md). New material architectural decisions require an ADR with context, alternatives, decision, consequences, validation and owner approval where scope changes.
