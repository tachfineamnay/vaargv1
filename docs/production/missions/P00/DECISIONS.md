# P00 decisions
- Baseline architecture follows PRD and ADR-0001; actual versions and compatibility remain to verify.
- Documentation and application implementation are separate: no runtime claims from bootstrap.
- Local/self-hosted validation only. Public repository; synthetic evidence only.
- Swarm execution rules persisted in docs/production/SWARM_EXECUTION.md.
- Source SHA for mission: 14cb24a083fec83a3210d88bd1b1f942b716fb8e
- Monorepo structure: apps/web, apps/api, apps/worker, packages/contracts.
- Package manager: pnpm 10 with Turborepo.
- Node: 24 LTS (v24.21.0 confirmed).
- Docker: docker-compose v5.5.1 (standalone binary, not docker compose plugin).

Append task ID, decision, rationale, alternatives, impact, verification and approval for material changes. Do not invent founder approval.
