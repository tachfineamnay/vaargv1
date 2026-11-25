# Local certification

No production release exists yet. The following gates apply when a release candidate is assembled (P10). They are not satisfied by documentation alone.

## Required evidence
- **Install / typecheck / lint / build** — frozen lockfile, exact versions recorded, zero errors on supported OS/runtime.
- **Unit / integration / E2E** — meaningful coverage of domain, auth, isolation, idempotence, retry, contracts, migrations and adaptation logic. Synthetic fixtures only unless authorized real access.
- **Real provider / security** — CSRF/XSS/SSRF/injection, store isolation (RLS, cache keys, sessions, tools, jobs), webhook HMAC/replay, Hermes confinement, ToolBroker allowlists, rate limits, secrets audit, dependency and image vulnerability scan, license audit. No customer data or paid fallback in evidence.
- **Performance** — k6 with 100k synthetic products / 500 concurrent sessions, realistic load profile and measured infra. PRD §12 thresholds: CWV p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1; search p95 ≤200ms (provider excluded); API p95 ≤150ms; first useful AI response p95 ≤2s target. Not abusive to Shopify or providers; distinguish local vs real.
- **Operations** — Docker images locked by digest, fresh and upgrade DB migration tested, worker/Hatchet restart, inbox/outbox replay, encrypted external backup, restore and rollback verified, redaction re-applied. RPO 24h / RTO 4h measured. Pino/OTel, health/readiness, alerts.
- **Governance** — local certification script, AC-01..30 matrix, runbooks, exact SHA report. Codex independent audit on local/self-hosted env. No silent threshold reduction; no invented PASS.

## Missing prerequisites gate
If Docker, external keys, Shopify Admin/Customer Account, email domain, deployment resources or legal approvals are missing, the affected gates are BLOCKED or NOT_RUN and V1 complete is NO-GO. A storefront-only scope may be authorized separately but is not full V1 certification.

Do not mark any gate PASS_REAL without executed command, exit code, tested SHA and sanitized evidence path.
