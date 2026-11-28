# FL07-FIX Tasks

Implemented (source delivery; not external-runtime certified):
- [x] FIX01 atomic proposal publication (`proposal-publication.ts`, single
  scoped transaction, lock order session→conversation→run→proposal→revisions,
  idempotency replay/CONFLICT, terminal-status guards, consent re-validation).
- [x] FIX02 web EXP-03 stale guard + SSE `Last-Event-ID` cursor resume —
  verified present in web layer (inspected, no defect found).
- [x] FIX03 confinement attestation — verified sound (stale>120s rejected,
  missing hooks/capabilities rejected, HMAC mismatch rejected, fails closed
  `UNSAFE_CONFINEMENT`). No code change required.
- [x] FIX04 stable provider-call identity: `model_usage.provider_call_id`
  (unique index), idempotent reservation, budget-exceeded/deadline committed
  in-transaction and surfaced after commit, UNKNOWN outcome on missing
  provider evidence, plugin echoes `X-Vaarg-Provider-Call-Id`.
- [x] FIX05 provider admission ledger (`provider_admission_ledger` + focused
  service), storefront hybrid search gated fail-closed, embedding mode guard.
- [x] FIX06 `recordAndBroadcastAgUiEvent` no longer swallows failures —
  observable counter + redacted log; returns boolean.
- [x] FIX07 session-scoped anonymous consent (append-only records +
  projection, atomic personalization tombstone, fail-closed reads).
- [x] FIX08–FIX10 inspection: FIX10 abuse ledger table in migration 0016;
  FIX08/FIX09 verified against FL05-FIX invariants (no defect found).
- [x] Forward migration `0016_fl07_fix_consolidation.sql` (FIX01/04/05/07/10).
- [x] Focused real-PostgreSQL regression `fl07-fix.test.ts` (NOT_RUN absent DB).
- [x] Typecheck/build/lint/focused tests pass; original tests preserved.

External PostgreSQL/pgvector/Valkey/Hermes/provider runtime gates: NOT_RUN.
