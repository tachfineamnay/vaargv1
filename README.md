# VAARG̈ V1 — Industrial Adaptive Commerce

A production-grade adaptive, international Shopify headless storefront. Shopify owns commercial transactions; VAARG owns the experience, agentic intelligence and consented customer memory.

**Status: P00 industrial bootstrap implemented and locally certified (frozen install, lint, typecheck, tests, build, live smoke). Docker and live-provider gates NOT_RUN — executed by the external harness.**

## Start here
- [AGENTS.md](AGENTS.md) — mandatory instructions for every coding agent.
- [Product requirements](docs/product/PRD.md) — normative V1 specification, AC-01–AC-30.
- [Production roadmap](docs/production/ROADMAP.md) — P00–P11.
- [Current status](docs/production/STATUS.md) — checkpoints and blockers.
- [Arena P00 prompt](docs/production/prompts/P00.md) — first implementation mission.
- [Reusable mission prompt](docs/production/prompts/NEXT.md) — subsequent missions.
- [Engineering workflow](CONTRIBUTING.md), [security](SECURITY.md), [certification](docs/production/CERTIFICATION.md).
- [Source manifest](docs/production/SOURCE_MANIFEST.md), [architecture baseline](docs/architecture/ADR-0001-baseline.md), [design handoff](docs/product/DESIGN.md).

## Target
TypeScript strict, Node 24 LTS, pnpm 10/Turborepo, Next.js/React, NestJS/Fastify, PostgreSQL/Drizzle/pgvector, Valkey, Shopify, Hermes/Hatchet, A2UI/AG-UI/SSE, Gemini or DeepSeek direct API, Docker/Coolify. Exact compatible releases must be verified and pinned in P00/P05.

Start with Storefront API; complete V1 also needs authorized customer and order access, marketing controls and real end-to-end certification. No automatic store cloning in V1.

## Build
P00 must establish reproducible install, dev, lint, typecheck, test, build and smoke commands. There is no application runtime yet. Do not assume that any command or service exists until it is implemented.

Arena implements; DeepSeek Harness integrates locally; Codex audits independently. No hosted CI or automatic production deployment. The repository is public: do not store credentials, customer records or private logs here. Licensing is not selected by this bootstrap; see [rights](docs/RIGHTS.md).
