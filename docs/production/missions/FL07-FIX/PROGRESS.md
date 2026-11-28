# FL07-FIX Progress

## Implemented
- Migration `0016_fl07_fix_consolidation.sql`: proposal_publications (FIX01),
  model_usage provider_call_id/status/abandoned_reason + unique index (FIX04),
  provider_admission_ledger (FIX05), anonymous_consent_records + projections
  (FIX07), abuse_limit_events (FIX10); updated purge_expired_intelligence.
- Schema: `intelligence.ts` (+3 tables, model_usage cols), `privacy.ts`
  (+2 anonymous tables + enums).
- `intelligence/proposal-publication.ts`: `publishActionProposalAtomic`.
- `intelligence/provider-admission.ts`: create/check/claim/release admission.
- `privacy/anonymous-consent.ts`: record/get/getState anonymous consent.
- `intelligence-repository.ts`: reserveModelCallBudget union return
  (budget-exceeded committed, thrown after commit), reconcileModelCallUsage
  provider_call_id + UNKNOWN row, markProviderCallUnknown, beginToolInvocationAudit
  budget_exceeded return, reserveChildDelegationRun deadline return.
- `hermes-bridge.controller.ts`: providerCallId wiring, subagent deadline guard.
- `tool-broker.service.ts`: budget_exceeded guard.
- `conversation.service.ts`: provider_call_id, X-Vaarg-Provider-Call-Id header,
  UNKNOWN settlement, FIX06 observable event failures.
- `experience.service.ts`: storefront hybrid admission gate.
- `consent.service.ts`: anonymous-session get/update.
- `deploy/hermes/plugins/vaarg-confinement/__init__.py`: echo provider-call id,
  bounded reconciliation retries, no swallowed failures.
- `tool-broker.ts` (shared): providerCallId on reserve/reconcile contracts.

## Verification
- `pnpm build` 5/5, `pnpm typecheck` 7/7, `pnpm lint` 5/5 PASS.
- Focused tests: persistence 85 passed / 44 skipped (PG NOT_RUN),
  api 21 passed / 10 skipped. New `fl07-fix.test.ts` skips without PG.

## Not done
- Real PostgreSQL/pgvector/Valkey/Hermes/provider gates NOT_RUN.
- No FL08, no deployment/certification.
