# FL05 Validation

| Check | Command | Environment | SHA | Result |
|-------|---------|-------------|-----|--------|
| graphify | graphify --version | local | ea65c4d | FAIL 127 → GRAPHIFY_BLOCKED (D-01) |
| targeted | vitest run (shared/web/persistence/api/worker suites) | local sandbox | branch tip | PASS — shared 40/40, web 52/52, worker 9 pass+1 skip, api 10 pass+10 skip, persistence 68 pass+34 skip |
| full gates | npx turbo run lint typecheck build test --force | local sandbox | branch tip | PASS — 20/20 tasks |
| PG/Valkey/provider | gated tests (FL05_API_TEST_URL / PG18 + Valkey + GEMINI key) | local sandbox | branch tip | NOT_RUN — no Docker/PostgreSQL/Valkey binaries in sandbox; gated suites skip via env-URL + pathname allowlist pattern |

Notes:
- Targeted FL05 checks: reducer (packages/shared/test/experience.test.ts), RRF fusion (shared), stale/expiry rejection (web experience tests + shared), embedding adapter validation (packages/persistence/test/embeddings-gemini.test.ts, 9 tests).
- Migrations 0011/0012 are written and applied by runMigrations in gated tests only — NOT applied to any live database from this sandbox.
- PRD-required paid provider calls: none (NOT_CONFIGURED path asserted instead).
