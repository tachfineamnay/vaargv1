# P00 tasks
All unchecked at documentation bootstrap. Update status and evidence after each task.

- [ ] P00-T01 — Verify repo/HEAD/dirty state, documents/hashes and environment capabilities.
- [ ] P00-T02 — Record exact stable compatibility matrix and dependency/image licensing checks.
- [ ] P00-T03 — Root pnpm workspace/Turborepo, strict TS, lockfile, lint/format and root commands.
- [ ] P00-T04 — Implement shared Zod contracts and actual Next.js web entrypoint.
- [ ] P00-T05 — Implement NestJS/Fastify API and health/readiness.
- [ ] P00-T06 — Implement real worker entrypoint and explicit dependency readiness.
- [ ] P00-T07 — Safe .env.example, local Docker definitions and smoke tests; store config separate.
- [ ] P00-T08 — Run frozen install, lint, typecheck, test, build and live smoke where available; correct failures.
- [ ] P00-T09 — Record Hermes/Hatchet/A2UI/AG-UI/Hydrogen integration risks and remaining real gates.
- [ ] P00-T10 — Update all checkpoint files and STATUS; prepare local commit or verified export, handoff and next action.

Dependencies: T01 first, T02 before dependency lock, T03 before app implementation, T04–T07 before T08; T09 can proceed independently; T10 last. Do not mark VERIFIED without evidence.
