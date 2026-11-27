# FL07 — Agentic Storefront, A2UI 1.0, and AG-UI

- **Repository**: `tachfineamnay/vaargv1`
- **Working branch**: `arena/a0dd7ed0-vaargv1`
- **Verified base SHA**: `206c9aff23b0fa714b583ef18ea62a64e02104cf` (`main`)
- **PRD SHA-256**: `7e49d94144b4fd24b8968652664c354d5d8949946d9d9773c8314cbb630f8596`
- **Graphify**: `GRAPHIFY_BLOCKED` (`graphify` CLI unavailable in sandbox; exit 127; authorized direct source navigation)
- **Pinned protocol dependencies**:
  - `@ag-ui/core`: `1.0.5`
  - `@ag-ui/encoder`: `1.0.5`
  - A2UI specification: official `1.0` (`https://a2ui.org/specification/v1_0/agent_to_renderer.json`, `renderer_to_agent.json`, `common_types.json`, `catalog_definition.json`)
  - Preserved FL06 pins: `NousResearch/hermes-agent@v0.23.4` (`8fc0374447313e276f6b9a2764bfc750190c966a`), `@hatchet-dev/typescript-sdk@1.49.1`

## Scope
- **T00**: Targeted FL06 corrections (no GET side-effect publication; explicit CSRF-protected idempotent POST publication decoupled from run sync; remove hardcoded `gemini`/`gemini-2.5-flash` fallbacks in `vaarg-confinement`; safe bounded Hatchet catalog sync continuation without false completion; fail-closed Hermes admission on unverified confinement/routing/preventive budget enforcement).
- **T01**: Official AG-UI (`@ag-ui/core@1.0.5`, `@ag-ui/encoder@1.0.5`) server event adapter over `AgentPort` & `ConversationService` (`RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `STATE_SNAPSHOT`, `STATE_DELTA`, safe step/tool activity events, namespaced `CUSTOM` A2UI 1.0 & VAARG events).
- **T02**: Secure versioned AG-UI HTTP/SSE endpoint in NestJS/Fastify with PostgreSQL durable event sequence/replay, SSE `id:` + `Last-Event-ID` reconnect without duplicate paid inference, explicit resync fallback, heartbeat, cancellation vs stream disconnect separation.
- **T03**: Session-bound constrained Next.js BFF routes (`/api/agent/*`) preserving `HttpOnly` cookies, `Host` authority, CSRF Origin validation, incremental SSE streaming with backpressure/abort, and zero trust in client model/provider/policy fields.
- **T04**: Deterministic A2UI 1.0 compiler (`AdaptiveComposition` -> `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`) + official `catalog_definition.json`-compliant VAARG catalog (`https://vaarg.io/a2ui/v1_0/catalog.json`).
- **T05**: Dual server + client A2UI 1.0 surface security validator (version `1.0`, catalog ID, surface ownership, component schemas, unique IDs, `root`, child refs, max depth/count/bytes, cycle detection, RFC 6901 `@path` bounds, prototype-pollution/XSS/URL/function-call rejection).
- **T06**: VAARG React A2UI component registry (`CategoryTile`, `CollectionGrid`, `AdaptiveBento`, `ProductCard`, `ProductGrid`, `ProductGallery`, `Recommendations`, `ProductComparator`, `SuggestionChips`, `GuidedQuestions`) reusing FL04/FL05 components, plus non-executable future contracts (`EngravingConfigurator`, `BundleBuilder`, `CartSummary`, `OrderTracking`, `SupportCard`).
- **T07**: Persistent Personal Shopper storefront assistant integrated with `SessionProvider` (preserved across route transitions without `localStorage` transcript/credential storage, safe master stream, cancel, reconnect/retry, suggestion chips, contextual A2UI surfaces, honest unavailable degradation).
- **T08**: Unified FL05 experience + conversation context reducer (`contextVersion`, `experienceRevision`, `conversationRef`, explicit criteria, comparison selection, consent revalidation before personalized publication, stale/superseded rejection, scroll/focus/variant preservation).
- **T09**: Controlled typed A2UI action dispatcher (`view_product`, `view_collection`, `refine_search`, `update_explicit_criteria`, `compare_products`, `answer_guided_question`, `request_composition`, `return_to_general_exploration`; explicit unavailable/proposal-only refusal for FL08–FL11 commercial/support/campaign actions).
- **T10**: End-to-end integration, focused security/protocol regressions, build/typecheck/lint/test verification, checkpoints, branch push, and single PR targeting `main`.
