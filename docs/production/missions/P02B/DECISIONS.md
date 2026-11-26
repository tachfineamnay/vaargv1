# Decisions
- Continue directly on existing cumulative mission branch and preserve unrelated untracked checkouts. The user explicitly authorizes a local cumulative commit, not push/merge/deploy.
- P02A merchant HTTP session integration remains a prior gap; protected sync operations must fail closed without verified merchant membership rather than assume a principal.

Store mappings are operator-owned, contain only a secret environment-variable name (SHOPIFY_ prefix), and bind each hostname to one explicit country/language/currency. The direct Host header must match an exact configured hostname; never derive trust from forwarded-host headers. A trusted reverse proxy must preserve the authorized public Host header.

Each import page holds a 120-second lease with checkpoint compare-and-set; a slow or crashed worker loses its lease and cannot overwrite a later result. Valkey pacing is shared by store UUID and fails closed when unavailable. No new workflow engine is introduced.

Protected operational routes accept bearer tokens only, never cookies, and recheck the P02A merchant session and tenant role in PG at each request. Start persists an import state; an authorized caller invokes the one-page step. The worker exposes a real authorized job handler, but no Hatchet consumer or background scheduler is represented as connected. Worker payload currently carries an ephemeral bearer token; do not persist it in a future durable workflow without a dedicated revocable delegation mechanism.

Superseding earlier ephemeral-bearer note: worker job payloads now contain only short-lived HMAC-signed delegations, not merchant session bearer tokens. Delegations bind store, merchant, action and job UUID; worker rechecks membership and receipt-backed job replay is idempotent. The issuing API returns a ticket but does not claim to enqueue it; a future Hatchet adapter must transport the ticket without logging it and execute before expiry. CATALOG_JOB_SIGNING_SECRET must be injected independently into API and worker; absent secret leaves delegation unavailable and worker job unregistered.
