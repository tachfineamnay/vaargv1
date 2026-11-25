# Handoff protocol

Use this protocol at every mission boundary and before any local commit or export.

## 1. Freeze scope and revision
Record in MISSION.md and HANDOFF.md:
- Mission ID and PRD AC IDs covered.
- Source SHA (git rev-parse HEAD at mission entry, or snapshot SHA if no Git).
- Exact changed files, migrations, contracts, configuration and dependencies.
- Tests run: command, exit code, scope, real vs simulated, evidence path, tested SHA.
- Unresolved tasks, known risks, external blockers.

## 2. Export
If authorized: create a local commit with Conventional Commits message and updated checkpoints.
Otherwise: produce a patch (git diff) or full source snapshot with manifest of changed/deleted paths and SHA-256. Exclude node_modules, .pnpm-store, .next, dist, build, coverage, .turbo, .cache, *.tsbuildinfo, secrets, dependencies and build caches.

## 3. Transfer
Provide checkpoint files with the code. Sandbox persistence is not assumed. Next agent must:
- Inspect actual cwd, git status and HEAD.
- Read all mission files from disk.
- Reconcile diff against declared changes.
- Resume next exact task from HANDOFF.md.

## 4. No automatic next mission
Handoff does not authorize starting the next mission. Owner instruction is required.

## 5. Rollback
If a delivered SHA introduces a regression or security issue, the owner may request revert to the prior delivered SHA. Keep prior checkpoints intact.
