# Decisions
- No production deployment or database mutation authorized.
- Historical migration SQL remains unchanged. Fresh installs precreate vaarg_app NOLOGIN before 0001; existing cluster role changes require explicit review/approval. Never claim historical checksums were verified.
- Runtime logins must be newly provisioned and marked; pre-existing unmarked logins are not adopted. Compose runtime services do not receive maintenance credentials.
- Compose edge permits outbound provider access; proxy routing, actual domain/TLS, and secrets remain operator configuration.
