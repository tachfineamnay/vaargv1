# P00 decisions
- Baseline architecture follows PRD and ADR-0001; versions pinned and verified against npm registry.
- Documentation and application implementation are separate: no runtime claims from bootstrap.
- Local/self-hosted validation only. Public repository; synthetic evidence only.
- P00-D01: Use Node engine range >=22.22.3 (sandbox has 22.22.3; target Node 24 Docker images). Rationale: sandbox runtime is 22; Docker images use node:24-alpine. Impact: engines field documents range. Verified: install/build/test on 22.22.3.
- P00-D02: NestJS API built with plain tsc instead of @nestjs/cli. Rationale: nest CLI not required; tsc emits equivalent CommonJS with decorator metadata. Impact: fewer deps. Verified: api build + live HTTP.
- P00-D03: API e2e tests gated behind API_TEST_URL so default `pnpm test` does not fail without a live server; they PASS_REAL when a server is present. Rationale: honest NOT_RUN vs FAIL semantics.
- P00-D04: Hatchet wired but disabled by default (HATCHET_ENABLED=false). Rationale: approved future runtime; no fake jobs. Verified: worker reports hatchet=disabled.
- P00-D05: @nestjs/config retained minimal; configuration loaded from process.env via shared Zod schema. Rationale: explicit validation boundary.
