# P01 VALIDATION

Source SHA (P01 start): `2385a06d49976305fefa59c8d188357720a659e1`
PRD SHA-256: `7e49d94144b4fd24b8968652664c354d5d8949946d9d9773c8314cbb630f8596`

## Gates

| Gate | Method | Status | Evidence |
|------|--------|--------|----------|
| Typecheck (persistence) | `tsc --noEmit -p tsconfig.json` | PASS_REAL | exit 0, no errors |
| Typecheck (tests) | `tsc --noEmit -p tsconfig.test.json` | PASS_REAL | exit 0, no errors |
| Build | `pnpm run build` (tsc) | PASS_REAL | dist/ generated, migrate CLI runs |
| Unit: Zod boundaries | `vitest run test/validation.test.ts` | PASS_REAL | 8/8 passed |
| Unit: argon2id passwords | `vitest run test/passwords.test.ts` | PASS_REAL | 3/3 passed (hash/verify/salt) |
| Unit: session store | `vitest run test/session-store.test.ts` | PASS_REAL | 5/5 passed |
| Full unit suite | `vitest run` | PASS_REAL | 17 passed, 10 integration skipped |
| Fresh migration | real PG | NOT_RUN | Docker/PG unavailable in sandbox |
| Populated upgrade | real PG | NOT_RUN | Docker/PG unavailable in sandbox |
| Cross-store access rejection (AC-24) | real PG | NOT_RUN | integration test written, gated on DATABASE_URL |
| Cross-store FK rejection | real PG | NOT_RUN | integration test written, gated on DATABASE_URL |
| RLS enforcement | real PG | NOT_RUN | integration test written, gated on DATABASE_URL |
| Unauthorized merchant role | real PG | NOT_RUN | integration test written, gated on DATABASE_URL |
| Session expiration + rotation | real PG | NOT_RUN | integration test written, gated on DATABASE_URL |
| Consent changes | real PG | NOT_RUN | integration test written, gated on DATABASE_URL |
| Concurrent idempotent ops | real PG | NOT_RUN | integration test written, gated on DATABASE_URL |
| Inbox/outbox replay + rollback | real PG | NOT_RUN | integration test written, gated on DATABASE_URL |

## AC Mapping
- AC-24 (store isolation): RLS policies + store-scoped transactions + composite
  store_id FKs; integration tests for cross-store rejection (source delivered,
  real gate NOT_RUN).
- AC-28 (fresh install/upgrade/restore): versioned migrations + idempotent runner;
  integration tests for fresh migration + populated upgrade (source delivered,
  real gate NOT_RUN).
- AC-29 (no secrets/unnecessary PII): argon2id password hashes only; opaque tokens
  stored as SHA-256; redacted audit logs; no plaintext credentials; integration
  test asserts no leak.

## Blockers
- Docker NOT available in sandbox → no real PostgreSQL 18 → all real DB gates
  NOT_RUN. Source + integration scripts delivered; Codex executes real Docker
  certification locally.
