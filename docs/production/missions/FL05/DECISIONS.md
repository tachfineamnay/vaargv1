# FL05 Decisions

- D-01: Graphify unavailable → GRAPHIFY_BLOCKED; direct source navigation authorized by mission order.
- D-02: Migrations 0011 (hybrid search substrate) and 0012 (experience context) start after 0010; previously applied migrations untouched.
- D-03: Embedding baseline dimension 768 (PRD); model/dimension stored per row and asserted on every semantic query — no cross-model comparisons.
- D-04: RRF constant default 60, configurable per call; fusion implemented in SQL (channel CTEs) with a shared pure TS helper for unit checks and recommendation fusion.
- D-05: No provider configured → EmbeddingPort availability NOT_CONFIGURED and hybridSearch degrades to DEGRADED_LEXICAL (lexical+trgm only). Never random vectors.
- D-06: Consent: without personalization consent the reducer keeps explicit current-request criteria only; inferred signals are not persisted as a profile. Withdrawal clears derived personalization state.
- D-07: Gift-recipient explicit preferences are stored under a separate subject scope and never merged into buyer preferences.
- D-08: Conversation/cart references are typed nullable extension points; no simulated functionality.
