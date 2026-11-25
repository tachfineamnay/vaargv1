# Disk-first execution and handoff

Required for Arena, DeepSeek Harness and Codex. [AGENTS.md](../../AGENTS.md) is mandatory.

## Before each mission
Verify exact repo, branch, base SHA, dirty worktree and tool availability. Read PRD and roadmap completely on first entry; reread relevant sections and all mission files before each task. Record source hashes. Do not assume persistent sandbox, Docker, network, access tokens, write or export capability.

## Working files
MISSION.md: immutable scope/invariants plus source SHA/approved changes.
TASKS.md: numbered checklist and dependencies; TODO / IN_PROGRESS / IMPLEMENTED / VERIFIED / BLOCKED.
PROGRESS.md: append chronological checkpoints after every task, actual changed files and next command.
DECISIONS.md: rationale, alternatives, impact and owner decision when needed.
VALIDATION.md: one row per test with ID, AC, environment, tested SHA, command, exit code, status, evidence, limitations.
HANDOFF.md: base, changes, migrations, lockfile, commands, missing secrets (names only), remaining work, exact next action.
evidence/: small sanitized evidence only; raw logs and real customer data remain outside Git.

Before compression or stop, write and verify the checkpoint. Reopen it on resume and inspect Git diff; reconcile contradictions. A task is not done because a chat message says so. Update global STATUS.

## Export and integration
Local commit if authorized, report SHA separately. If remote push is authorized, verify target and head; otherwise export patch or source snapshot with base SHA, paths added/modified/deleted and checksum. Exclude dependencies, caches, secrets, raw logs and real data. Verify export actually exists. If export unavailable, report BLOCKED. Local integrator checks base and diff, applies without replacing unrelated work, runs real tests and updates evidence. Independent auditor verifies critical scenarios against exact candidate revision. If candidate changes, rerun affected gates. No automatic next mission.
