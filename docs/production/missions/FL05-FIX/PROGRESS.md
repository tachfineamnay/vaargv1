# FL05-FIX Progress

- GRAPHIFY_BLOCKED: `graphify` not found; direct source navigation per mission order.
- Source baseline verified: a94deb2745fc3e3923dcc8527f7d25123e2fda4e.
- Checkpoints created before code.
- Next exact task: FIX01–FIX05 persistence, then API/web.

Persistence/API in progress: scoped RLS queries, INSERT RETURNING ingestion,
locked active-session/customer serialization with consent withdrawal, monotonic
expired revisions, per-variant filters, current embedding joins, atomic cache
Lua CAS (no non-atomic fallback). API reads PostgreSQL authority rather than
serving a potentially withdrawn cache snapshot. Capability methods now share
binding/session/consent resolution. Next: storefront adaptive observable and SSR search.

FIX06 shared observable + accepted-interaction notifications, category selection,
AbortController lifecycle guards and reset suspension implemented. FIX07 SSR
search now invokes FL05 tenant-only catalog-search, lexical by default / hybrid
explicitly, verified summary DTOs and bounded no-cursor semantics. First affected
shared/persistence builds + persistence/API/web typechecks PASS; original focused
shared experience (14) and web experience (5) tests PASS. Added forward 0013 for
provider-aware embedding identities (unverifiable legacy rows require reindex).
Next: focused regression tests, tighten edge cases, final checks/commit/PR.

Focused checks: 76 passed, 3 real PostgreSQL tests skipped (NOT_RUN).
Regression coverage includes duplicates/mixed batches/CAS rollback/expiry,
variant hard filters, method-mode mismatch, honest channels/provider freshness,
capability context/consent validation, reset/session/navigation cancellation,
and SSR hybrid/lexical UI. Tightened essential receipt minimization and
navigation keepalive delivery; final rerun next, then commit/push/open one PR.

FIX01–FIX09 implemented. Final focused run: 77 passed, 3 PG gates NOT_RUN.
All four affected typechecks pass; publication/withdrawal edge-case rechecks pass.
Cold-session withdrawal now creates revision tombstones, invalidating in-flight
version-zero proposals too. Real migrations/Valkey/provider/browser gates remain
NOT_RUN, not certified. No existing tests removed or weakened.
Next exact action: commit changes on arena/c104163d-vaargv1, push that branch,
create one PR to main, then record PR checkpoint. Never merge.
