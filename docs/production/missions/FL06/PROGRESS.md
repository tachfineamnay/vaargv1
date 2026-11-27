# FL06 Progress

- **2026-11-27**: Verified source base `5c4731f74639eefe85f6a4e3921c2b9a3d08b422` (`main`), `docs/product/PRD.md` SHA-256 `7e49d94144b4fd24b8968652664c354d5d8949946d9d9773c8314cbb630f8596`, and Graphify CLI check (`GRAPHIFY_BLOCKED`, exit 127).
- **2026-11-27**: Pinned upstream `NousResearch/hermes-agent@v0.23.4` (`8fc0374447313e276f6b9a2764bfc750190c966a`) and `@hatchet-dev/typescript-sdk@1.49.1`.
- **2026-11-27**: Implemented `@vaarg/shared` contracts (`intelligence.ts`, `specialists.ts`, `tool-broker.ts`, `workflows.ts`), forward migration `packages/persistence/migrations/0014_intelligence_domain.sql` (11 store-scoped RLS tables + `purge_expired_intelligence`), and Drizzle schema `packages/persistence/src/schema/intelligence.ts`.
- **2026-11-27**: Implemented `@vaarg/persistence` modules (`bridge-ticket.ts`, `provider-policy.ts`, `hermes-adapter.ts`, `intelligence-repository.ts`, `workflow-repository.ts`, `hatchet-config.ts`, `hatchet-dispatcher.ts`).
- **2026-11-27**: Extended `ExperienceService` and implemented `@vaarg/api` `IntelligenceModule` (`ToolBrokerService`, `HermesBridgeController` HTTP guard + MCP JSON-RPC, `ConversationService`, `ConversationController`).
- **2026-11-27**: Implemented `@vaarg/worker` Hatchet SDK integration (`hatchet-workflows.ts`, `hatchet-worker-host.ts`) registering only the 3 real workflows (`vaarg.catalog.sync`, `vaarg.embeddings.refresh`, `vaarg.experience.retention_cleanup`) while preserving `JobRunner`.
- **2026-11-27**: Added confined Hermes deployment artifacts (`deploy/hermes/Dockerfile`, `deploy/hermes/config.yaml`, `deploy/hermes/plugins/vaarg-confinement/`) and updated `.env.example`, `docker-compose.dev.yml`, `docker-compose.prod.yml`, and `deploy/README.md`.
- **2026-11-27**: Executed full monorepo `pnpm build` (5/5 PASS), `pnpm typecheck` (7/7 PASS), `pnpm lint` (5/5 PASS), and `pnpm test` (7/7 PASS; real PostgreSQL/Docker/Hermes/Hatchet/provider runtime gates `NOT_RUN` in sandbox).
