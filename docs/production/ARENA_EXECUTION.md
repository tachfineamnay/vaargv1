# Arena execution rules — VAARG V1

Owner override: **Arena performs all source implementation P00–P11. Codex performs final local remediation and certification. DeepSeek Harness and mandatory development subagents are no longer part of the production workflow.**

## Authority and inputs
- AGENTS.md controls execution; PRD and explicit founder decisions control product scope; roadmap controls sequence.
- Read normative documents from disk before every task: AGENTS.md, docs/product/PRD.md, docs/product/DESIGN.md, docs/architecture/ADR-0001-baseline.md, docs/production/ROADMAP.md, docs/production/CERTIFICATION.md, docs/production/STATUS.md, and the current mission files.
- Do not silently change acceptance criteria. Record conflicts and obtain a decision if material.

## Disk-first memory (anti-compaction) — mandatory
1. Inspect actual cwd, git status, HEAD, remote and existing changes. Never reset or overwrite unrelated work. Read required documents from disk, not chat memory.
2. Maintain `docs/production/missions/Pxx/{MISSION,TASKS,PROGRESS,DECISIONS,VALIDATION,HANDOFF}.md` and `evidence/`. Before coding: record source SHA and PRD SHA-256; create numbered atomic tasks with dependencies.
3. Before EVERY task, read the mission files and relevant actual source. After EVERY task, including failures, update TASKS and PROGRESS, append decisions and executed-test evidence, and record the exact next action.
4. On compaction or interruption, re-read checkpoints and the actual git diff; reconcile stale notes without inventing completion. Resume the first incomplete task. Never restart completed work. A checkpoint is not a terminal delivery.
5. Keep a coherent local commit when authorized; otherwise export a patch/snapshot with changed/deleted paths and SHA-256. Report transfer BLOCKED if impossible.

## Build and verification
- Implement real vertical slices, minimal useful dependencies, strict TS, Zod boundary validation, ports/adapters. No empty pretend packages, no mock-only production routes, no canary foundations, no unresolved peer conflicts, no empty business modules, no speculative domain schemas, no meaningless assertions, no fabricated success, no production mocks.
- Follow the actual lockfile, exact stable versions, reproducible Docker. No external CI; test locally/self-hosted.
- Run available install/typecheck/lint/test/build/smoke commands and fix causes, not tests. Record exact command, environment, exit code, tested SHA, evidence and limitations.
- PASS_REAL proves only its actual scope; PASS_SIMULATED never satisfies a real integration gate. FAIL/BLOCKED/NOT_RUN are valid honest outcomes. Unavailable local gates remain BLOCKED or NOT_RUN. Do not claim VERIFIED_LOCAL.
- Continue independent tasks while external access is blocked.

## Handoff
- Update STATUS and mission files; distinguish implemented from verified. Report MISSION / SOURCE_SHA / DELIVERED_SHA, STATUS / TASKS, TESTS_REAL / TESTS_SIMULATED / FAIL / BLOCKED / NOT_RUN, ARTIFACT / CHECKPOINTS, NEXT_EXACT_ACTION / BLOCKERS.
- A local checkpoint does not authorize deployment. No remote push, merge or deployment without approval.

## P01 execution log

- **Mission**: P01 — Core Data, Identity and Isolation
- **Base SHA**: `2385a06d49976305fefa59c8d188357720a659e1` (P00 merged, PR #2)
- **PRD SHA-256**: `7e49d94144b4fd24b8968652664c354d5d8949946d9d9773c8314cbb630f8596`
- **Branch**: `arena/c1eaf44b-vaargv1`
- **Scope**: 13 implementation items delivered in `packages/persistence`.
- **Auth**: REAL argon2id merchant authentication (@node-rs/argon2); no mock/bypass.
- **Isolation**: RLS (17 policies) + restricted `vaarg_app` role (NOBYPASSRLS) +
  per-transaction SET LOCAL store context; composite store_id FKs.
- **Migrations**: 2 versioned files; idempotent runner.
- **Tests**: typecheck/build/unit PASS_REAL; 10 real-PG integration tests written,
  gated on DATABASE_URL. Docker/PG unavailable in sandbox → real DB gates NOT_RUN.
- **Result**: SOURCE DELIVERED. No push/merge/deployment performed.
