# Progress
Remote refs verified by git ls-remote: main 3a3db51; P02 a4ea19c. Original cwd was an unrelated older clean tracked branch; untracked .p02-source, .worktrees and checkpoint directory remain untouched. Created codex/p02a-foundation from actual remote main to preserve both existing checkout history and new main rules.
Next exact action: inspect P02 application diff and selectively restore source and P02 evidence without HANDOFF or older rules.

Task 1: selectively restored P02 application source, tests, migration and P02 records from a4ea19c; retained main execution documents and omitted HANDOFF and P03. Previous P02 validation notes six failures; these are historical claims, not new runs. Next: inspect DB context, runtime roles and tests; establish available PG18.

Task 2 investigation: imported set_config fix already exists in partial source. Missing UUID validation and runtime role enforcement; rollback failure currently returns connection to pool. Added tests; execution blocked by incomplete dependency installation. Next: finish install, obtain behavioral red, then implement context checks and safe connection disposal.

Task 2: validated UUID before acquisition; reject privileged current/session/inherited roles, reset context before and after transactions, discard on rollback/reset failure. Unit red then green; PG18 real gate pending. Next: session and membership regressions and fixes (task 3), preserving transactional atomicity.

Task 3: session resolution now requires active, unexpired row; rotation is one conditional SQL update/insert statement; role lookup joins active account and membership. PG18 regression red then green. No API auth/session wiring exists; application integration remains under review. Next: atomic idempotency keys and canonical nested JSON, failing-first tests.

Task 4: new forward migration for explicit keys, atomic insert conflict handling, claimed/pending/completed/conflict outcomes and recursive canonical JSON. PG18 concurrency/rollback and nested serialization tests pass; historical API callers/tests need migration. Next: webhook duplicate insertion and replay/rollback tests.

Task 5: ON CONFLICT DO NOTHING and scoped lookup preserve event ID and transaction state; PG18 regression passes. Next: correct RLS empty-context policy through forward migration; repair inherited PG18 harness, increase real negative and concurrency tests.

Task 6: PG18 suite passes after repairing catalog inspection, genuine isolated role setup, and pooled cleanup; forward migrations fix empty-context RLS and cross-store foreign keys. P02A suite covers concurrency, rollback and stable IDs. Next: fix remaining role setup in P02 tests, reconcile schema, and execute full integration/quality gates.

Task 6: repaired old role conflicts using unique child roles and normal DB cleanup; PG18 P01 suite 11/11, combined P02/P02A 10/10. Scope: synthetic data/providers, real PG18. Task 3 reopened: audit found authenticateMerchant returns a token that is not persisted or resolvable; implement merchant session lifecycle and membership revalidation before quality gates. HTTP catalog remains explicitly NOT_CONFIGURED pending trusted resolution.

Task 3 merchant addition: durable scoped hashed sessions, active membership/account rechecks, single-statement rotation and revocation. Initial PG18 test fails for missing resolver then passes 8 tests; expiry assertions added for final run. Next: rerun full PG18, lint, typecheck, test, build, smoke; update P01/P02/status and export snapshot.

Task 7: frozen install, lint, typecheck, workspace tests/build and focused PG18 scenarios executed; API live tests pass. Web server start rejected by automatic approval review, smoke command exits 1 due web connection refusal. Source remains partial: HTTP trusted tenant resolution and secure auth/session/cookie integration are not present, Shopify live gate NOT_RUN. Do not claim P02A complete or release certified. Exact next action: implement trusted store/domain binding and application-facing session integration with negative CSRF/membership tests, then re-run web smoke and clean install. Preserve current diff and read all checkpoints before resuming.

Additional security fix: PG18 exposed inherited vaarg_app LOGIN with public fixed password. Forward migration 0007 makes it a passwordless NOLOGIN group. Final six-file isolated PG18 suite including fresh and populated upgrade passed 26 tests; provision a separate restricted login before any future upgrade and assess cluster-wide role impact. Next exact source action remains trusted domain/store resolution and secure HTTP session/cookie boundaries.
