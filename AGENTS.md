# AGENTS.md — VAARG̈ V1

## Mission and authority
Build one industrial product, not a demo. Read [PRD](docs/product/PRD.md), [ROADMAP](docs/production/ROADMAP.md), [STATUS](docs/production/STATUS.md) and the authorized mission files. The PRD and later explicit founder decisions control product scope; roadmap controls sequence; this file controls execution. Conflicts: record them and obtain a decision if material. Do not silently change acceptance criteria. Do not start the next mission without instruction.

## Mandatory disk-first memory (anti-compaction)
Owner decision 2026-11-26: no separate transfer/termination document or stage. Use the five checkpoint files and evidence only; PROGRESS.md records the next exact task. Continue coding until the authorized mission is implemented or an actual blocker prevents further independent work. Arena builds P00–P11 cumulatively; Codex performs final local correction and certification. This supersedes older procedural instructions, not product scope or acceptance criteria.
1. Inspect actual cwd, git status, HEAD, remote and existing changes; never reset user work. Read the required documents from disk, not chat memory.
2. Before any code, create/update docs/production/missions/Pxx/{MISSION,TASKS,PROGRESS,DECISIONS,VALIDATION}.md and evidence/. Freeze scope, source SHA and PRD hash. Make numbered tasks and dependencies.
3. Before EVERY task read the mission files and relevant code. After EVERY task, including failures, update TASKS and PROGRESS, append decisions and executed-test evidence as applicable. Record exact next action. Checkpoint before context compression, exit or task interruption.
4. On resume, reread files and actual diff; reconcile stale notes without inventing completion. The filesystem and Git are the working memory, not the chat. Keep checkpoints with code in the cumulative source. Verify the actual revision before the next mission.
5. Keep a coherent local commit when authorized; otherwise export patch/snapshot with changed/deleted paths and SHA-256. Report transfer BLOCKED if impossible. Never push automatically, force-push, reset --hard, clean destructively or overwrite unrelated work.

## Mandatory Graphify-first development
Graphify is required for every coding, architecture, review, debugging and certification agent (Arena, Codex, DeepSeek, Claude, Gemini and any subagent). Follow [the Graphify workflow](docs/production/GRAPHIFY.md). This is developer tooling, not a VAARG runtime dependency.
- At mission entry and after checkout/pull/compaction: verify the actual Git revision and Graphify version; build or refresh the local code graph before exploring application source.
- Before EVERY implementation or audit task: run a focused `graphify query`, use `graphify path` or `graphify explain` where helpful, then open the exact referenced source and normative documents. Never replace source verification with graph inference.
- After each coherent code change/task, run `graphify update .` before the next query or checkpoint. Record graph status, command/exit code, revision and concise findings in existing PROGRESS/VALIDATION files, not a separate handoff.
- Default to local AST-only extraction (`graphify extract . --code-only`); no API keys, semantic cloud extraction, external source uploads, paid fallback or production data.
- Missing Graphify, failed extraction or unusable/stale graph: attempt permitted local remediation; record GRAPHIFY_BLOCKED and request owner approval for any temporary bypass. Do not silently skip the graph or invent results. Other unavailable provider gates follow normal mission rules.
- Ignore generated graph output, caches, secrets and nested worktrees. Never publish raw graph artifacts to this public repository without explicit review and approval.

## Build and verification
Implement real vertical slices, minimal useful dependencies, strict TS, Zod boundary validation, ports/adapters; no empty pretend packages or mock-only production routes. Follow the actual lockfile, exact stable versions, reproducible Docker. No external CI; test locally/self-hosted. Run available install/typecheck/lint/test/build/smoke commands and fix causes, not tests. Record exact command, environment, exit code, tested SHA, evidence and limitations. PASS_REAL proves only its actual scope; PASS_SIMULATED never satisfies a real integration gate. FAIL/BLOCKED/NOT_RUN are valid honest outcomes. Continue independent tasks while external access is blocked. See [certification](docs/production/CERTIFICATION.md).

## Product invariants
- Shopify is authoritative for products/prices/stock/cart/orders/payment. Storefront first; Admin and Customer Account access required for full V1. Never fabricate transactions, identity, engraving or availability.
- Preserve existing premium design; SSR and conventional navigation must work without AI. Behavior and conversation share context; keep scroll/focus/cart stable. Reject stale compositions. A2UI only registered components and validated actions; AG-UI/SSE transport.
- Hermes is the private hierarchical swarm; Hatchet is durable workflow orchestration. No second swarm. ToolBroker enforces all permissions, budgets, cancellation and delegation limits on the server. No arbitrary terminal, SQL, browser, host files or Docker socket. No hidden paid fallback.
- Persistent customer memory, provenance, negative preferences, purchase projection, CRM and personalized newsletters are V1 requirements. Separate explicit facts from inferences and gifts from personal tastes. Enforce per-purpose permissions, deletion, unsubscribe, merchant approval and send-time checks.
- Store isolation everywhere: DB constraints and runtime role, cache keys, sessions, tools, jobs, evidence. No cross-store PII or copying customer memory during future duplication. No hardcoded pilot behavior in core.

## Security and Git
This is a public repository. Never commit real secrets, customer data, raw transcripts, private endpoints or unredacted artifacts. Synthetic fixtures only in Arena. Real provider tests only with authorized local secrets. No production mutations, email sends, billing changes, deploys, merges or remote pushes without explicit authorization. Use short mission branches and Conventional Commits; keep main releasable. Follow [CONTRIBUTING](CONTRIBUTING.md) and [SECURITY](SECURITY.md).

## Final mission report
Update STATUS and mission files; distinguish implemented from verified. Give only MISSION / SOURCE_SHA / DELIVERED_SHA (or NO_GIT), STATUS / TASKS, TESTS_REAL / TESTS_SIMULATED / FAIL / BLOCKED / NOT_RUN, ARTIFACT / CHECKPOINTS, NEXT_EXACT_ACTION / BLOCKERS. A local checkpoint does not authorize deployment.
