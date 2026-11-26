# Graphify — required developer workflow

Owner decision 2026-11-26. Applies to every development and review agent, including subagents. It does not change the product PRD, runtime agent permissions, or acceptance gates.

Official project: https://github.com/Graphify-Labs/graphify
Official Python distribution: graphifyy (double y). Command: graphify.
Graphify is a dev-only dependency, not part of Node workspace, application containers or Hermes runtime.

## 1. Bootstrap in each sandbox

Check `git status`, `git rev-parse HEAD`, `graphify --version`. If Graphify is missing and local installation is permitted, use an isolated environment:
```sh
uv tool install graphifyy
# Alternatively, if pipx is available:
pipx install graphifyy
```
Use one method, not both. Record the installed version. If command is not on PATH, use the documented uv/pipx PATH instructions or `uvx --from graphifyy graphify --version`. Verify supported flags with CLI help. Do not install unverified lookalike packages, silently upgrade a working tool, or alter global Git hooks. Agent skill installation is optional because AGENTS.md already imposes the workflow. If necessary, consult the upstream platform instructions; preserve all repository rules.

At the repository root:
```sh
graphify extract . --code-only
graphify query "What are the application boundaries and key dependencies?"
```
Verify graphify-out/graph.json exists and the query actually succeeds. Code-only AST mode uses no LLM API calls. Read PRD, ROADMAP, mission checkpoints and other normative Markdown directly; do not claim this mode indexes their full semantic content.

## 2. Task loop (mandatory)

1. Read current mission checkpoints and relevant normative requirements. Verify graph matches the actual worktree; refresh after a pull, checkout, interruption or code changes.
2. Query a narrow task question, e.g. `graphify query "How do catalog imports reach PostgreSQL and Valkey?"`. Use `graphify path` or `graphify explain` with verified node names as appropriate; consult installed CLI help. Prefer bounded query output to reading the entire graph/report. Read the architecture report only for broad architectural review.
3. Verify relevant source files and test contracts directly. Graph relationships can be missing, stale or inferred; the actual source and runtime evidence are authoritative.
4. Implement the task and run meaningful available tests.
5. Run `graphify update .` after changes; if no usable graph exists, regenerate using code-only extraction. Verify success before the next task. Do not bypass protections against incomplete graphs. After deletions/refactors, verify stale nodes are removed; use documented rebuild options only after confirming the intended scope.
6. Write a compact record in PROGRESS.md or VALIDATION.md: Git HEAD and dirty-state scope, Graphify version, query, relevant paths, update command and exit status, limitations and next task. Never invent graph counts or evidence.

At mission end, update the graph and record GRAPHIFY_OK only if the graph is present, current for the actual worktree and queryable. Otherwise record GRAPHIFY_BLOCKED with cause. If installation or execution cannot be recovered, obtain owner approval before bypassing this development rule. Do not confuse graph success with runtime certification.

## 3. Privacy, cost and Git

This repository is public. Respect .gitignore and .graphifyignore; do not override them. Exclude generated artifacts, snapshots, worktrees, secrets, private evidence and real customer data. Never run cloud/semantic extraction, provider auto-detection, external database introspection, paid calls or global cross-project indexing without separate authorization. Do not feed Graphify production credentials or data.

Keep graphify-out/ and generated graph files local by default. Each sandbox builds its own deterministic code graph. Do not commit graph dumps or cached analysis; only sanitized, brief evidence is tracked. Any shared graph publication requires explicit owner approval and artifact review. No hosted CI, deployment, automatic push or automatic merge is authorized by this policy.
