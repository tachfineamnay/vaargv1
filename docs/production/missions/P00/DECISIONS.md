# P00 decisions
- Clean-room rebuild: no reuse of previous P00/P00-BIS application code. Previous implementation preserved in git history; new source written fresh from the documentation baseline.
- Session branch deviation: mission requested branch `arena/v1-build`; Arena pins the session to `arena/4c6c91c7-vaargv1`. The current branch name is fixed and work proceeds there. Recorded as a deviation, not a silent change.
- Node engine: sandbox runtime is node v22.22.3 (target Node 24 LTS). Docker images use node:24-alpine; engines field documents the range honestly.
- API logging: Pino structured logging per mission requirement (replaces the earlier custom JSON logger in the API boundary).
- Readiness contracts reject contradictory states via Zod refinement.
- Hatchet is the approved durable orchestrator; wired but disabled in P00. No BullMQ, no competing framework.
