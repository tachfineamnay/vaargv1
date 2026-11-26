# P01 decisions
- Authentication mechanism: **argon2id** via `@node-rs/argon2` (native, prebuilt binaries, no mock). Rationale: industry-standard memory-hard KDF, no plaintext credentials, no identity bypass. Alternatives considered: bcrypt (weaker, slower tuning), scrypt (no maintained npm binding). Verified @node-rs/argon2 2.2.2 available with prebuilt binaries.
- Session tokens: opaque random tokens (crypto.randomBytes) stored hashed in DB/Valkey; rotation on auth, expiry enforced. No JWT for merchant sessions (stateless tokens complicate revocation). Anonymous visitor sessions: opaque tokens in Valkey with TTL.
- UUIDv7: verified supported in uuid@11.1.1 (uuid.v7()). Used for internal primary keys per PRD §9.
- Money: PostgreSQL NUMERIC(19,4) via Drizzle numeric(), exact decimal, no float.
- Timestamps: TIMESTAMPTZ (UTC) via Drizzle timestamptz().
- RLS: enable on all tenant-scoped tables; policies filter by store_id using a runtime GUC app.store_id; restricted role vaarg_app created WITHOUT BYPASSRLS; app connects as vaarg_app. Composite (store_id, ...) FKs enforce cross-store rejection at the constraint level as defense-in-depth.
- Pool isolation: each request sets app.store_id GUC inside its own transaction/connection; no shared mutable tenant context on pooled connections.
- Drizzle: drizzle-orm 0.45.4 + drizzle-kit 0.31.11, pg driver. Migrations versioned via drizzle-kit generate + a SQL runner.
- Two synthetic stores seeded (store_a, store_b) for isolation tests.

## T03 — Drizzle ORM API specifics (drizzle-orm 0.45.4)
- drizzle-orm 0.45.4 does NOT export `timestamptz` or a `bytea` column builder.
  - Timestamps use `timestamp(name, { withTimezone: true })` (maps to `timestamptz` in SQL, confirmed in generated migration: `timestamp with time zone`).
  - `bytea` column replaced with `varchar('payload_hash', { length: 64 })` for idempotency payload hashes (stored as hex).
- Migrations generated offline with `drizzle-kit generate --name=0001_init` → `migrations/0000_0001_init.sql`.
- RLS + role DDL hand-written as `migrations/0001_rls_roles.sql` (drizzle-kit does not manage roles/policies). Policies use guarded GUC expression `current_setting('app.store_id', true) <> '' AND store_id = ...::uuid` so unset/empty context denies without cast errors.

## T04–T14 — Service layer & infra decisions
- **Merchant auth**: argon2id via @node-rs/argon2 (algorithm id=2, native prebuilt).
  No mock login, no identity bypass. Opaque session tokens (crypto.randomBytes,
  base64url) stored as SHA-256 digests. NO JWT for merchant sessions (revocation
  via status update). Timing-safe: always runs a verify even for unknown users.
- **RBAC**: `merchant_role` enum (owner/marketing/support) on store_memberships;
  `getMerchantRole` resolves active role within store scope.
- **Visitor sessions**: store-scoped, token hashed, TTL-based expiry, rotation
  creates new row + revokes old (`rotated_from` link). RLS constrains by store.
- **Consent**: append-only `consent_records` (history) + `marketing_permissions`
  (effective projection, upserted in same tx). Purpose-based, per PRD §9.
- **Outbox**: `appendOutboxEvent` MUST be called in the same transaction as the
  business change (atomicity). Status lifecycle: pending→dispatched/failed→dead.
- **Webhook inbox**: dedup via unique index `(store_id, provider, provider_event_id)`;
  duplicate insert caught and reported as 'duplicate'.
- **Idempotency**: `claimIdempotencyKey` unique on (store_id, scope, principal,
  payload_hash); payload hashed SHA-256 with sorted keys. Reused response returned
  on repeat.
- **Audit**: append-only, redacted (no secrets/transcripts), metadata JSON-sanitized.
- **Valkey**: SessionStore interface + ValkeySessionStore (lazy ioredis load,
  graceful when absent) + MemorySessionStore for tests. DB guarantees live in
  PostgreSQL; session store is only the ephemeral token cache.
- **Zod**: 10 edge schemas; `safeValidate` returns structured errors. UUID schema
  uses z.string().uuid() (Zod 4 requires v1-8 or nil/all-f).
- **Migrations**: 2 files — `0000_0001_init.sql` (drizzle-kit generate) +
  `0001_rls_roles.sql` (extensions, vaarg_app role NOBYPASSRLS, 17 RLS policies,
  FORCE RLS). Idempotent runner with schema_migrations tracking + per-file tx.
