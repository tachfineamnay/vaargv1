# P01 PROGRESS

Source SHA (P01 start): `2385a06d49976305fefa59c8d188357720a659e1` (main, PR #2 merged)
PRD SHA-256: `7e49d94144b4fd24b8968652664c354d5d8949946d9d9773c8314cbb630f8596`

| Task | Title | Status | Evidence |
|------|-------|--------|----------|
| P01-T01 | Env/HEAD/PRD verification | DONE | HEAD=2385a06; pnpm 10.15.0 via corepack; Docker absent; PRD hash recorded |
| P01-T02 | Mission checkpoints | DONE | MISSION/TASKS/PROGRESS/DECISIONS/VALIDATION + evidence/ |
| P01-T03 | Persistence: Drizzle schema, migrations, RLS | DONE | 14 tables/6 domains; 2 migrations; RLS+role; client store-context tx; tsc PASS |
| P01-T04 | Stores + seed (2 synthetic) | DONE | stores service + seedSyntheticStores (2 deterministic stores) |
| P01-T05 | Merchant identities + memberships | DONE | merchant_users + store_memberships schema + seed |
| P01-T06 | Owner/marketing/support RBAC | DONE | merchant_role enum (owner/marketing/support) + getMerchantRole |
| P01-T07 | Real merchant authentication (argon2id) | DONE | @node-rs/argon2 argon2id; authenticateMerchant (no mock/bypass); unit test PASS_REAL |
| P01-T08 | Anonymous visitor sessions + rotation | DONE | createVisitorSession/resolve/rotate/revoke; session TTL+rotation |
| P01-T09 | Consent + permissions | DONE | recordConsent (append-only) + marketing_permissions projection + getConsent |
| P01-T10 | Transactional inbox + outbox | DONE | appendOutboxEvent (same-tx) + webhook receiveWebhook (dedup via unique index) |
| P01-T11 | Idempotency / dedup / audit trail | DONE | claimIdempotencyKey (scope+principal+hash) + recordAudit (redacted) |
| P01-T12 | Valkey session infrastructure | DONE | SessionStore abstraction + ValkeySessionStore (lazy ioredis) + MemorySessionStore |
| P01-T13 | Validated Zod API boundaries | DONE | 10 schemas (sessions/login/consent/webhook/envelope/privacy/idempotency); unit test PASS_REAL |
| P01-T14 | Integration tests + run all checks + final source checkpoint | DONE | 17 unit tests PASS_REAL; 10 integration tests written, gated on PG (NOT_RUN); tsc+build PASS |

## Summary
All 13 implementation items delivered as source. Real PostgreSQL integration tests
written and gated on DATABASE_URL. In this sandbox Docker/PostgreSQL are unavailable,
so real DB gates are NOT_RUN — Codex executes real Docker certification locally.
Typecheck + build + unit tests all PASS_REAL.


2026-11-26 — Source delivered at 7a0cd1de959422f5b58769df2a748468c11c538a; real DB integration remains NOT_RUN. For final local verification, start isolated PG18/Valkey, set authorized DATABASE_URL, run pnpm --filter @vaarg/persistence migrate and pnpm --filter @vaarg/persistence test with the real database. Consult VALIDATION.md for the reported gates. Next source mission: P02 on cumulative main when authorized. No separate transfer stage.
