# Swarm Execution Rules — VAARG V1 P00

**Authority:** Lead architect owns architecture, shared contracts, root config, lockfile, integration.
**Mode:** Collaborative swarm / build first.
**Max concurrent subagents:** 3 initially.
**Model policy:** Best authorized free model per task. No paid models, no paid fallbacks.
**Quota errors:** Checkpoint and pause or use another verified free route. No retry storms.

## Task Delegation
- Delegate independent tasks only.
- Assign exclusive file ownership per subagent.
- Lead independently reviews all subagent changes.
- Avoid duplicate work and unnecessary discussion.
- Subagents report: task, files changed, commands run, exit codes, evidence, blockers.

## Anti-Compaction (from AGENTS.md)
- Read all mission files before every task.
- Write all mission files after every task.
- Resume from files and actual Git state.
- Lead maintains canonical task ledger.
- Checkpoint before context compression, exit or handoff.

## P00 Scope (from ROADMAP.md)
- Node 24 LTS, pnpm 10, TypeScript 5.9 strict.
- Turborepo monorepo.
- Next.js 16 / React 19 storefront (web).
- NestJS / Fastify API.
- Executable worker.
- Shared Zod contracts (packages/contracts).
- Environment validation.
- Docker development infrastructure.
- Health and readiness endpoints.
- Root lint, typecheck, test and build scripts.
- Reproducible lockfile.
- Local smoke tests.
- Verify exact stable dependency compatibility.
- Investigate Hermes, Hatchet, A2UI, AG-UI integration requirements without inventing support.
- No empty packages or fake business features.
- Do not implement later missions (P01+).
- Run frozen install, lint, typecheck, tests, builds and available Docker runtime checks.
- Fix actual defects. Never bypass failing tests.
- Record commands, exit codes and real evidence.
- Deliver clean local mission commit.
- Update STATUS.md and all checkpoints.
- No hosted CI, remote push, merge or deployment.

## File Ownership Map
| Area | Owner |
|---|---|
| Root config (package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json) | Lead |
| packages/contracts (Zod schemas, types) | Lead |
| apps/web (Next.js) | Subagent-web |
| apps/api (NestJS/Fastify) | Subagent-api |
| apps/worker (Node worker) | Subagent-worker |
| Docker (docker-compose.yml, Dockerfile.*) | Lead |
| Root scripts, lint, typecheck, test, build | Lead |
| Mission checkpoints | Lead |

## Subagent Spawn Protocol
1. Lead creates task with exclusive file scope.
2. Subagent reads all mission files + relevant code.
3. Subagent implements, runs checks, writes evidence.
4. Subagent updates TASKS.md, PROGRESS.md, VALIDATION.md.
5. Lead reviews diff, runs integration checks.
6. Lead updates canonical ledger.

## Evidence Requirements
- Every test run: command, exit code, stdout/stderr tail, tested SHA.
- PASS_REAL only for executed test against required real components.
- PASS_SIMULATED for executed fixtures/doubles.
- FAIL/BLOCKED/NOT_RUN are valid honest outcomes.
- Evidence stored in docs/production/missions/P00/evidence/ with SHA reference.

## Final Report Format
```
MISSION / SOURCE_SHA / DELIVERED_SHA
STATUS / IMPLEMENTED_TASKS / REMAINING_TASKS
TESTS_REAL / TESTS_SIMULATED / FAIL / BLOCKED / NOT_RUN
ARTIFACT_OR_PATCH / CHECKPOINT_PATHS
NEXT_EXACT_ACTION / EXTERNAL_BLOCKERS
```
