# FL05-FIX Validation

Baseline: a94deb2745fc3e3923dcc8527f7d25123e2fda4e (verified origin/main).
Code checked on the cumulative working tree immediately before the delivery commit.

- Frozen dependency install: `corepack pnpm install --frozen-lockfile` exit 0.
- Affected dependency builds: shared, persistence exit 0 (local generated dist ignored).
- `corepack pnpm --filter @vaarg/{shared,persistence,api,web} typecheck`
  (four separate commands): PASS, exit 0. See evidence/typechecks.txt.
- Focused suites: 77 tests PASS (14 shared, 21 persistence, 3 API, 39 web).
  Exact suite selections/output: evidence/focused-tests.txt.
- Persistence/API SQL and capability tests use synthetic mocks: PASS_SIMULATED,
  not proof of real database isolation, SQL execution, concurrent locks or providers.
- Added real PostgreSQL suite: test/integration/experience-fix.test.ts, 3 skipped:
  NOT_RUN without FL05_FIX_TEST_DATABASE_URL pointing to local /vaarg_fl05_fix_test.
- Real PostgreSQL migrations/pgvector/RLS/concurrency, Valkey Lua execution,
  configured-provider retrieval and live browser flows: NOT_RUN (runtime unavailable).
- Subsequent publication/withdrawal refinements: persistence build/typecheck and
  focused tests, API typecheck/tests exit 0; see evidence/*-recheck.txt.
- `git diff --check`: PASS. Graphify unavailable; authorized direct navigation.
- No paid calls, Docker, deployment, external CI or migration edits to 0000–0012.

Operator follow-up: apply forward 0013, authorize incremental embedding reindex
(legacy provider identity is deliberately unverified), run real gates. Retention:
`corepack pnpm --filter @vaarg/persistence experience:purge` with restricted
DATABASE_URL + operator STOREFRONT_BINDINGS_JSON; no provider calls.

Verified application code commit: caf8c4aa4d6c12cbab9299c608bc141f182abc36
(the checked working-tree application code is unchanged in this commit).
PR #9: https://github.com/tachfineamnay/vaargv1/pull/9. Final follow-up is
checkpoint-only; runtime gates remain NOT_RUN.
