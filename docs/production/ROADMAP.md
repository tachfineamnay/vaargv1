# VAARG̈ V1 — Production roadmap

**Status :** documentation bootstrap. No implementation delivered. P00 is the next authorized mission. All missions are local/self-hosted; no hosted CI or automatic deployment.

## Mission sequence

### P00 — Industrial bootstrap
Implement actual runnable web/API/worker boundaries, shared Zod contracts, strict TypeScript, reproducible pnpm/Turbo, frozen install, build/lint/typecheck/test/smoke, safe example configuration, Docker development and healthchecks. Pin stable compatible releases. Record Arena capabilities and local verification commands. Examine integration requirements without claiming live compatibility. No P01 data migrations, business features, real credentials or deployment. AC-28/29 partial evidence only.

### P01 — Core data, identity and store isolation
PostgreSQL 18 / Drizzle / pgvector, Valkey. Migrations idempotent, RLS by store_id, tenant context on every request. Core tables: store, store_config, customer_profile, customer_memory (facts, provenance, negative prefs, gifts), consent, purchase_projection, workflow_bookkeeping. Valkey namespaces. No cross-store PII. Migration and seed scripts; fresh/upgrade test.

### P02 — Shopify catalogue and Storefront API
Storefront API client with typed queries, caching (Valkey, store-scoped), error/retry, webhook HMAC. Products, collections, variants, prices, inventory, metafields, media, engraving options. Search FTS/trigram/vector on Postgres; no external search service by default. Fixtures when token absent; clearly labeled. AC-05, AC-24, AC-26 partial.

### P03 — Storefront SSR and design fidelity
Next.js 16 app router, React 19, SSR home with Bento tiles, category/list/detail, cart, navigation, search, SSR without AI. Preserve reference design direction (header, Bento, heritage Art Deco, personal shopper entry, mobile-first). Accessibility, focus, reduced motion, i18n/markets skeleton. AC-01, AC-02, AC-03, AC-25 partial.

### P04 — Adaptive search, navigation and experience
Shared context store (server + client), scroll-aware adaptation without layout shift, URL stability, explicit filters preserved, personalization opt-out, A2UI catalog registration. AG-UI/SSE transport for dialogue. Search suggestions, guided refinement, comparison. AC-02, AC-03, AC-04, AC-26.

### P05 — Hermes swarm, A2UI and AG-UI
Hermes private hierarchical swarm: Discovery, Experience, Commerce, Memory, Marketing, Support. Hatchet durable workflows. ToolBroker with allowlists, budgets, cancellation, delegation limits. A2UI component catalog, validated actions, AG-UI/SSE bridge. Gemini/DeepSeek direct keys; AI SDK optional adapter. No second swarm, no hidden paid fallback, no arbitrary terminal/SQL/Docker. AC-06, AC-07, AC-08, AC-09, AC-10, AC-27.

### P06 — Cart, checkout, markets and engraving
Cart persisted (Valkey + Postgres), merge on login, cross-device. Shopify checkout redirect with signed cart token, webhook order confirmation. Markets: currencies, languages, availability, duties estimate. Engraving: validated options, preview, price delta, order note. No custom checkout in V1. AC-11, AC-12, AC-13, AC-25.

### P07 — Customer account, purchase history and memory
Customer Account API: login, profile, orders, refunds, engraving history. Persistent memory: facts, provenance, negative preferences, purchase projection, gifts separated. Rehydration on return. Consent CRUD, deletion, unsubscribe. AC-14, AC-15, AC-16, AC-17, AC-23, AC-24.

### P08 — Merchant, CDP, segmentation and support
/merchant RBAC owner/marketing/support. 360° customer profile with evidence, last order, timeline, prefs/aversions, coverage/freshness, authorized notes. Segments and RFM reproducible net of refunds by currency (no implicit multi-currency sum). Conversion metrics distinguishing checkout vs sale. Support workspace (buyer + merchant), authorized order only, return rules verified, human escalation. Support Agent reads/proposes, never refunds autonomously. Marketing segment handoff with purpose boundaries. AC-18, AC-22, AC-23, AC-24.

### P09 — Agentic marketing and newsletter
Marketing Agent drafts, per-segment/individual variations with authorized prefs/history. React Email, EmailPort (Resend candidate). Campaign revision immutable, preview, cost/eligible audience, human approval, schedule/cancel, Hatchet dispatch. Suppression list and opt-in revalidated at send; unsubscribe without login; authenticated email webhook; bounces/complaints; frequency/timezone; no unauthorized tracking. Separate transactional from marketing; avoid Shopify duplicate. One logical dispatch per revision/recipient; UNKNOWN state, reconcile before retry. No real sends by default; authorized test mailbox only. SPF/DKIM/DMARC before production. AC-19, AC-20, AC-21, AC-23, AC-29.

