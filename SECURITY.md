# Security policy

No released or supported production version yet. Treat repository contents as public.

Report suspected vulnerabilities privately to the repository owner through an established private contact channel (GitHub private vulnerability reporting if enabled). Do not open a public issue containing exploit details, credentials or customer information. Include affected commit, sanitized reproduction, impact and suggested mitigation.

## Required controls
- Least-privilege server-side Shopify and AI secrets, rotation, no secrets in Git, prompts, screenshots, browser or logs. Use authorized local secret injection; no production customer data in Arena.
- HTTPS, secure session cookies, CSRF/XSS/SSRF protections, RBAC, cross-store isolation, rate limits, webhook raw-body HMAC and replay/deduplication.
- Hermes private endpoint, no direct shell/SQL/host files/host Docker socket; scoped service identities and ToolBroker allowlists; treat catalog and chat as untrusted data.
- Separate essential commerce from optional personalization and marketing. Track purpose, retention, provenance, correction/deletion and unsubscribe. Recheck eligibility immediately before sending. No real messages or paid fallback without authorization.
- Pin dependencies and image digests at release, audit vulnerabilities and dependency licenses, test restore and rollback. Evidence must be redacted and synthetic where public.

If a secret leaks: stop affected work, notify owner privately, rotate/revoke the credential, assess exposure, remediate history only with authorization, and record a sanitized incident. Never assume deleting a committed file revokes exposure.

See [PRD](docs/product/PRD.md) and [certification](docs/production/CERTIFICATION.md). This policy is not evidence that controls are implemented.
