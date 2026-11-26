# Validation
Source: 9a828d72272261ba21369bfde701997f3e6c6dd1 plus uncommitted P00-BIS changes; Windows, Node 24.21.0, pnpm 10.6.1.
- docker version: sandbox exit 1 (pipe permission denied); elevated exit 0 (Docker Engine 29.8.1). No containers started.
- pnpm --filter @vaargv1/worker test: exit 1 before implementation (missing lifecycle module); after implementation exit 0, two tests with mocked dependency. PASS_SIMULATED only.
- pnpm --filter @vaargv1/worker typecheck: exit 0.
- pnpm install --lockfile-only --offline --ignore-scripts: exit 1 missing offline metadata.
- pnpm install --lockfile-only --ignore-scripts --config.fetch-retries=0 --config.fetch-timeout=10000: exit 0, with unmet peer dependency warnings in API and web. Not a frozen install.
- npm view next version engines peerDependencies --json: exit 0, 16.4.6, Node >=20.9.0, React ^18.2 or ^19.0.0.
Full tests, builds, Docker images and runtime integration NOT_RUN. No certification.
