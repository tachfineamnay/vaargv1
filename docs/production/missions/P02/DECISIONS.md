# P02 decisions

- Use merged P01 main commit, not the unrelated old local P00 checkout. Original workspace and worktree remain untouched.
- User's current BUILD NOW instruction authorizes P02 source implementation despite earlier Arena execution allocation; no next mission authorized.
- Shopify contextual catalog visibility cannot distinguish deletion from market/channel unpublishing. Reconcile absence per context, never assert global deletion without evidence.
- Use context-specific full sweeps, transactionally checkpointed pages and a generation marker; only a completed sweep may reconcile missing products. P01 webhook inbox is a future ingestion boundary, not an unauthenticated endpoint.
- Use a pinned Storefront API version and Zod response contracts; defer Hydrogen absent demonstrated compatibility.
- Correct inherited P01 transaction context helper after real PG18 reproduced its SET LOCAL bind syntax error; use transaction-local parameterized set_config.
- Do not wire a caller-supplied store ID into a public catalog read: trusted tenant resolution and binding store domain/token to store configuration remain necessary. The HTTP catalog explicitly returns NOT_CONFIGURED until implemented.
- Isolated database tests require explicit local-only test URLs; inherited DATABASE_URL-driven test execution was unsafe for production databases.
