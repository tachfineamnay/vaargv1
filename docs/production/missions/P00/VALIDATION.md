# Validation
Source b0943dd8cd87626cc7c8ac20979eedc830a3d5e9; Windows Node v24.21.0, pnpm 10.6.1, Docker Compose v5.5.1. All G01-G16 NOT_RUN. No certification.
- 2026-11-26 elevated docker version exit 0: Engine 29.8.1. No stack launched.
- npm view turbo version and npm view typescript@5.9.3 version exit 0: 2.11.13 and 5.9.3. Exact versions only; not proof of all peers.
- pnpm install --lockfile-only --strict-peer-dependencies --config.fetch-retries=0 --config.fetch-timeout=10000: exit 0; root-only lockfile with turbo and TypeScript, no application dependencies or frozen install. Not G01/G02 certification.
