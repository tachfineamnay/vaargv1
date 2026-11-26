# Validation
Source b0943dd8cd87626cc7c8ac20979eedc830a3d5e9; Windows Node v24.21.0, pnpm 10.6.1, Docker Compose v5.5.1. All G01-G16 NOT_RUN. No certification.
- 2026-11-26 elevated docker version exit 0: Engine 29.8.1. No stack launched.
- npm view turbo version and npm view typescript@5.9.3 version exit 0: 2.11.13 and 5.9.3. Exact versions only; not proof of all peers.
- pnpm install --lockfile-only --strict-peer-dependencies --config.fetch-retries=0 --config.fetch-timeout=10000: exit 0; root-only lockfile with turbo and TypeScript, no application dependencies or frozen install. Not G01/G02 certification.
- 2026-11-26: pnpm install --frozen-lockfile --ignore-scripts --strict-peer-dependencies exit 0 on checkpoint c9d846b plus documentation-only modifications; root-only (turbo and TypeScript), not a full G01 pass.
- npm view @nestjs/platform-fastify version peerDependencies; npm view @nestjs/core version peerDependencies engines; npm view next version peerDependencies engines; npm view zod version: exit 0; Nest 12.6.2, Next 16.4.6, Zod 4.6.7. Full dependency and peer resolution remains NOT_RUN.
