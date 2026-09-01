# @jarvis/objectives

**Purpose.** The **Objective Engine** (`docs/architecture/ROADMAP.md` MK.48,
contract `@jarvis/contracts/objective.ts`). Owns objectives: creation,
decomposition into child objectives, success criteria, and status transitions.
Decides **what** should happen and **why** — never **when** (that is the
Scheduler, review §16.1).

**Owns.** The `projections.objectives` read model + the objective event stream.
**Single writer** of objective state; transitions are serialised per objective
id (review §16.10).

**Depends on.** `@jarvis/contracts`, `@jarvis/events`, `@jarvis/state`.

**Must not.** Execute anything (it proposes; the Executor disposes). Schedule
work directly (it hands intent to the Scheduler). Let another component write
objective status.

**Extraction seam.** → a planning service (with the Scheduler).
