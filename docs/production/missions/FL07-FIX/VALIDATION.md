# FL07-FIX Validation

## Automated (PASS)
- `pnpm build`: 5/5 tasks successful.
- `pnpm typecheck`: 7/7 tasks successful.
- `pnpm lint`: 5/5 tasks successful.
- Focused regressions:
  - persistence: 85 passed, 44 skipped (integration NOT_RUN).
  - api: 21 passed, 10 skipped (PG e2e NOT_RUN).
- New `packages/persistence/test/integration/fl07-fix.test.ts`: 4 real-PG
  gates (FIX01 idempotent replay/conflict, FIX04 budget-exceeded durability,
  FIX05 admission fail-closed, FIX07 anonymous consent tombstone). Skipped
  (NOT_RUN) when `FL06_TEST_DATABASE_URL` is absent — never mocked SQL.

## Transactional invariants (real PostgreSQL required, NOT_RUN here)
- FIX01: one publication per proposal under concurrent identical keys;
  differing payload same key → CONFLICT; terminal/stale proposals never applied.
- FIX04: one reservation per provider_call_id; budget-exceeded/deadline
  committed and durable after the throwing call.
- FIX05: no allocation ⇒ denied; authorized unexpired allocation ⇒ admitted.
- FIX07: grant then withdrawal tombstones personalization atomically.

## Not validated
- Live PostgreSQL/pgvector/Valkey/Hermes/Hatchet/provider execution.
- Commercial certification or deployment.
