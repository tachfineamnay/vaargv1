# P01 tasks
Atomic, dependency-ordered. Update status and evidence after each task.

- [ ] P01-T01 — Verify repo/HEAD, P00 compatibility, PRD hash, runtime capabilities.
- [ ] P01-T02 — Create P01 mission checkpoints; record source SHA + PRD hash.
- [ ] P01-T03 — Add @vaarg/persistence package: Drizzle schema + versioned migrations (identity/brand/privacy/operations/integration), vector + pg_trgm extensions.
- [ ] P01-T04 — Stores + store-specific configuration + two synthetic stores seed.
- [ ] P01-T05 — Merchant identities, memberships, RBAC (owner/marketing/support).
- [ ] P01-T06 — Real merchant authentication (documented mechanism, no mock).
- [ ] P01-T07 — Secure anonymous visitor sessions + Valkey session infrastructure.
- [ ] P01-T08 — Purpose-based consent and permissions.
- [ ] P01-T09 — Transactional inbox + outbox, idempotency, dedup, audit trail.
- [ ] P01-T10 — Zod API boundaries for identity/consent/session/merchant.
- [ ] P01-T11 — RLS policies + restricted runtime role + composite FKs.
- [ ] P01-T12 — Integration tests: fresh migration, populated upgrade, cross-store rejection, RLS, sessions, consent, idempotency, inbox/outbox.
- [ ] P01-T13 — Run all available checks; fix causes; record real vs simulated.
- [ ] P01-T14 — Update STATUS + checkpoints, SHA-256 manifest, coherent local commit.

Dependencies: T01 first; T02 before coding; T03 before T04–T11; T12 after T03–T11; T13 after T12; T14 last.
