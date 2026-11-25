# Certification policy — local / self-hosted

Status: requirements only; no gate executed. PRD §13 AC-01–AC-30 and roadmap mission mapping remain normative. P10 must turn this policy into reproducible scripts and a complete evidence matrix; P11 requires owner authorization.

| Gate | Evidence required |
|---|---|
| G0 Source | exact clean candidate SHA, lockfile, compatible pinned runtime/images, reviewed dependencies/licenses, no secrets |
| G1 Build | clean frozen install, typecheck, lint, unit tests, all executable app builds |
| G2 Data | fresh migrations and populated upgrade, DB constraints, RLS negative tests, outbox/inbox replay/concurrency, actual restore |
| G3 Storefront | real public catalog, SSR/SEO, navigation without AI, accessibility and responsive E2E, market context |
| G4 Swarm | real authorized Gemini or DeepSeek inference, Hermes delegation/confinement, ToolBroker negative tests, budget/cancel, Hatchet resume; A2UI validation and stale-stream rejection |
| G5 Commerce | authorized Shopify Storefront reads and test checkout, pricing/stock/variants/engraving verified, errors/retry/reconciliation; existing store intact |
| G6 Customer | Customer Account identity proof, purchase history scope, two-store/customer isolation, persistent memory and consent/deletion |
| G7 Marketing | approved draft, test delivery to authorized sink, opt-in/unsubscribe, recheck before send, dedup and uncertain send reconciliation |
| G8 Reliability | Docker fault injection, load and CWV targets measured, redacted logs/traces, security audit, backup/restore and rollback |
| G9 Release | all required AC mapped to evidence; owner/merchant approval, actual Coolify revision, smoke, rollback plan, monitored rollout |

Test statuses: PASS_REAL for an executed test on the required real components, PASS_SIMULATED for fixtures, FAIL, BLOCKED, NOT_RUN. Record command, environment, exit code, tested SHA, evidence path and limitations. Missing API/Docker does not waive a gate. A simulated checkout is not a real checkout. Test only authorized environments; never send customer campaigns or execute live charges for certification without separate approval.

Initial engineering targets from PRD: LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 at p75; search p95 ≤200 ms and first useful AI response p95 ≤2 s subject to measured environment; document capacity, methodology, sample size, load profile, model/cost and failures. Do not silently lower targets. RPO/RTO to be confirmed through actual restoration. No claimed SLA from a single VPS.

NO-GO for V1 if any critical acceptance criterion fails, is blocked or not run, including isolation, transaction/identity integrity, consent, Hermes confinement and restore. Scoped launch requires explicit founder approval and disabled unavailable features. Release report binds verdict to exact SHA and image digests. No hosted CI, automatic merge or deploy.
