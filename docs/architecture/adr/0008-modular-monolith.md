# ADR-0008: Modular monolith for the Kernel

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect

## Context
The Kernel has ~16 components. The constitution is hostile to premature
distribution, unnecessary microservices, and agent/service spaghetti, but
equally hostile to god services and hidden coupling. We must get strong
internal boundaries *now* and the ability to distribute *later* (L40) without a
rewrite.

## Decision
The Kernel is a **modular monolith**: one process (`apps/core`), each component
a Nest module with (a) a public provider interface, (b) a declared set of
emitted event types, (c) its own PostgreSQL schema and DB role. Cross-module
communication is **only** via injected interfaces or events — never shared
tables, never reaching into another module's repository.

Only **three** additional processes exist in MK.42, each justified by
lifecycle or blast radius, not by "it's a different domain":

- `apps/gateway` — holds provider credentials; slow, failure-prone network IO;
  must restart independently (L26).
- `apps/voice`, `apps/vision` — hard-realtime loops; must not share a GC/event
  loop with the Kernel; crash-isolated; keep raw media local (L27).

Agents and capability adapters run as **spawned out-of-process workers**, not
standing services.

Every module carries a documented **extraction seam** (`SYSTEM_BOUNDARIES.md`
§10): swap the in-process interface binding for a NATS request/reply binding
and give it its own schema connection — no consumer changes, because consumers
already use contracts and events.

## Alternatives considered
- **Microservices from day one** — independent scaling and deploys, but for a
  single-operator, two-node system it multiplies ops, latency, failure modes,
  and distributed-transaction problems with no benefit. This is the outcome the
  constitution explicitly forbids for MK.42.
- **Single-module monolith (no internal boundaries)** — fastest to write,
  but hidden coupling accretes and L40 becomes impossible. Rejected.
- **Actor framework (e.g. one process, actor per component)** — reasonable,
  but Nest modules + events give us the same isolation with a more familiar
  idiom.

## Benefits
- One transaction boundary for state-change + event + outbox (huge
  simplification vs distributed sagas for the core).
- One process to run, debug, and deploy in MK.42.
- Boundaries enforced by module interfaces + DB roles + lint, not by network
  calls.
- Extraction is mechanical when a real scaling/ownership need appears.

## Disadvantages
- A single process is a single failure unit for the Kernel (mitigated by
  event-sourced fast recovery, `STATE_MODEL.md` §7).
- Requires ongoing discipline to keep modules from importing each other's
  internals.
- Can't independently scale one hot component until it's extracted.

## Risks
- "Just this once" cross-module table access. Mitigated: per-schema DB roles
  make it fail at connect time; review enforces.
- The monolith never gets split when it should. Mitigated: `ROADMAP.md` lists
  triggers and order; extraction is designed-in, not deferred-and-hoped.

## Consequences
- Adding a Kernel component requires an ADR (`KERNEL_CONSTITUTION.md` §1).
- Adding a *process* requires justifying it by lifecycle or blast radius, not
  by domain.
- All inter-module contracts live in `packages/contracts` or `*.port.ts`.

## Reversal difficulty
**Moderate** to extract a module (designed for; mechanical). **High** to
collapse back from microservices to a monolith if we over-split — which is why
we start consolidated.
