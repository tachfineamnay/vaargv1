# FL04 Decisions

(Updated as decisions are made during implementation.)

- GRAPHIFY_BLOCKED: `graphify` not found (exit 127) at mission start; direct source navigation used per mission order.
- Docker/PG/Valkey/live-provider gates NOT_RUN (no docker binary, apt network blocked, no postgres/valkey binaries); implementation continues independently per mission order.
- Host forwarding uses `node:http` with an explicit `Host` header: Node `fetch`/undici strips caller-supplied `host` (verified in-sandbox), so `fetchCatalog`'s header contract only holds under mocked fetch. `fetchCatalog` + its test contract are preserved untouched; all new pages use the typed transport.
- Server pages resolve the storefront host from the `headers()` `host` value (validated). `x-forwarded-host` is consulted only when `host` is loopback (preview proxies that rewrite Host); security note: exposed data is public storefront catalog, API still validates the host against bindings.
- BFF constructs upstream `Origin` as `https://<hostname>` (always in the API's allowed list for both dev and production) and enforces its own same-origin check on incoming mutations.
- Consent writes from an unlinked visitor session are rejected by FL02 semantics (`403 Verified customer identity required`); the preferences UI surfaces the real API response and never fakes local success. Identity linking arrives in a later mission.
- Variant selection: prefer first `availableForSale` variant; URL `?variant=` wins when explicit; no fallback to another variant on non-matching combinations; never silently select an unavailable variant.
- `/search` uses the FL03 lexical `/v1/catalog/search` endpoint only (no sort/filters there); sorting/filtering live on `/products` and `/collections/[handle]`.
- Filter/sort/search apply via native GET forms (server components, no JS required); pagination via Links with a comma-joined cursor trail (`c=`); any filter/sort/q change drops the trail (page reset).
- Compare selection lives in a client context (max 4); `/compare?ids=` is the authoritative view state (deep-linkable, seeded into context on mount).
- `getCompatibleOptions` is implemented on the client and exercised by unit tests; the product page renders compatibility/personalization from that endpoint when it succeeds and omits the panel on failure (secondary section, no fake data).
- Session bootstrap is eager on provider mount (GET current → POST when401); recovery re-bootstraps when an active session later returns 401 (expiry/revocation); rotate exposed via BFF + preferences refresh action.
