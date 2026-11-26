# P02 evidence and provider gate

Official Storefront references reviewed:
- https://shopify.dev/docs/api/storefront/2026-10 — versioned endpoint, errors and automated traffic limits.
- https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/in-context — applied country/language context.
- https://shopify.dev/docs/api/storefront/2026-10/queries/products — cursor-based products.
- https://shopify.dev/docs/api/storefront/2026-10/queries/localization — country currency and language context.
- https://shopify.dev/docs/api/storefront/2026-10/interfaces/Media — media variants.
- https://shopify.dev/docs/api/storefront/2026-10/queries/product — contextual visibility and media.

Real Storefront test: NOT_RUN. On an explicitly authorized test store, inject `SHOPIFY_REAL_TEST=1`, `SHOPIFY_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_COUNTRY`, and `SHOPIFY_LANGUAGE` into the local process, then run `pnpm --filter @vaarg/persistence exec vitest run test/shopify.real.test.ts`. Do not write secrets or provider payloads into this repository. The test performs read-only product/collection requests and a second product page if present. It does not prove two-market comparison, full catalog reconciliation or workflow durability.

The API's catalog response is currently NOT_CONFIGURED: trusted tenant resolution, store-to-Shopify configuration binding and projection reads are not connected. The CLI expects those associations to be supplied by its operator and does not enforce binding; do not use it against real stores until corrected. The adapter's rate limit is per client process only, not shared across workers. P01 uses a hardcoded default runtime role password in its existing migration; the deployment credential must not be relied on, and this remains unresolved. No deployment, push or external catalog mutation was performed.
