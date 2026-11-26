# P01 Evidence

Evidence artifacts for P01 — Core Data, Identity and Isolation.

## Commands & results (captured during implementation)

### Environment
- HEAD (P01 start): `2385a06d49976305fefa59c8d188357720a659e1`
- PRD SHA-256: `7e49d94144b4fd24b8968652664c354d5d8949946d9d9773c8314cbb630f8596`
- Node v22.22.3, pnpm 10.15.0 (corepack), Docker NOT available

### Typecheck
- `tsc --noEmit -p tsconfig.json` → exit 0 (PASS_REAL)
- `tsc --noEmit -p tsconfig.test.json` → exit 0 (PASS_REAL)

### Build
- `pnpm run build` → exit 0, dist/ generated (PASS_REAL)

### Unit tests
- `vitest run` → 17 passed, 10 integration skipped (PASS_REAL for unit)
  - validation.test.ts: 8 passed
  - passwords.test.ts: 3 passed (argon2id hash/verify/salt)
  - session-store.test.ts: 5 passed

### Real DB gates
- All NOT_RUN (Docker/PostgreSQL unavailable in sandbox)
- Integration tests written and gated on DATABASE_URL; Codex runs locally

### Migration generation
- `drizzle-kit generate --name=0001_init` → 14 tables → migrations/0000_0001_init.sql
- RLS/roles hand-written → migrations/0001_rls_roles.sql
