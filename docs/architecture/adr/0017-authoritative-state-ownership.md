# ADR-0017: Single authoritative state, Kernel-owned

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
L5: one authoritative logical system state. L6: interfaces consume, don't own.
L10: agents don't own state. The failure mode this prevents is *duplicated
authority* — two components that both believe they own "the truth" about
something, drifting apart, with no defined reconciliation. The adversarial
review (§16.1, §16.2, §16.10) found several latent instances.

## Decision
- Authoritative state = **Event Log + Projected State**, in PostgreSQL, written
  **only** by Kernel components, each category having **exactly one owner
  component** (`DATA_OWNERSHIP.md` §1).
- The **World Model** and **Memory** are separate systems (L8) with their own
  single owners; they are authoritative for *beliefs* and *experience*
  respectively, not for system state.
- **Ephemeral Runtime State** (Redis) is explicitly *not* authoritative and is
  always reconstructible.
- Cross-domain access is forbidden: data crosses a boundary as an **event** or
  a call to the **owner's interface**, never a shared table or cross-schema
  query. Enforced by **per-schema database roles**.
- Ambiguity is resolved by the procedure in `DATA_OWNERSHIP.md` §5: identify
  the single question the data answers; if two owners are needed, the data is
  two categories — split it; record the resolution.
- `principalId` scoping on every personal row from day one (L34).

## Alternatives considered
- **Each service owns its data, sync via events, eventual consistency
  everywhere** — the microservices default. Rejected for MK.42: it trades the
  simplicity of one transactional core for distributed-consistency problems we
  don't need at two nodes, and it makes "one authoritative state" (L5) a
  fiction.
- **A single shared database with no schema/role separation** — one owner in
  practice becomes everyone; hidden coupling accretes; L40 dies.
- **Interfaces cache and can write-through** — breaks L6; interfaces would hold
  authority during partitions.

## Benefits
- No duplicated authority: for any fact about the system, exactly one component
  can change it and exactly one place holds it.
- One transaction boundary for the core (state + event + outbox).
- Reconstruction and audit are well-defined (`STATE_MODEL.md` §7,
  `SECURITY_MODEL.md` §8).
- Multi-user is a data/policy change, not a re-architecture (L34).

## Disadvantages
- The Kernel process + PostgreSQL are a central dependency; their outage fails
  writes closed (accepted; `FAILURE_MODEL.md`).
- Discipline required to never cross schemas; some cross-domain reads become an
  interface call or an event subscription instead of a convenient join.
- Read-your-writes across a projection needs the `asOfEventPosition` mechanism
  (`STATE_MODEL.md` §5).

## Risks
- Central write path becomes a throughput bottleneck. Mitigated: MK.42 volume
  is human-scale; hot components can be extracted (`SYSTEM_BOUNDARIES.md` §10)
  with their own schema when measured need appears.
- A component's ownership list grows into a god service. Mitigated:
  `DATA_OWNERSHIP.md` §5 split procedure + ADR gate on Kernel components.

## Consequences
- Every Kernel module has its own schema and a DB role that can touch only it
  (+ read-only `events`).
- No interface or agent has any authoritative-store credential.
- New state categories are added to `DATA_OWNERSHIP.md` §1 with a named owner
  before code is written.

## Reversal difficulty
**Severe.** This is the backbone of L5/L6/L10. Moving to per-service data
ownership would touch every component, every schema, and introduce distributed
consistency machinery throughout. The designed evolution is *extraction with
preserved single-ownership*, not fragmentation of authority.
