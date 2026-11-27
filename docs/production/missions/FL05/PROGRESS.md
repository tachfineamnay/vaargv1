# FL05 Progress

- GRAPHIFY_BLOCKED: `graphify` not found (exit 127); direct source navigation per mission order.
- Source baseline verified: ea65c4de36280f967982c6acab550508ad7b9f85.
- Task 00 DONE: checkpoint files created before code.
- Tasks 01–14 DONE: shared contracts (search/experience/reducer/recommendation/composition/embedding/capabilities), migrations 0011+0012 (unapplied in sandbox), persistence (search-port RRF hybrid, Gemini adapter + embedding job, experience-context CAS, recommendations + run recording, composition), API /v1/experience (7 routes + capabilities), web BFF routes + ExperienceReporter + AdaptiveSectionBoundary + adaptive mapping, worker embeddings.refresh job.
- Bugfix: hybrid search without provider now returns DEGRADED_LEXICAL with fts+trigram channels per D-05 (was NOT_CONFIGURED); contextual with q includes lexical channels.
- Task 15 DONE: full gates `npx turbo run lint typecheck build test --force` → 20/20 tasks PASS (shared 40, web 52, worker 9+1 skip, api 10+10 skip PG-gated, persistence 68+34 skip PG-gated).
- Gated PG experience test + category_selected reporter wiring: NOT included in this PR — PG/Valkey unavailable in sandbox (recorded NOT_RUN in VALIDATION).
- Task 16: commit, push, one PR to main (no merge).
