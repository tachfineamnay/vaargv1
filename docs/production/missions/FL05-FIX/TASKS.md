# FL05-FIX Tasks

Implemented (not external-runtime certified):
- [x] FIX01 scoped RLS transactions, restricted role retained; targeted FL05 query scan clean.
- [x] FIX02 INSERT RETURNING only, duplicate-only no-op, first-write serialization, strict expiry CAS + regression tests.
- [x] FIX03 all five capabilities share validated server market/session/consent resolution and validated IO.
- [x] FIX04 common hard filters on every strategy + final summary resolution, eligible variants, honest provenance/reasons.
- [x] FIX05 current visible/hash/generation/provider/model/version/dimension embedding identity; channel ordering + mode guard.
- [x] FIX06 one observable, accepted-event notifications, category reporting, cancellation, identity/navigation/reset guards.
- [x] FIX07 session-free FL05 SSR search, explicit hybrid/default lexical, verified DTOs, bounded/no fake cursor UI.
- [x] FIX08 purpose isolation, minimized essential receipts, immediate atomic withdrawal + cache invalidation, runnable retention CLI.
- [x] FIX09 locked authoritative publication checks, 409 conflicts, active identity, Lua cache CAS, PostgreSQL-authoritative context reads.
- [x] Affected typechecks + focused tests; original tests preserved.
- [x] Code committed/pushed on Arena branch; PR #9 targets main; not merged.

External PostgreSQL/pgvector/Valkey/provider runtime gates: NOT_RUN.
