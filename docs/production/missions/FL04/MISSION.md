# FL04 — Functional Storefront

Source SHA at entry: 1ee0f57aa4fd5fbd9d98e28474a3c0d5db8694ed (main baseline, verified).
Branch: arena/5d6debb8-vaargv1 (work branch; one PR to main at delivery, no merge).
GRAPHIFY_BLOCKED: `graphify` command not found (exit 127); one remediation attempt (command lookup)
failed; direct source navigation authorized per mission order and FL02/FL03 precedent. No graph
results claimed.

Scope: complete functional storefront consuming the FL03 `/v1/catalog` API — typed server-side API
client, storefront routes (home/collections/products/detail/search/compare), reusable catalog and
search components, URL-authoritative filter state, deterministic variant selection, visitor session
and consent integration through a constrained same-origin BFF, typed section composition model,
SEO/sitemap/robots/locale foundations. Shopify stays commercial truth; no fake products, prices,
reviews or purchases. Cart/checkout/engraving mutations stay disabled until FL08.

Out of scope (mission order): backend rebuild, hybrid/vector search (FL05), Hermes/AG-UI/A2UI
protocol, deployment/Coolify, final visual design, comprehensive certification, live Shopify access.

Constraints: strict TS, minimal CSS, preserve existing tests and health routes, no unrestricted API
proxy, no secrets in browser bundles, no customer content in shared caches, checkpoints under
docs/production/missions/FL04/.
