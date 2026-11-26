# P00 integration risk register (T10)

Reviewed against actual official sources (GitHub repos / official docs) on 2026-11-26.
No runtime compatibility is claimed unless executed. No API contracts are invented.

## Hermes (master swarm) — source: github.com/NousResearch/hermes-agent, hermes-agent.nousresearch.com/docs
- Official model: Hermes is a self-improving agent with a tool registry organized into
  toolsets (browser, terminal, file, web, delegation, memory, cronjob, code_execution, etc.).
  Delegation is a core toolset: `delegate_task` spawns subagents in isolated contexts, each
  with its own conversation, terminal session and toolset, returning only a final summary.
- Constraint for VAARG: Hermes master-with-specialists delegation maps to the `delegation`
  toolset. ToolBroker confinement must align with Hermes toolset gating (capability-gated
  tools appear only when backend/credential prerequisites are configured). No second swarm.
- P00 status: NOT_RUN. No Hermes runtime/SDK in sandbox. Risk: delegation limits, nesting rules,
  budget and cancellation semantics unproven on the exact image. Validate in P05.

## Hatchet (durable orchestrator) — source: github.com/hatchet-dev/hatchet, @hatchet-dev/typescript-sdk
- Official model: Hatchet is a distributed, fault-tolerant, durable workflow engine.
  Self-hostable on Docker + PostgreSQL (Postgres is mandatory — no Redis backend).
  SDKs for Go, Python, TypeScript, Ruby. Provides workflow orchestration, retries,
  scheduling, event-driven triggers, cron, multi-tenancy, observability.
- Constraint for VAARG: Hatchet owns durable jobs. The TypeScript SDK is the integration path.
  Postgres is required — consistent with VAARG's PostgreSQL-first durable state.
- P00 status: config wired but DISABLED (HATCHET_ENABLED=false). No BullMQ, no competing
  framework. Full workflow integration is a later mission. Risk: SDK API surface and resume
  behavior unproven locally; requires a real Hatchet instance + Postgres.

## A2UI (generative UI spec) — source: github.com/a2ui-project/a2ui
- Official model: A2UI is an open-source generative UI framework — a protocol for streaming
  dynamic UI at low latency, with native renderers (React, Angular, Lit, Flutter, SwiftUI,
  Jetpack Compose) and agent SDKs (Python, TypeScript). It is a *generative UI spec*: it
  describes what UI an agent wants to show.
- Constraint for VAARG: A2UI supplies the component catalog and validated actions. Only
  registered components and validated actions are allowed (PRD invariant). Catalog validation
  is a first-class A2UI feature (a2ui-core catalog validation).
- P00 status: NOT_RUN. No A2UI catalog or renderer introduced in P00 (P05 scope). Risk: catalog
  registration, payload-size and injection rejection unproven; contract tests required.

## AG-UI (runtime transport protocol) — source: github.com/ag-ui-protocol/ag-ui
- Official model: AG-UI is the open Agent-User Interaction Protocol — an event-based runtime
  protocol that carries agent events (and generative-UI payloads such as A2UI) between agent
  and app. AG-UI 1.0 has a stable, frozen specification backed by a JSON Schema; SDKs for
  TypeScript, Python, .NET. Works over any transport (SSE, WebSockets, webhooks).
- Constraint for VAARG: AG-UI/SSE is the transport; A2UI is the payload it carries. AG-UI is
  complementary to MCP (tools) and A2A (agents). Stale-stream rejection is a runtime concern.
- P00 status: NOT_RUN. No AG-UI bridge in P00 (P05 scope). Risk: event types, SSE transport and
  stale-stream rejection unproven; requires contract + E2E tests.

## Hydrogen (Shopify headless) — source: github.com/Shopify/hydrogen
- Official model: Hydrogen is Shopify's toolkit for headless storefronts — typed Storefront
  API client (gql), request handlers (cart, checkout, Storefront proxy), cart, products,
  collections. Calendar versioning (2026.10.x current). Framework-independent core with React
  and Vue bindings; runs on Oxygen, Node, Vercel, Cloudflare Workers, Deno.
- Constraint for VAARG: ADR-0001 makes Hydrogen conditional on demonstrated compatibility.
  Shopify Storefront API is the commerce authority. Hydrogen is an option, not a requirement.
- P00 status: NOT_RUN. Web uses Next.js App Router; Hydrogen not introduced. Risk: if selected
  later, Storefront API versioning, caching and streaming compatibility must be proven.

## Remaining real gates (for Codex / later missions)
1. Docker image builds + container startup for web/api/worker.
2. Live PostgreSQL 18 (+ pgvector `vector` extension) + Valkey readiness.
3. Shopify Storefront authorized reads + test checkout.
4. Hermes delegation/confinement negative tests on the exact image.
5. Hatchet workflow resume / inbox / outbox against real Postgres.
6. A2UI catalog validation + AG-UI stale-stream rejection.
7. Real AI inference traces (Gemini/DeepSeek direct keys, no implicit fallback).
8. Backup/restore and rollback (AC-28).
9. Secret/artifact scans (AC-29).
