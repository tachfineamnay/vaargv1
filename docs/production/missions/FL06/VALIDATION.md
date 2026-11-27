# FL06 Validation

| Check | Status | Notes |
| --- | --- | --- |
| `pnpm build` (all 5 packages incl. Next.js 16 production build) | PASS_REAL | 5/5 tasks passed with zero errors |
| `pnpm typecheck` (strict TS 5.9.3 + `exactOptionalPropertyTypes`) | PASS_REAL | 7/7 tasks passed with zero errors |
| `pnpm lint` (ESLint 9 across `src` and `test`) | PASS_REAL | 5/5 tasks passed with zero errors and zero warnings |
| `pnpm test` (Vitest across `@vaarg/shared`, `@vaarg/persistence`, `@vaarg/api`, `@vaarg/worker`, `@vaarg/web`) | PASS_REAL | 7/7 tasks passed: shared 45/45, web 60/60, persistence 83 passed (39 PG-gated skipped), api 17 passed (10 PG-gated skipped), worker 12 passed (1 PG-gated skipped) |
| Python confinement plugin syntax (`python3 -m py_compile deploy/hermes/plugins/vaarg-confinement/__init__.py`) | PASS_REAL | Compiled cleanly |
| Graphify pre-check (`graphify --version`) | GRAPHIFY_BLOCKED | CLI unavailable in sandbox (exit 127) |
| Live PostgreSQL 18 / Valkey / Hermes `v0.23.4` / Hatchet engine / paid Gemini & DeepSeek provider gates | NOT_RUN | Sandbox has no Docker/PostgreSQL/Valkey/Hermes/Hatchet daemons or live paid provider keys; real PG integration suite delivered at `packages/persistence/test/integration/intelligence.test.ts` (`FL06_TEST_DATABASE_URL`) for local Codex certification |
