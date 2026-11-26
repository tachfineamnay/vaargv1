# FL02 — Core Application Foundation

Source SHA at entry: dbb3147b7eb3b187aec17a752011760a81d56e92 (branch arena/943b6362-vaargv1).
GRAPHIFY_BLOCKED: `graphify` command not found (exit 127); owner authorized direct source navigation.

Scope: separate application boundaries (identity, merchant auth, visitor sessions, tenant context,
authorization, privacy/consent, catalog), trusted tenant resolver, merchant identity module with
guards, visitor session HTTP lifecycle with Valkey-derived cache, consent endpoints, shared Zod
contracts, persistence consistency review, full wiring. Code only; no Docker, no deployment, no
comprehensive certification. Preserve P00–P02B and FL01 behavior and existing tests.
