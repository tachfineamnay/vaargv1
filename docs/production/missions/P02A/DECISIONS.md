# Decisions
- Current older branch did not contain main or P02. Created a separate local mission branch rooted at verified main, without disturbing existing untracked checkouts.
- Explicit user instruction and newer main supersede the older pasted HANDOFF requirement. No HANDOFF files will be restored.

Explicit idempotency key is distinct from principal and payload. Existing hash-only rows receive reserved legacy keys because their original caller keys cannot be reconstructed; preserve rows, do not pretend old requests can be correlated. Callers must complete claims and business effects in the same transaction.

Merchant authentication now persists only token hashes, revalidates account and store membership on every resolve, and offers atomic rotation and revoke; HTTP login/cookie endpoints were absent in source and are not represented as operational. Existing migration 0001 has a fixed runtime-role password; changing a cluster-wide existing role in a forward migration could alter unrelated databases, so deployment provisioning must replace it; no production safety certification claimed.

The partial P02 HTTP catalog remains NOT_CONFIGURED: a caller-supplied store ID is not trusted tenant resolution. No merchant HTTP session or cookie flow is claimed. These missing application boundaries leave task 3 and P02A incomplete; real provider credentials and production mutations were not used.

Revision: the inherited fixed vaarg_app password was confirmed usable on PG18. Forward migration 0007 makes vaarg_app a NOLOGIN, passwordless group; separate restricted login roles must be provisioned and granted it before migration. This changes a cluster-wide role and can interrupt any other database using direct vaarg_app login: assess shared-cluster dependencies before any future rollout. No remote or production role was changed.
