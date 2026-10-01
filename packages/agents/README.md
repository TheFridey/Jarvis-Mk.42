# @jarvis/agents

> **README-ONLY EXTRACTION SEAM — NOT A WORKSPACE PACKAGE.** There is no
> `package.json` or runtime code here. The implemented agent runtime and roster
> are in `apps/core/src/kernel/cognition/agent-runtime.ts`. Add Kernel behavior
> there unless an accepted ADR first authorises extraction.

**Purpose.** The **Agent Runtime** (`docs/architecture/COGNITION_MODEL.md` §6).
Spawns, leases, supervises, budgets, and reaps agents as **isolated workers**.
Provides the mediated gateway channel (stamps `onBehalfOf`), the scoped
`ContextFrame` delivery, the capability **proposal** scope, and the control
channel over which agent output returns. **The Runtime — not the agent —
emits events, after validation** (review §16.7).

**Owns.** `projections.agent_runs` + Redis leases. No agent-owned system state
(L10).

**Depends on.** `@jarvis/contracts`, `@jarvis/events`, `@jarvis/validation`,
`@jarvis/context` (frame scoping), the gateway client interface.

**Must not.** Give an agent any credential (DB, NATS, provider). Let an agent
publish to NATS, call the Executor, or spawn sub-agents directly. Let an agent
persist across its lease or exceed its cost/context/wall-time budget.

**Roster.** The named agents live in `/agents/*` as manifests; this package is
the machinery that runs them.

**Extraction seam.** → an orchestration service on a worker node.
