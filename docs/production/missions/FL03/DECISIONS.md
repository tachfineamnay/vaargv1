# FL03 Decisions

1. **DI over manual construction (TASK 1).** CatalogService now receives MerchantAuthService and
   TenantContextResolver through Nest DI; `new MerchantAuthService(...)` removed. The existing unit
   test was adapted to the new constructor (all prior assertions kept, coverage extended) — the
   constructor change is required by the mission and preserves FL02 behavior.
2. **Legacy list keeps host-only identification.** The legacy `/catalog` read path keeps
   `tenants.identify()` (no DB store-status round trip) to preserve FL02 behavior byte-for-byte;
   every v1 read uses `tenants.resolve()` with active-store verification. Recorded as a deliberate
   compatibility boundary; v1 is the hardened surface going forward.
3. **CSRF on cookie-capable catalog mutations.** Any catalog mutation reachable with a cookie
   credential (bearer stays unaffected) passes `assertSafeCookieMutation` with the server-identified
   host — same rule as the identity module.
4. **Adapter extension = verified Storefront fields only (2026-10).** Added: ProductVariant sku,
   position, compareAtPrice, image, quantityAvailable, currentlyNotInStock; Product publishedAt.
   No speculative fields; GraphQL Code Generator NOT_USED because no verifiable schema exists for
   the pinned 2026-10 integration — typed GraphQL requests with runtime Zod validation remain the
   contract (mission-approved fallback). `CommercePort` stays provider-independent; future
   cart/checkout extends the port, not the Shopify client.
5. **Market scope carries translations.** Product translations are the (store_id, country, language)
   scoped rows themselves (contextualized Storefront responses); a separate translation table would
   duplicate truth. PRD §7 `variant_market_prices` is satisfied by catalog_variants' exact numeric
   price + explicit currency per market.
6. **Relationships derive at read time with explicit provenance.** Collection membership rows
   (`catalog_collection_members`, provenance = collection gid) are the stored relationship evidence;
   pair co-membership materialization is derived deterministically at read time to avoid unbounded
   growth. Related-product fallback uses the verified `product_type` value only (provenance = the
   type value); nothing is inferred from names or descriptions.
7. **Membership insertion is existence-guarded.** A collection page inserts membership rows only for
   products that already exist in that market (products phase runs first inside a sweep), so a
   provider ordering anomaly can never break the checkpoint transaction.
8. **Reconciliation is generation-scoped visibility, not deletion.** At sweep completion, rows from
   older generations are kept as evidence but marked invisible (products, variants, collections,
   search documents); stale collection members are deleted (rebuildable). All statements are scoped
   by (store_id, country, language) — other markets are never touched.
9. **Price filtering is single-currency and server-owned.** Price-range filters always resolve the
   market currency from the operator binding; a client `currency` that disagrees with the market is
   a 400. Exactness via numeric(20,6) + explicit currency.
10. **Cursors are validated opaque envelopes.** Bounded base64url JSON tuples (sort key, stable gid,
    optional score), schema-validated on decode; invalid cursors are request errors. Deterministic
    orderings always end with the stable gid tie-break.
11. **List endpoints can report NOT_CONFIGURED as data; single-resource endpoints raise 503.** This
    mirrors the legacy envelope behavior while keeping detail DTOs strictly market-scoped.
12. **Knowledge facade = read model, exact contract names.** searchCatalog/getProduct/getVariant/
    compareProducts/getCompatibleOptions/getRelatedProducts are typed read-only functions over the
    same store-scoped boundary; no new trust surface, no autonomous behavior, ToolBroker integration
    deferred to FL06/FL07.
13. **No second workflow engine.** Worker keeps JobRunner + createCatalogJob (delegation ticket,
    replay-safe); FL06 Hatchet integration will adapt these handlers. CLI remains a one-step
    execution boundary for schedulers.
14. **Migration policy.** 0010 is forward-only, additive, RLS-complete; no existing migration edited;
    no destructive statement; `stores`/`catalog_imports` FKs allow cascade cleanup without orphaned
    derived rows.
