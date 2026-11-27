# FL05-FIX Decisions

- D01: RLS via scopedCatalogTransaction (existing helper); no privileged bypass.
- D02: Idempotency via INSERT RETURNING seq-ordered newly-inserted only; duplicate-only returns without persist.
- D03: Capability market scope resolved from operator STOREFRONT_BINDINGS (server), consent re-read from DB; scope.personalizationGranted never trusted.
- D04: Hard filters centralized by exporting search-port constraintsSql and reusing in recommendations.
- D05: Vector channel joins visible search docs with content_hash match; per-channel ORDER BY before LIMIT; method/request mode mismatch throws.
- D06: Single observable store in experience-client.ts; no second state architecture.
- D07: Storefront search via session-free tenant-only endpoint returning verified summaries; lexical default, hybrid only when mode=hybrid.
- D08: Optional events (product_viewed, comparison_changed) not persisted without personalization; withdrawal clears DB+cache immediately in ConsentService.
- D09: Publication revalidates contextVersion + active session in-transaction; stale => 409 conflict; Valkey set guarded by version.
- D10: Forward 0013 adds provider to embedding identity; legacy rows are explicitly
  `legacy-unverified`, excluded until an authorized incremental reindex. Applied
  migrations remain unchanged. Generation and content hash must both match.
- D11: Expiry/purge retains monotonic revision tombstones for active sessions;
  payloads are cleared at retention, avoiding version-zero ABA publication.
- D12: Essential events without personalization keep minimal idempotency receipts,
  not raw search/filter history. No analytics collector is added; analytics consent
  never substitutes for personalization (or vice versa). Withdrawal scrubs raw
  personalization payloads while preserving bounded deduplication receipts.
- D13: Context reads deliberately bypass Valkey and use PostgreSQL authority;
  cache adapter writes use Lua CAS only, with no unsafe GET/SET fallback.
- D14: Navigation preserves keepalive delivery but rejects its obsolete response;
  reset/session changes abort it. Browser lifecycle generation guards also prevent
  pending session refresh/bootstrap responses from undoing rotation/revocation.
- D15: Capabilities are private implementations exposed only through an async
  factory bound to a verified request credential. The returned interface accepts
  no authority scope argument; even SearchRequest.scope/context are overwritten.
  Each invocation re-resolves live session/consent against the captured complete
  market scope. No agent-supplied store/session/consent can establish authority.
