# FL06 — Hermes Swarm, Hatchet, and ToolBroker

- **Repository**: `tachfineamnay/vaargv1`
- **Working branch**: `arena/4e23a26f-vaargv1`
- **Verified base SHA**: `5c4731f74639eefe85f6a4e3921c2b9a3d08b422` (`main`)
- **PRD SHA-256**: `7e49d94144b4fd24b8968652664c354d5d8949946d9d9773c8314cbb630f8596`
- **Graphify**: `GRAPHIFY_BLOCKED` (CLI unavailable in sandbox; exit 127)
- **Pinned upstreams**:
  - `NousResearch/hermes-agent`: `v0.23.4` (`8fc0374447313e276f6b9a2764bfc750190c966a`)
  - `@hatchet-dev/typescript-sdk`: `1.49.1`

## Scope
1. Agentic domain contracts (`@vaarg/shared`) and forward PostgreSQL/Drizzle persistence (`0014_intelligence_domain.sql`).
2. `AgentPort` and Hermes `v0.23.4` HTTP/SSE adapter with isolated visitor sessions and private runtime confinement.
3. Master + 6 logical specialists (`master`, `discovery`, `experience`, `commerce`, `memory`, `marketing`, `support`) with versioned prompts and Zod schemas.
4. Server-enforced delegation limits (`depth <= 1`, `maxConcurrentChildren <= 3`, bounded child count) and shared atomic budgets.
5. Centralized server-side `ToolBroker` reusing FL05-FIX `ExperienceCapabilities` + catalog knowledge + private Hermes bridge.
6. Validated direct provider policies (`Gemini API` and `DeepSeek API` only; no implicit fallback; verified pricing required).
7. Conversation & agent run NestJS module bound to FL05 `contextVersion`, consent, and stale-run CAS.
8. Real `@hatchet-dev/typescript-sdk@1.49.1` worker integration for catalog sync, embedding refresh, and retention cleanup.
9. Typed durable workflow contracts for FL07–FL11 with explicit `WORKFLOW_NOT_IMPLEMENTED` refusal for unimplemented handlers.
10. Runtime/compose/env integration preserving FL01–FL05 and FL05-FIX.
