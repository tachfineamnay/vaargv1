# FL03 Validation

Environment: Arena sandbox, node v22.22.3, pnpm 10.15.0 (corepack-activated), no Docker,
no PostgreSQL, no Valkey, no Shopify access. External-service gates follow prior missions: NOT_RUN
is an honest outcome; implementation continued independently per mission order.

| Check | Command | Result | Evidence |
|---|---|---|---|
| Install | `pnpm install --frozen-lockfile` | PASS (exit 0) | /tmp log; lockfile unchanged |
| Typecheck | `npx turbo run typecheck` | PASS | shared, persistence, api, web, worker |
| Build | `npx turbo run build` | PASS | all packages incl. web |
| Lint | `npx turbo run lint` | PASS | eslint clean across packages |
| Unit tests | `npx turbo run test` | PASS (20/20 tasks) | shared 22, persistence 59, api 8, web, worker, runner |
| New projection unit tests | `vitest run test/catalog-projection.test.ts` | PASS (9) | caught 2 real param bugs in attribute inserts (fixed) |
| Real PG integration (persistence) | P02_TEST_DATABASE_URL gated | NOT_RUN | no PostgreSQL in sandbox |
| Real PG v1 HTTP (api) | FL03_API_TEST_URL gated | NOT_RUN | suite delivered: `apps/api/test/catalog-v1.pg.test.ts` |
| Live Shopify adapter | shopify.real.test.ts gated | NOT_RUN | no authorized provider access |
| Docker/Compose smoke | certify.sh | NOT_RUN | out of mission scope |

Implementation-verified properties (source inspection, unit-tested where practical):
- Same-transaction page → projection application; failed transactions never advance checkpoints.
- Lease + compare-and-set checkpoint (generation, phase, cursor, lease token) preserved; stale
  workers cannot overwrite newer generations; interrupted imports resume.
- Completion reconciliation flips generation-scoped visibility only inside the current market.
- Store scoping in every SQL statement; RLS enabled+forced on all 7 new tables with vaarg_app grants.
- No database transaction is held across provider network calls (fetch between scoped transactions).
- CSRF enforced for cookie-authenticated catalog mutations (legacy + v1).
- No raw database entities, provider configuration, secrets or unconfigured metafields in responses.

Known limitations (honest):
- SQL correctness of new read/write paths is type-checked and unit-tested at the mapping layer but
  not executed against PostgreSQL in this sandbox; Codex real-DB certification remains required.
- Deterministic lexical search is trigram/ILIKE-based; embedding/hybrid ranking belongs to FL05.
