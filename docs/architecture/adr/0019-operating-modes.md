# ADR-0019: JARVIS Operating Modes

Status: Accepted
Date: 2026-08-31
Deciders: Principal Architect / Principal Implementation Engineer

## Context
The MK.43 "Nervous System" phase requires JARVIS to have an explicit,
observable **operating posture** that governs how proactive it is, how it
handles interruptions, and how it behaves under failure or threat. The GENESIS
constitution (`KERNEL_CONSTITUTION.md` §1) froze the 16 Kernel components and
did not name a "mode" concept. We need one, and it must not become a backdoor
around policy (L18–L21).

## Decision
Introduce **seven operating modes** as a first-class, versioned facet of
authoritative state, **owned by the State Manager** (this is a `mode` domain /
Nest module under `apps/core/src/kernel/mode`, not a new top-level Kernel
component — so no change to the frozen 16).

Modes:

| Mode | Meaning |
|---|---|
| `DORMANT` | Minimal activity. Perception at lowest duty cycle. No proactive behaviour. Responds only to explicit wake. |
| `AMBIENT` | Passive awareness. Perception active, events flowing, world model updating. No unsolicited user interruption beyond `CRITICAL` notifications. |
| `ENGAGED` | An interaction is active. Normal responsiveness. Notifications gated by interruption policy. |
| `FOCUSED` | The user is in deep work (or has asked for focus). Proactivity suppressed; only `urgent`+ notifications pass; JARVIS batches the rest. |
| `AUTONOMOUS` | JARVIS is executing objectives without a user present. Proactive planning/execution **within already-granted authority**. Does **not** raise any risk ceiling. |
| `GUARDIAN` | A security event is in effect. Proactivity halted; capability execution restricted to a safe subset by policy; heightened audit; user alerted. |
| `DEGRADED` | One or more critical dependencies are unhealthy. Non-essential scheduled work paused; approval requirements raised; routing prefers local. |

**Transition rules** are a deterministic table (`ModeTransitionPolicy`, same
style as the Policy Engine — pure function, no model calls). Every transition
emits `jarvis.mode.changed` (retentionClass `OPERATIONAL`; `SECURITY` when
entering/leaving `GUARDIAN`). Arbitrary/unlisted transitions are rejected.

Legal transitions (initial table; extend by updating this ADR):

```
DORMANT     -> AMBIENT, DEGRADED, GUARDIAN
AMBIENT     -> DORMANT, ENGAGED, AUTONOMOUS, DEGRADED, GUARDIAN
ENGAGED     -> AMBIENT, FOCUSED, AUTONOMOUS, DEGRADED, GUARDIAN
FOCUSED     -> ENGAGED, AMBIENT, DEGRADED, GUARDIAN
AUTONOMOUS  -> AMBIENT, ENGAGED, DEGRADED, GUARDIAN
DEGRADED    -> AMBIENT, ENGAGED, DORMANT, GUARDIAN      (only when health recovers)
GUARDIAN    -> AMBIENT, DEGRADED                        (only on explicit security clear)
ANY         -> DEGRADED     (on critical dependency failure)
ANY         -> GUARDIAN     (on security event)
```

Guards: `-> AUTONOMOUS` requires no `PRESENT`/`ENGAGED` presence and at least
one active objective. `DEGRADED -> healthy modes` requires Health Manager
reporting all critical deps `HEALTHY`/`RECOVERING`. `GUARDIAN -> *` requires an
explicit `security.cleared` command from the operator.

## Alternatives considered
- **A new Kernel component "Mode Manager"** — cleaner separation, but expands
  the frozen 16 and mode is genuinely a piece of authoritative state the State
  Manager already governs. Rejected as over-structuring.
- **Modes as a client/UI concept only** — fails: modes must gate scheduler,
  notifications, and (via policy input) capability behaviour server-side.
- **Deriving mode implicitly from presence + health + security** — no explicit
  state, no auditable transition, hard to reason about. Rejected; we want an
  explicit state machine with events.

## Benefits
- One explicit, auditable posture that scheduler / notification / policy read.
- Deterministic, testable transition table.
- `DEGRADED` and `GUARDIAN` give `FAILURE_MODEL.md` and `SECURITY_MODEL.md`
  concrete hooks.
- No expansion of the frozen Kernel component set.

## Disadvantages
- Another state machine to maintain and test.
- Risk of "mode creep" — components branching on mode instead of on the
  specific signal (health, presence, policy). Mitigated: components read the
  **underlying** signal where they can; mode is for cross-cutting posture only.

## Risks
- Someone treats `AUTONOMOUS` as "skip approval". **Explicitly forbidden**:
  mode is never an input that raises a risk ceiling or converts
  `REQUIRE_APPROVAL` to `ALLOW`. Policy tests assert this.
- Oscillation between `DEGRADED` and healthy modes. Mitigated: hysteresis — a
  minimum dwell time + health must be stable for N seconds before leaving
  `DEGRADED`.

## Consequences
- `packages/contracts` gains `JarvisMode`, `ModeTransition`, `mode.changed`
  payload.
- State Manager owns `projections.mode` (single row, versioned).
- Scheduler consults mode (pauses non-essential work in `DEGRADED`/`GUARDIAN`).
- Notification Manager consults mode (suppression thresholds per mode).
- Policy Engine **may** read mode as context but no rule may use it to weaken a
  decision (only to strengthen, e.g. `GUARDIAN` ⇒ deny a normally-allowed
  action).
- `GLOSSARY.md` disambiguates `JarvisMode.FOCUSED` from
  `PresenceState.FOCUSED`.

## Reversal difficulty
**Low.** Modes are one versioned state row + a pure transition table + event.
Removing the concept means deleting the module and the `mode.changed` event and
having scheduler/notification read health/presence directly.
