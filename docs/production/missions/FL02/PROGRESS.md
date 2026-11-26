# Progress

Source dbb3147b7eb3b187aec17a752011760a81d56e92 at entry; branch arena/943b6362-vaargv1.
GRAPHIFY_BLOCKED: `graphify` not found (exit 127); owner-authorized direct source navigation. No graph results claimed.

All 8 FL02 tasks implemented as source:
- Shared: `packages/shared/src/application.ts` (TenantContext, MerchantIdentity, VisitorSession,
  SessionContext, Permission/ROLE_PERMISSIONS, Consent purposes + purpose checks, request/response
  DTOs, structured error body contract) exported from index.
- Persistence: `tenant/tenant-context.ts` (host → operator binding → RLS-scoped store status →
  correlation id; UNKNOWN_HOST/STORE_MISSING/STORE_INACTIVE/INVALID_CORRELATION_ID),
  `sessions/visitor-session-cache.ts` (store-scoped, hashed-token keys, TTL = expiry, write-through,
  never serves revoked/expired), `MERCHANT_SESSION_TTL_MS` exported.
- API modules: `infra/infra.module`, `tenant` (resolver + decorator + module), `identity`
  (MerchantAuthService: login/logout/me/refresh/authorize + rate limit; MerchantAuthGuard,
  PermissionsGuard + @RequirePermissions; IdentityController /v1/merchant/auth/*, HttpOnly
  host-only cookies, CSRF Origin check on cookie mutations), `sessions` (POST/GET/rotate/DELETE
  /v1/sessions…), `privacy` (GET/POST /v1/privacy/consents with server-side actor resolution,
  append-only record + audit in one store-scoped tx, purpose checks), `catalog` module reusing
  MerchantAuthService; cookie-aware authorization fallback in catalog controller.
- main.ts/config: TRUST_PROXY explicit trusted-proxy boundary (default false), .env.example note.
- App wiring: AppModule composes the six modules; health probes unchanged.

Checks at final: `pnpm -r typecheck` PASS; `pnpm -r test` PASS (50+22+4+9 unit; PG/live e2e
NOT_RUN — env-gated); `pnpm -r build` PASS; eslint shared/persistence/api PASS.
Existing tests untouched and passing.

Next: commit + push + single PR to main; DeepSeek/Coolify integration, design and certification
deferred per mission order.
