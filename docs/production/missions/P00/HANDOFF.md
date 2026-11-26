# P00 handoff
Status: DELIVERED — full P00 source implemented and locally certified.

Base SHA: b0943dd8cd87626cc7c8ac20979eedc830a3d5e9
Delivered SHA: report externally after the local commit on branch feat/p00-industrial-rebuild.

## Changed / added
- Root: pnpm-workspace.yaml, pnpm-lock.yaml, turbo.json, tsconfig.base.json, eslint.config.mjs, .prettierrc.json, .npmrc, package.json, .env.example, docker-compose.yml, .dockerignore
- packages/shared: Zod contracts, env, errors, store, telemetry + tests
- apps/api: NestJS/Fastify health/readiness/version/catalog + pg/ioredis + Dockerfile
- apps/web: Next.js 16 SSR home/collections/health + Dockerfile
- apps/worker: real worker entrypoint, dependency readiness, job runner + Dockerfile
- scripts/certification: certify.sh, smoke.mjs, README.md
- docs/production/missions/P00: updated MISSION/TASKS/PROGRESS/DECISIONS/VALIDATION/HANDOFF

## Exact reproducible commands
```
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm certify
node scripts/certification/smoke.mjs   # with API+web running
```

## Unresolved (real gates for Codex)
- Docker not available in sandbox: real PostgreSQL 18 + Valkey container startup, image builds, live readiness, fault injection NOT_RUN.
- Shopify Storefront / Admin / Customer Account, Gemini/DeepSeek, Hermes/Hatchet live, A2UI/AG-UI, email — NOT_RUN (later missions).
- AC-28/29 full evidence requires real environment (P10).

## Next exact action
Codex: run real Docker certification locally (docker compose up, build images, verify /health/ready becomes ready against live DB+Valkey). No P01 work without instruction.
