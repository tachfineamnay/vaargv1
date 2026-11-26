# P01 — Core data, identity and isolation

Status: IN PROGRESS.
Source SHA at mission entry: `2385a06d49976305fefa59c8d188357720a659e1`.
PRD SHA-256: `7e49d94144b4fd24b8968652664c354d5d8949946d9d9773c8314cbb630f8596`.

Normative inputs: PRD §3 (stack), §9 (relational schema), §10 (contracts/API/events), §11 (security/privacy); ROADMAP P01; AGENTS.md; CERTIFICATION.md; ARENA_EXECUTION.md; P00 checkpoints.

## Scope
Build on the cumulative P00 delivery. PostgreSQL 18 / Drizzle persistence, versioned reproducible migrations, vector + pg_trgm extensions, identity/brand/privacy/operations/integration foundations, stores + store config, merchant identities + memberships, RBAC, anonymous visitor sessions, purpose-based consent + permissions, transactional inbox/outbox, idempotency/dedup/audit, Valkey session infra, Zod API boundaries. Real merchant authentication (documented mechanism, no mock/bypass). Two synthetic stores.

## Data invariants
Store-scoped tenant records; composite store_id FKs; RLS + restricted runtime role (no BYPASSRLS); no pool tenant-context leak; exact decimal money; UTC timestamps; UUIDv7 (verified uuid@11); no plaintext credentials; no unnecessary PII; no unused future domain tables.

## AC mapping
AC-24 (store isolation), AC-28 (fresh install/upgrade/migrations), AC-29 (no secrets/PII).