### P10 — Release candidate and local certification
All P00–P09 integrated; external access for concerned gates. Full integration/E2E/security tests, supply chain, secrets/logs redacted, provider quotas, cancellation, accessibility, SEO/i18n. k6 100k products / 500 sessions, measured infra, PRD §12 thresholds. No abusive load. Docker locked, fresh/upgrade DB, restart worker/Hatchet, replay inbox/outbox, encrypted backup, restore/rollback, redactions reapplied. RPO 24h / RTO 4h measured. Pino/OTel, health/readiness, alerts. Local certification script, AC-01..30 matrix, runbooks, exact SHA report. Codex audit on local/self-hosted. No silent threshold drop; no invented PASS. RC may be delivered for integration if infra/keys missing, but NO-GO full V1 until critical gate passes.

### P11 — Controlled production deployment
RC certified + explicit founder/merchant approval for external actions. Real Coolify config, web/api/worker/Hermes private/Hatchet + deps/PG/Valkey, separate Hatchet roles/DBs, secrets injected, Cloudflare/DNS/TLS, S3 backups. Sizing per measurements (single VPS not HA). Non-destructive migration, rollback/restore plan, network exposure check. Authorized Shopify/email tests, approved data policy/legal texts, AI budgets/limits, markets/shipping, origin store verified intact. Staging/test isolated if authorized; no infra creation or DNS change without approval. Gate: AC-28/30 on real infra, smoke and authorized flows, all 30 criteria on exact SHA/image, documented GO/NO-GO. Switch only after approval. Post-deploy health, logs, flows; rollback on critical anomaly. No automatic campaign send at launch.

## Coverage matrix (PRD AC-01..30)
| AC | Primary mission(s) | Gate |
|---|---|---|
| 01 | P03 | Home SSR without AI |
| 02 | P04 | Adaptation / scroll |
| 03 | P04/P05 | Shared context |
| 04 | P04/P05 | Stale revisions rejected |
| 05 | P02/P04/P06 | Verified products |
| 06 | P05 | A2UI validation |
| 07 | P05 | Real delegation |
| 08 | P05 | Confinement |
| 09 | P05 | Provider / fallback |
| 10 | P05/P06 | Safe degradation |
| 11 | P06 | Real cart |
| 12 | P06/P07 | Checkout & order |
| 13 | P06 | Engraving verified |
| 14 | P07 | Buyer account |
| 15 | P07 | Purchases / refunds |
| 16 | P07 | Memory on return |
| 17 | P07 | Provenance / gifts |
| 18 | P08 | CDP & metrics |
| 19 | P09 | Marketing variations |
| 20 | P09 | Permissions |
| 21 | P09 | Idempotent dispatch |
| 22 | P08 | Support |
| 23 | P07/P08/P09/P10 | Rights & propagation |
| 24 | P01/P07/P08/P10 | Store isolation |
| 25 | P03/P06/P07/P10 | Markets / SEO / a11y |
| 26 | P04/P10 | Performance |
| 27 | P02/P05/P07/P09/P10 | Workflow durability |
| 28 | P00/P01/P10/P11 | Install / migration / restore |
| 29 | All / P10 | Security & secrets |
| 30 | P11 | Origin store & domain |

## External prerequisites
| Prerequisite | When | If absent |
|---|---|---|
| Repo / file access | P00 | Create locally if authorized, explicit transfer |
| Exact mockups | P03 | Graphic fidelity blocked; do not invent theme |
| Storefront API | P02/P06 | Fixtures labeled, real BLOCKED |
| Gemini / DeepSeek key | P05 | Contracts/doubles, no hidden fallback |
| Admin, Customer Account, data rights | P07 | Account/history real BLOCKED, coverage visibility |
| Engraving / markets options | P06 | Feature explicitly unavailable |
| Email / domain / opt-in | P09/P11 | Previews, authorized test mailbox only |
| Docker / Coolify / resources / S3 | P10/P11 | Local recert per capacity, deploy BLOCKED |
| Data policy & merchant approval | P11 | NO-GO real traffic concerned |

Reference path: P00 → P01 → P02 → P03 → P04 → P05 → P06 → P07 → P08 → P09 → P10 → P11. Hermes/A2UI feasibility may be anticipated; P06 classic may advance before P05. No two branches modifying same migrations/contracts without coordination. No arbitrary calendar or guaranteed velocity; batch size adapts to real Arena limits.
