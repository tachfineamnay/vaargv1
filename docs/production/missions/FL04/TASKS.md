# FL04 Tasks

Order follows `MISSION.md`. Checkpoints update `PROGRESS.md` after every task.

- [ ] 00 Checkpoint files: MISSION.md exists; TASKS/PROGRESS/DECISIONS/VALIDATION + evidence/ created before code (AGENTS 5-file gate).
- [ ] 01 Shared contract: `catalogV1ProductsQuerySchema` attribute preprocess — colon split to `{name,value}`, fail on missing/empty name or empty value, object passthrough; unit tests.
- [ ] 02 API defect: `listFiltersV1` strips `collection` out of `rawQuery` before strict pick-parse; validate collection ref; unit tests (`?collection=` no longer 400).
- [ ] 03 Web foundation: error taxonomy (`StorefrontError` + kinds), storefront host resolution (Host header, forwarded-host fallback only for loopback), `node:http` typed transport with `Host` override, typed catalog client (13 methods incl. probe), shared-schema validation of responses; unit tests against local stub server (Host forwarding, error mapping, timeout, invalid response).
- [ ] 04 Web state: URL filter/sort/cursor-trail params (parse/serialize, deterministic), variant selection pure logic; unit tests.
- [ ] 05 Web config/SEO/i18n: site.ts drops demo fallback authority + real NAVIGATION, editorial config, composition typed section model + registry, `t()` architecture + money/date formatting, metadata helpers + JSON-LD helpers; unit tests (sections render, i18n fallback).
- [ ] 06 Components: StorefrontHeader, StorefrontFooter, CategoryTile, CollectionCard, CollectionGrid, ProductCard, ProductGrid, ProductGallery, ProductDetail, VariantSelector, PriceDisplay, AvailabilityIndicator, ProductAttributes, ProductComparator, Recommendations, CatalogStatus, SearchInput, FilterPanel, SortControl, PaginationControl, SessionProvider, EmptyState, ErrorState (+LoadingState, CompareProvider/Tray); tests where renderable via renderToString.
- [ ] 07 BFF: `/api/session` (POST bootstrap / GET current / DELETE revoke), `/api/session/rotate` (POST), `/api/consent` (GET/POST) — fixed paths only, same-origin enforcement on mutations, strict body validation, cookie extraction (session cookie only), `Host` + constructed `Origin: https://<host>` upstream, 4s timeout, set-cookie relay; route-handler tests with stub upstream.
- [ ] 08 Routes: `/`, `/collections`, `/collections/[handle]`, `/products`, `/products/[handle]`, `/search`, `/compare`, `/preferences`, `sitemap.ts`, `robots.ts`, `not-found.tsx`, `error.tsx`, `loading.tsx`; per-section honest empty/error states; JSON-LD on product detail.
- [ ] 09 Session/consent UI: SessionProvider lifecycle (bootstrap/current/expire/recover/rotate/revoke), PreferencesPanel consent retrieval + explicit updates + withdrawal surfacing real API responses (incl. identity-required 403, never faked).
- [ ] 10 Checks: `npx turbo run lint typecheck build test`; live smoke (API with dummy env + web dev): health/version, Host-forwarding boundary proof, page render states; evidence captured under `evidence/`.
- [ ] 11 Delivery: update STATUS.md P03, finalize mission files, commit/push branch, open single PR, final <150-word report with GRAPHIFY_BLOCKED.
