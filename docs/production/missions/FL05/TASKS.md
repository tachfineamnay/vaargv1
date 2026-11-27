# FL05 Tasks

| # | Task | Status |
|---|------|--------|
| 00 | Checkpoints created (MISSION/TASKS/PROGRESS/DECISIONS/VALIDATION + evidence/) | DONE |
| 01 | SearchPort contracts in @vaarg/shared (requests, constraints, results, provenance) | DONE |
| 02 | Migration 0011_hybrid_search.sql (tsvector+trigger+GIN, pgvector embeddings, indexes, RLS) | DONE |
| 03 | Migration 0012_experience_context.sql (events, signals, revisions, recommendation runs/items, RLS, retention) | DONE |
| 04 | PostgreSQL hybrid retrieval (FTS, trgm, vector, RRF, hard filters, deterministic ties) | DONE |
| 05 | EmbeddingPort + Gemini adapter (batching, timeout, cancellation, retries, validation, NOT_CONFIGURED) | DONE |
| 06 | Incremental embedding job handler (content-hash reindex, stale rejection, Hatchet-ready) | DONE |
| 07 | Unified visitor context contracts + persistence service (CAS contextVersion, Valkey derived state) | DONE |
| 08 | Shared deterministic context reducer (idempotency, ordering, precedence, consent gating) | DONE |
| 09 | RecommendationPort + deterministic recommendation service | DONE |
| 10 | Adaptive composition contracts in shared + server-side composition service | DONE |
| 11 | Concurrency/revision safety (CAS, stale rejection, AbortSignal, session scope) | DONE |
| 12 | API /v1/experience endpoints (context, events, search, recommendations, composition, refresh, reset) | DONE |
| 13 | BFF routes + AdaptiveSectionBoundary real rendering + interaction wiring | DONE |
| 14 | Typed Hermes capability surface (5 bounded capabilities, consent/provenance preserved) | DONE |
| 15 | Targeted checks: reducer, RRF, stale rejection, embedding validation; typecheck/lint/build/test | DONE |
| 16 | Checkpoints finalized, commit, push, one PR to main | IN_PROGRESS |
