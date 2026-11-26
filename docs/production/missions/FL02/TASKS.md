# FL02 Tasks

1. Mission files + baseline verification — DONE (typecheck, tests pass at dbb3147).
2. Shared contracts (TenantContext, MerchantIdentity, VisitorSession, SessionContext, Permission,
   Consent, error body) in @vaarg/shared via Zod — see PROGRESS.
3. Persistence: tenant context resolver (host → binding → store status → correlation id),
   visitor-session Valkey cache (store-scoped, TTL-consistent), exports.
4. API: tenant module (resolver + decorator), identity module (login/logout/me/refresh, guards,
   permissions, cookies, CSRF), sessions module (create/current/rotate/revoke), privacy module
   (consent get/update/withdraw), under /v1.
5. Catalog: reuse identity boundary (MerchantAuthService) without changing constructor or routes.
6. Wire modules into AppModule; trustProxy explicit via TRUST_PROXY env; .env.example note.
7. Persistence consistency review (migrations 0000–0009): document findings; forward migration
   only if strictly necessary.
8. Checks: typecheck, targeted tests, lint. Checkpoint, commit, push, one PR to main.
