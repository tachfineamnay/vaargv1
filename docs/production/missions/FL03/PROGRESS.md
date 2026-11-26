# Progress

Source e249ce5e5eba688f782be9f5dce1480d5dbd7399 at entry; branch arena/72f30fcb-vaargv1.
GRAPHIFY_BLOCKED: `graphify` not found (exit 127); direct source navigation used per mission order.
No graph results claimed. All 8 mission tasks implemented as source; next exact action at end.

- TASK 1 — boundaries: `apps/api/src/catalog/catalog.service.ts` rewritten on NestDI: MerchantAuthService
  injected from IdentityModule (manual instantiation removed), TenantContextResolver injected for host
  identification (legacy) and verified tenant resolution with active-store check (v1); legacy
  `/catalog` contract preserved (routes, query schema, NOT_CONFIGURED envelopes, market currency
  check). CSRF: `assertCatalogCookieCsrf` applied to every cookie-capable catalog mutation
  (merchant/logout, sync, sync/step, sync/delegation, v1 equivalents) via shared
  `assertSafeCookieMutation`. CatalogModule imports Tenant+Identity modules; both controllers
  registered. `test/catalog.test.ts` adapted to DI with all prior assertions preserved + new v1 cases.
- TASK 2 — adapter: verified Storefront 2026-10 fields added to products/variants queries and Zod
  schemas (sku, position, compareAtPrice, image, quantityAvailable, currentlyNotInStock, publishedAt);
  pagination/cancellation/currency-validation/rate-limiter preserved; CommercePort documented as the
  provider-independent seam for future cart/checkout (FL06); codegen NOT_USED (no verifiable schema
  for the pinned 2026-10 integration; typed GraphQL + runtime Zod preserved). Shared contracts
  extended additively (backwards compatible).
- TASK 3 — model: migration `0010_catalog_normalized.sql` (forward-only; 7 tables:
  catalog_products, catalog_variants, catalog_product_media, catalog_product_attributes,
  catalog_collections, catalog_collection_members, catalog_search_documents; store+market composite
  FKs to catalog_imports/products; unique handles; numeric(20,6) money + explicit currency; visible/
  generation freshness columns; RLS enable+force+policy per table; grants to vaarg_app; trgm GIN
  indexes). Drizzle declarations added in `schema/catalog.ts` (existing catalog tables included for
  declaration consistency) and exported from schema/index + package index.
- TASK 4 — synchronization: `commerce/scope.ts` (shared store-scoped transaction boundary;
  import.ts refactored onto it without behavior change); `commerce/catalog-projection.ts`
  (applyCatalogPage: same-transaction normalized upserts per committed page; reconcileCatalogGeneration:
  generation-scoped visibility flip + stale membership cleanup at completion); import.ts calls both
  inside the existing checkpoint transaction (provider fetches remain outside any transaction;
  lease/CAS/receipts mechanisms untouched; failed page apply rolls back checkpoint).
- TASK 5 — API: `/v1/catalog` (products list/detail+related+compatible-options, variants,
  collections+detail+products, filters facets, compare, search, status, authorized sync
  commands with CSRF). Bounded cursor pagination (validated base64url cursors), deterministic sorts,
  curated Zod DTOs only (no raw rows/metafields/secrets), explicit NOT_CONFIGURED/NOT_SYNCED/
  IN_PROGRESS/STALE/FRESH. Numeric path refs resolve to stable gids server-side.
- TASK 6 — search foundation: catalog_search_documents populated in the same page transaction
  (normalized title/body/tags, sha256 content hash, market scope, stable refs); deterministic
  lexical search (pg_trgm similarity + ILIKE fallback, deterministic tie-break ordering, bounded
  cursors). No embedding provider, no new engine; existing pg_trgm/pgvector infrastructure reused
  (vector remains reserved for FL05).
- TASK 7 — knowledge: `commerce/knowledge.ts` exports the exact agent contract names
  searchCatalog/getProduct/getVariant/compareProducts/getCompatibleOptions/getRelatedProducts
  (typed, read-only, provenance+freshness); compatibility is literal UNKNOWN; no inference from
  names/descriptions.
- TASK 8 — wiring: CatalogModule composition updated; worker CLI/job handlers unchanged and reused
  (executeCatalogStep now synchronizes the projection; createCatalogJob remains the reusable
  Hatchet-adapter-ready handler; no competing workflow engine); package exports consistent;
  no Admin API or webhook activation.

Checks: `npx turbo run lint typecheck build test` PASS (20/20 tasks) at final state; new unit tests:
persistence catalog-projection 9 PASS (caught and fixed two attribute-insert parameter bugs), api
catalog 8 PASS; PG/live-provider gates NOT_RUN (no PostgreSQL/Docker/provider in sandbox);
PG-gated suites extended for real certification (catalog-import fixture applies 0010 and asserts
normalized rows; new apps/api/test/catalog-v1.pg.test.ts covers all v1 endpoints + CSRF + isolation).
Legacy API PG test untouched and still valid.

Next exact action: commit to arena/72f30fcb-vaargv1, push, open one PR to main (no merge), report.
