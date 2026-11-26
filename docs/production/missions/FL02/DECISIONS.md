# Decisions

- GRAPHIFY_BLOCKED recorded at entry; direct navigation authorized by owner.
- No migration added: 0000–0009 already provide store-scoped composite FKs, tenant-aware unique
  indexes, RLS tenant policies (incl. merchant_sessions 0006, consent tables, visitor_sessions),
  restricted-role assertions and checksum-locked ordering. Never edited applied migrations.
  `migrations/meta/_journal.json` only lists 0000 (drizzle-kit metadata drift predating FL02);
  file-ordered `runMigrations` is authoritative — left untouched to avoid touching FL01 locking.
- Consent history is append-only at the application level (recordConsent only inserts; no
  update/delete path exists); effective projection `marketing_permissions` upserted in the same
  store-scoped transaction as history + audit row.
- Consent purposes reuse the existing vocabulary (analytics, personalization, marketing_email,
  marketing_push, data_retention) instead of introducing parallel terms.
- Tenant authority: direct Host header + operator `STOREFRONT_BINDINGS_JSON` + DB store status.
  Client storeIds rejected at strict Zod boundaries; forwarded headers ignored unless
  `TRUST_PROXY=true` (explicit deployment boundary, default false).
- Catalog sync/list keep the legacy binding-based authorization contract (frozen unit test
  `apps/api/test/catalog.test.ts` untouched); full status-enforced tenant resolution guards all
  new /v1 surfaces, merchant login/refresh and catalog login via MerchantAuthService.
- Session tokens are issued exactly once at login/rotation (response body, HTTPS) and stored only
  as SHA-256 hashes; GET endpoints never return tokens. Cookies are HttpOnly, SameSite=Lax,
  host-only, Secure in production; no tokens in URLs/logs/localStorage.
- Cookie-authenticated mutations require a matching Origin (CSRF); bearer clients unaffected.
- Anonymous visitor sessions never gain a customer identity; Shopify customer-account linking is
  deferred to the later customer mission. No newsletter dispatch or privacy deletion in FL02.
- Logout revokes within host scope without an active-store check (destroying one's own session is
  always allowed); login/refresh enforce active store status.
