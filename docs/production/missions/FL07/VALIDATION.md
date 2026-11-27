# FL07 Validation

| Check | Status | Notes |
| --- | --- | --- |
| `pnpm build` (all 5 packages incl. Next.js 16.4.6 production build across 35 routes) | PASS_REAL | 5/5 Turbo tasks passed with zero errors |
| `pnpm typecheck` (strict TS 5.9.3 + `exactOptionalPropertyTypes`) | PASS_REAL | 7/7 Turbo tasks passed with zero errors |
| `pnpm lint` (ESLint 9 across `src` and `test` in all 5 packages) | PASS_REAL | 5/5 Turbo tasks passed with zero errors and zero warnings |
| `pnpm test` (Vitest across `@vaarg/shared`, `@vaarg/persistence`, `@vaarg/api`, `@vaarg/worker`, `@vaarg/web`) | PASS_REAL | 7/7 Turbo tasks passed (231 executed tests green): shared 50/50, web 63/63, persistence 85 passed (40 PG-gated skipped), api 21 passed (10 PG-gated skipped), worker 12 passed (1 PG-gated skipped) |
| Python confinement plugin syntax (`python3 -m py_compile deploy/hermes/plugins/vaarg-confinement/__init__.py`) | PASS_REAL | Compiled cleanly (`v1.1.0`) |
| `docs/product/PRD.md` immutability (`sha256sum`) | PASS_REAL | `7e49d94144b4fd24b8968652664c354d5d8949946d9d9773c8314cbb630f8596` |
| Graphify pre-check (`graphify --version`) | GRAPHIFY_BLOCKED | CLI unavailable in sandbox (exit 127) |
| Live PostgreSQL 18 / Valkey / Hermes `v0.23.4` / Hatchet engine / paid Gemini & DeepSeek provider gates | NOT_RUN | Sandbox has no Docker/PostgreSQL/Valkey/Hermes/Hatchet daemons or live paid provider keys; real PG integration suite for migration `0015`, RLS isolation, and `Last-Event-ID` sequence cursor replay delivered at `packages/persistence/test/integration/fl07-streams.test.ts` (`FL07_TEST_DATABASE_URL`) for local Codex certification |
