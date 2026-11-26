# FL03 Tasks

1. Mission files + baseline verification (e249ce5) — DONE.
2. TASK 1 application boundaries: CatalogService uses DI (TenantContextResolver + MerchantAuthService
   injected, no manual instantiation), active store verification via tenant resolver, CSRF enforcement
   on cookie-authenticated catalog mutations, legacy routes preserved — DONE.
3. TASK 2 Shopify adapter: extend verified Storefront fields (variant sku/position/compareAtPrice/
   image/quantityAvailable/currentlyNotInStock, product publishedAt) in shared contract + adapter +
   queries, 2026-10 preserved, CommercePort documented as provider-independent seam for future
   cart/checkout; codegen NOT_USED (no verifiable schema for pinned 2026-10; typed GraphQL + runtime
   Zod preserved) — DONE.
4. TASK 3 normalized catalog model: migration 0010 (catalog_products, catalog_variants,
   catalog_product_media, catalog_product_attributes, catalog_collections,
   catalog_collection_members, catalog_search_documents) + Drizzle schema declarations + exports;
   market-scoped translations via (store,country,language) scope; RLS + grants; numeric money — DONE.
5. TASK 4 projection synchronization: page payloads applied to normalized tables in the same
   checkpoint transaction (import.ts), completion reconciliation (generation-scoped visibility),
   stale-worker protection inherited from lease/CAS, no open tx during provider calls — DONE.
6. TASK 5 catalog API: /v1/catalog endpoints (products list/detail by handle and numeric id,
   collections list/detail/products, variant detail, filters facets, deterministic compare, related,
   authorized sync commands), bounded cursor pagination, deterministic sort, shared Zod DTOs,
   freshness states — DONE.
7. TASK 6 search foundation: catalog_search_documents (normalized text, content hash, market scope,
   stable refs) + trgm/tsvector indexes + deterministic lexical search in the read model; no
   embedding provider — DONE.
8. TASK 7 agent knowledge: typed read-only services searchCatalog/getProduct/getVariant/
   compareProducts/getCompatibleOptions/getRelatedProducts with provenance + freshness; unknown
   compatibility stays UNKNOWN — DONE.
9. TASK 8 wiring: CatalogModule imports Identity/Tenant modules, worker handlers unchanged
   (reusable for Hatchet in FL06), package exports updated, docs checkpoints — DONE.
10. Checks: pnpm -r typecheck/build/lint/test (unit); PG/live gates NOT_RUN — see VALIDATION.
11. Commit, push working branch, single PR to main, no merge — DONE.
