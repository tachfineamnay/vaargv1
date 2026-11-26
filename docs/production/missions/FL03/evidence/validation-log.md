# FL03 evidence log (Arena sandbox)

- 2026-11-26 entry revision: e249ce5e5eba688f782be9f5dce1480d5dbd7399; GRAPHIFY_BLOCKED (graphify not found; one remediation attempt: command lookup + corepack tooling activation).
- pnpm 10.15.0 activated via corepack; `pnpm install --frozen-lockfile` exit 0.
- Iterative package checks: shared tsc PASS; persistence tsc + eslint PASS (one no-control-regex lint fix in normalizeText); api tsc + vitest PASS (8 unit tests); catalog-projection unit tests PASS (9; fixed attribute-insert parameter bugs found by the tests; fixed cursor decode error envelope; fixed facet $4/$5 parameter conflict found by review).
- Final gate: `npx turbo run lint typecheck build test` → 20/20 tasks successful (turbo 2.11.13).
- PostgreSQL/Docker/Valkey/Shopify unavailable → PG-gated suites (including new catalog-v1.pg.test.ts and extended catalog-import.test.ts fixture with migration 0010 + normalized assertions) NOT_RUN.
