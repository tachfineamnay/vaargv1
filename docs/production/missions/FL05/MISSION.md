# FL05 — Adaptive Experience and Hybrid Search Engine

Source SHA at entry: ea65c4de36280f967982c6acab550508ad7b9f85 (main baseline, verified).
Branch: arena/073fb5c0-vaargv1 (work branch; one PR to main at delivery, no merge).
GRAPHIFY_BLOCKED: `graphify` command not found (exit 127, one remediation attempt); direct source
navigation authorized per mission order. No graph results claimed.

Scope: deterministic adaptive intelligence foundation — provider-independent SearchPort, PostgreSQL
hybrid retrieval (FTS + pg_trgm + pgvector + RRF), EmbeddingPort with server-side Gemini adapter
(NOT_CONFIGURED/DEGRADED_LEXICAL without provider; no paid calls), unified versioned visitor
context, deterministic shared context reducer, deterministic recommendation engine, server-side
adaptive composition, concurrency/revision safety (EXP-03), versioned /v1/experience endpoints +
constrained same-origin BFF integration, adaptive boundary rendering, typed Hermes capability
surface preparation.

Out of scope (mission order): Hermes/Hatchet runtime, official A2UI/AG-UI integration, deployment/
Coolify, final design, comprehensive certification, paid provider calls, second search engine or
product database, modifications to previously applied migrations.

Constraints: strict TS, minimal dependencies, preserve existing implementations/tests, parameterized
SQL only, store/market scoping in every retrieval channel, explicit constraints are hard filters,
no random-vector fallback, no client-authoritative store/customer identity, checkpoints under
docs/production/missions/FL05/.
