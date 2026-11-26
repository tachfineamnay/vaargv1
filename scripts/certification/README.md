# P00 local certification

- `certify.sh` — runs frozen install, lint, typecheck, tests and builds, writing an evidence log to `docs/production/missions/P00/evidence/`.
- `smoke.mjs` — probes a running API (`/health/live`, `/health/ready`, `/version`) and web SSR root. Set `API_SMOKE_URL` / `WEB_SMOKE_URL` to target non-default ports.

Docker and live-provider gates (real PostgreSQL/Valkey/Shopify/AI) are executed by the external certification harness; these scripts prove the local source gate only.
