# P00 integration risk register (T09)

Examined requirements only. No runtime compatibility claimed unless executed in this sandbox.

## Hermes (master swarm)
- Required: hierarchical delegation with bounded parallel specialists, tool confinement, budgets/cancellation.
- P00 status: NOT_RUN. No Hermes runtime or SDK in sandbox. Port boundary left open in worker/job-runner; no second swarm created.
- Risk: delegation/confinement semantics unproven; must be validated on the exact image before P05 activation.

## Hatchet (durable orchestration)
- Required: durable workflows, resume, inbox/outbox.
- P00 status: wired as explicit config (HATCHET_URL/HATCHET_TOKEN/HATCHET_ENABLED) but DISABLED by default. No BullMQ, no fake jobs.
- Risk: Hatchet SDK compatibility and resume behavior unproven locally; requires real Hatchet instance.

## A2UI / AG-UI (agent UI + SSE)
- Required: registered components, validated actions, stale-stream rejection, AG-UI/SSE transport.
- P00 status: NOT_RUN. No A2UI catalog or AG-UI bridge implemented in P00 (P05 scope).
- Risk: component catalog and stream validation unproven; contract tests required before P05.

## Hydrogen (Shopify headless)
- Conditional on demonstrated compatibility per ADR-0001.
- P00 status: NOT_RUN. Web uses Next.js App Router; Hydrogen not introduced.
- Risk: if selected later, storefront caching/streaming compatibility must be proven; no premature dependency.

## Shopify (commerce authority)
- Required: Storefront API first; Admin/Customer Account later in same V1.
- P00 status: NOT_RUN. No Shopify credentials or calls. .env.example exposes placeholder slots only.
- Risk: token scopes, protected customer data, webhook idempotency unproven; real test checkout required (P06, authorized).

## PostgreSQL 18 / Valkey
- P00 status: clients implemented (pg, ioredis) with real readiness probes; containers defined (postgres:18-alpine, valkey/valkey:8-alpine). Live readiness NOT_RUN in sandbox (no Docker).
- Risk: RLS, outbox/inbox, restore (AC-27/28) require real DB (P01/P10).

## Gemini / DeepSeek
- Required: direct keys, no implicit fallback.
- P00 status: NOT_RUN. No AI provider wired. .env.example exposes placeholder slots only.
- Risk: model/cost/quota and fallback policy unproven; must be validated before P05.

## Remaining real gates (must be executed by Codex / later missions)
1. Docker image builds + container startup for api/web/worker.
2. Live PostgreSQL 18 + Valkey readiness (/health/ready -> ready).
3. Shopify Storefront authorized reads + test checkout.
4. Hermes delegation/confinement negative tests.
5. Hatchet resume/inbox/outbox.
6. A2UI validation + AG-UI stale-stream rejection.
7. Real AI inference traces.
8. Backup/restore and rollback (AC-28).
9. Secret/artifact scans (AC-29).
