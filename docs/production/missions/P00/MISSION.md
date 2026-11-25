# P00 — Industrial bootstrap

Status: IN_PROGRESS. Source SHA: 14cb24a083fec83a3210d88bd1b1f942b716fb8e
Normative inputs: [PRD](../../../product/PRD.md), [ROADMAP P00](../../ROADMAP.md), [AGENTS](../../../../AGENTS.md), [P00 prompt](../../prompts/P00.md), [SWARM_EXECUTION](../SWARM_EXECUTION.md). Verify [source manifest](../../SOURCE_MANIFEST.md).

Implement actual runnable web/API/worker boundaries, shared Zod contracts, strict TypeScript, reproducible pnpm/Turbo, frozen install, build/lint/typecheck/test/smoke, safe example configuration, Docker development and healthchecks. Pin stable compatible releases. Record Arena capabilities and local verification commands. Examine integration requirements without claiming live compatibility. No P01 data migrations or later business missions now. AC-28/29 partial evidence only.

Do not replace the exact PRD/roadmap or create empty package stubs. Complete TASKS before implementation. Stop at P00 delivery.

Environment at mission entry:
- Node: v24.21.0 (Node 24 LTS)
- pnpm: 10.6.1
- Docker: 29.8.1 (docker-compose v5.5.1)
- OS: Windows 10 (26100.9711)
- Git HEAD: 14cb24a083fec83a3210d88bd1b1f942b716fb8e
- No uncommitted changes
