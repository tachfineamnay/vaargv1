# P02 tasks

1. VERIFIED — Establish cumulative P01 base, freeze scope and checkpoints.
2. VERIFIED — Inspect P01 persistence, runtime and migration mechanisms. Depends on 1.
3. IN_PROGRESS — Storefront adapter, pagination, market context, media and bounded retries implemented and synthetic-tested; live schema/provider validation, additional edge cases and shared per-store rate control outstanding. Depends on 2.
4. IN_PROGRESS — PostgreSQL projection, checkpoints, resume, context isolation, freshness and reconciliation implemented and exercised on synthetic data/PG18; real provider reconciliation and operational review outstanding. Depends on 2–3.
5. IN_PROGRESS — Local CLI, explicit HTTP NOT_CONFIGURED, webhook verification contract and opt-in Storefront test prepared; trusted tenant/domain/token binding and HTTP projection reads missing; Hatchet runtime not integrated. Depends on 3–4.
6. IN_PROGRESS — Partial gates and evidence collected; P01 PG18 regression suite and lint fail, real Shopify and live smoke not run. Cumulative checkpoint exported; P02 source delivery incomplete. Depends on 3–5.
