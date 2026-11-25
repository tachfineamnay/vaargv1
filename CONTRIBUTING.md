# Engineering workflow

## Start
Use the exact repository revision provided by the owner. Run git status --short, git rev-parse HEAD, git remote -v (redact credentials), read AGENTS.md, PRD, ROADMAP, STATUS. Do not work from an old zip without reconciliation. Mission source SHA is written before code changes.

## Branches and commits
Use short-lived branches such as feat/p00-bootstrap, feat/p04-adaptive-engine, fix/p05-tool-boundary. One authorized mission at a time; split large missions into reviewable increments. Conventional Commits (feat, fix, test, docs, refactor, chore). Keep tests/migrations/contracts in the same logical changeset. Avoid parallel edits to migrations, root lockfile, shared contracts. No force pushes or destructive resets. Main is integration/release candidate branch; no automatic deploy. Remote push/merge requires explicit owner authorization; branch protection is recommended but not configured by these files.

## Code quality
Strict TypeScript; avoid unchecked any, assertions bypassing boundaries and silent catch. Separate domain/application/adapter responsibilities. Zod at IO, explicit typed errors, no secrets in client bundles. Add tests for failure, auth, isolation, idempotence and retry when relevant. Keep money exact and timestamps UTC. Preserve backwards compatibility of API/events and SQL migrations; test upgrades from populated data. Never rewrite an applied migration.

## Fast live
Implement one useful slice, run the smallest meaningful tests, fix, checkpoint. Run the full affected gate before handoff. P00 defines actual root scripts and records supported OS/runtime versions. Use frozen lockfile and pinned images for certification. Do not claim commands have run if they do not exist. Codex independently verifies real evidence; DeepSeek performs local integration when Arena lacks Docker or network. Local/self-hosted automation is welcome; hosted CI is not authorized.

## Review and delivery
Use the [PR template](.github/pull_request_template.md). State scope, requirement IDs, source/tested/delivered SHA, changed interfaces, migrations, rollback, real vs simulated coverage, risks and blockers. A docs-only change does not pass runtime gates. Review all P0/P1 risks before release. Owner decides merge/deploy; no unapproved public traffic. See [handoff protocol](docs/production/HANDOFF_PROTOCOL.md).
