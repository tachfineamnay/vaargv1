# P00 — Clean industrial bootstrap

Status: IN PROGRESS. Clean-room rebuild from the original documentation baseline.
Source SHA at mission entry: `626c426002e34eb1d3ac3f4b7f6898cfc2d92676`.
PRD SHA-256: `7e49d94144b4fd24b8968652664c354d5d8949946d9d9773c8314cbb630f8596`.

Normative inputs: [PRD](../../../product/PRD.md), [ROADMAP P00](../../ROADMAP.md), [AGENTS](../../../../AGENTS.md), [P00 prompt](../../prompts/P00.md), [ARENA_EXECUTION](../../ARENA_EXECUTION.md). Verify [source manifest](../../SOURCE_MANIFEST.md).

## Scope
Clean-room implementation of the P00 industrial bootstrap: monorepo, shared Zod contracts, web, API, worker, infrastructure, verification. No reuse of previous P00/P00-BIS application code (preserved in git history). No P01 business features. AC-28/29 partial evidence only.

## Invariants
- Shopify is transaction authority; no invented products or prices.
- Hermes/Hatchet remain the approved future runtime architecture. No BullMQ or competing frameworks. Full workflow integration is later missions.
- No canary foundations, no unresolved peer conflicts, no empty business modules, no speculative domain schemas, no fabricated success, no production mocks.
- Local/self-hosted validation only. No secrets, no remote push/merge/deploy without approval.
