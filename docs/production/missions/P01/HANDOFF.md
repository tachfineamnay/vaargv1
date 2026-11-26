# P01 HANDOFF

**Mission**: P01 — CORE DATA, IDENTITY AND ISOLATION
**Status**: SOURCE DELIVERED (stop after P01 source delivery per mission)
**Base (P00 merged)**: `2385a06d49976305fefa59c8d188357720a659e1`
**Delivered SHA (P01 commit)**: `7a0cd1de959422f5b58769df2a748468c11c538a`
**Branch**: `arena/c1eaf44b-vaargv1`

## Delivered

### Package: `@vaarg/persistence` (`packages/persistence/`)
- **Schema** (`src/schema/`): 14 tables across 6 domains
  - identity: stores, merchantUsers, storeMemberships, customers, customerIdentities
  - brand: storefrontConfigs
  - privacy: consentRecords, marketingPermissions, privacyRequests
  - operations: outboxEvents, idempotencyKeys, auditLogs
  - integration: webhookInbox
  - experience: visitorSessions
  All tenant tables carry store_id FK + composite unique/store-scoped indexes.
- **Migrations** (`migrations/`):
  - `0000_0001_init.sql` — drizzle-kit generated (14 tables, enums, FKs, indexes)
  - `0001_rls_roles.sql` — vector + pg_trgm extensions, `vaarg_app` role
    (NOSUPERUSER/NOCREATEDB/NOBYPASSRLS), 17 RLS policies, FORCE RLS
- **RLS** (`src/rls/`): authoritative policies.sql + roles.sql
- **Client** (`src/db/client.ts`): createDb/createPool + withStoreContext
  (SET LOCAL app.store_id per transaction; pooled connections never leak
  tenant context)
- **Migration runner** (`src/db/migrate.ts`): idempotent, versioned, per-file
  transaction; CLI `pnpm migrate`
- **Auth** (`src/auth/`): argon2id passwords + REAL merchant authentication
  (authenticateMerchant, no mock/bypass), opaque token generation/hashing
- **Sessions** (`src/sessions/`): visitor-sessions (create/resolve/rotate/revoke)
  + valkey session store (ValkeySessionStore lazy ioredis + MemorySessionStore)
- **Services** (`src/services/`): stores, seed (2 synthetic stores), consent,
  outbox, webhook-inbox, idempotency, audit
- **Validation** (`src/validation/`): 10 Zod edge schemas + safeValidate

### Tests (`packages/persistence/test/`)
- Unit (PASS_REAL): validation (8), passwords/argon2id (3), session-store (5)
- Integration (written, gated on DATABASE_URL, NOT_RUN in sandbox):
  fresh migration, populated upgrade, cross-store access rejection, cross-store
  FK rejection, RLS enforcement, unauthorized merchant role, session expiry+rotation,
  consent changes, concurrent idempotency, inbox/outbox replay+rollback

### Checkpoints (`docs/production/missions/P01/`)
MISSION.md, TASKS.md, PROGRESS.md, DECISIONS.md, VALIDATION.md, HANDOFF.md, evidence/

## Real gates status
- Docker NOT available in sandbox → no real PostgreSQL 18.
- All real DB integration gates: **NOT_RUN** (source + scripts delivered).
- Typecheck, build, unit tests: **PASS_REAL**.
- Codex executes real Docker certification locally.

## Next exact action (for Codex certification)
1. Start PostgreSQL 18 + Valkey (Docker).
2. Set DATABASE_URL, run `pnpm --filter @vaarg/persistence migrate`.
3. Run `DATABASE_URL=... pnpm --filter @vaarg/persistence test` to execute the
   10 integration tests against real PG.
4. Confirm AC-24/AC-28/AC-29 mapping.
