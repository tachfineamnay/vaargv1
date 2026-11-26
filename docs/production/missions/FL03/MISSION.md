# FL03 — Industrial Shopify Catalog Engine

Source SHA at entry: e249ce5e5eba688f782be9f5dce1480d5dbd7399 (merge of PR #5, verified main baseline).
Branch: arena/72f30fcb-vaargv1 (work branch; one PR to main at delivery, no merge).
GRAPHIFY_BLOCKED: `graphify` command not found (exit 127); `corepack`/pnpm activated for the toolchain.
One reasonable remediation attempt made (command lookup + corepack tooling); Graphify remains unavailable,
direct source navigation authorized per mission order and FL02 precedent. No graph results claimed.

Scope: complete the industrial catalog foundation on top of FL01/FL02 — application boundary repair,
Shopify adapter contract extension, normalized store-scoped catalog projection (PostgreSQL + Drizzle),
transactional projection synchronization, /v1/catalog application API, deterministic lexical search
foundation, agent-readable catalog knowledge services, operational wiring. Shopify stays the only
commercial truth; imported snapshots are provider evidence; derived tables are rebuildable.

Out of scope (mission order): checkout/cart implementation, Admin API ingestion, webhooks activation,
Hatchet integration, embedding providers, new search engines, UI design, deployment, certification.

Constraints: strict TS, forward-only migrations, never edit applied migrations, no destructive
migration, preserve existing tests and behavior, no paid services, no mock-only production endpoints,
RCS: existing legacy /catalog contract untouched except boundary/security corrections.
