# Validation
Source: ca4a4263e838f49c2ffe091342ea73da7e1952ec, clean at start. Tests below run on the FL01 worktree, Node v22.22.3 (not Node 24); no deployment.
- `corepack pnpm install --frozen-lockfile` and offline repeat: PASS.
- `pnpm --filter @vaarg/{api,worker,web}... build`: PASS (each separately).
- API/worker/persistence typecheck and API/worker/web/persistence lint: PASS.
- API tests 4 pass/6 skipped, worker 9 pass/1 skipped, web 7 pass. Skips require real infrastructure.
- `vitest run test/migrate.test.ts`: 2 PASS_SIMULATED, mocked PostgreSQL only; one intermediate fixture ordering failure corrected and rerun.
- pnpm production deploy: packaged migration files and argon2 native packages present; persistence import succeeds; symlinked migration CLI exits 2 with absent config. Not a Docker build.
- Local API with unreachable synthetic dependencies: liveness HTTP 200, readiness HTTP 503, revision endpoint returns configured revision. No real dependency connection claimed.
- Compose YAML parsed by js-yaml; `git diff --check` PASS. Docker/Compose absent; actual image builds, Compose semantics, migrations, locking, upgrades, role security, readiness with real PostgreSQL/Valkey and Coolify NOT_RUN. Graphify BLOCKED (command missing; uv/pipx unavailable).
